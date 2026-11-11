export interface QuotaWindow {
  id: string;
  remaining: number;
  resetAt: number | null;
}
export interface QuotaAccount {
  id: string;
  provider: string;
  readAt: number;
  windows: QuotaWindow[];
}
export interface QuotaSample {
  at: number;
  accounts: QuotaAccount[];
}
export interface QuotaHistory {
  version: 1;
  now: number;
  samples: QuotaSample[];
  error: string | null;
  activity?: { at: number; account: string; tokens: number }[];
}
export interface QuotaPoint {
  at: number;
  values: Record<string, number>;
  kind?: 'observed' | 'estimated' | 'projected';
}
const HOUR = 3600000;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
export function available(accounts: QuotaAccount[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const measured = accounts.filter((a) => a.windows.length);
  for (const a of measured)
    totals[a.provider] =
      (totals[a.provider] ?? 0) + Math.min(...a.windows.map((w) => w.remaining)) / measured.length;
  return totals;
}
// Percentage points per hour. Repeated cached reads, stale intervals and resets
// do not count as consumption or as observed time in the burn denominator.
export function windowBurn(
  samples: QuotaSample[],
  account: string,
  window: string,
  now: number
): number | null {
  let previous: { at: number; w: QuotaWindow } | null = null;
  let consumed = 0,
    elapsed = 0;
  for (const s of samples) {
    const a = s.accounts.find((a) => a.id === account);
    const w = a?.windows.find((w) => w.id === window);
    if (!a || !w || a.readAt < now - 3 * HOUR || a.readAt > now) continue;
    if (
      previous &&
      a.readAt > previous.at &&
      a.readAt - previous.at <= 20 * 60000 &&
      ((previous.w.resetAt === null && w.resetAt === null) ||
        (previous.w.resetAt !== null &&
          w.resetAt !== null &&
          Math.abs(previous.w.resetAt - w.resetAt) <= 5000 &&
          a.readAt < previous.w.resetAt)) &&
      w.remaining <= previous.w.remaining
    ) {
      consumed += previous.w.remaining - w.remaining;
      elapsed += a.readAt - previous.at;
    }
    if (!previous || a.readAt > previous.at) previous = { at: a.readAt, w };
  }
  return elapsed >= 5 * 60000 ? consumed / (elapsed / HOUR) : null;
}
export const DAY = 24 * HOUR;
export function quotaViewport(now: number, zoom: number) {
  // Logarithmic scale gives useful fine control at both multi-week and hourly depths.
  const span = 22 * DAY * Math.pow((6 * HOUR) / (22 * DAY), Math.max(0, Math.min(100, zoom)) / 100);
  return { start: now - (span * 14) / 22, end: now + (span * 8) / 22 };
}
export function windowPeriod(id: string): number | null {
  if (/seven_day|weekly/.test(id)) return 7 * DAY;
  if (/five_hour/.test(id)) return 5 * HOUR;
  return null;
}
// Known first reset, then an assumed recurring cadence under continuous activity.
export function projectedWindow(w: QuotaWindow, rate: number, now: number, at: number) {
  if (w.resetAt !== null && at >= w.resetAt) {
    const period = windowPeriod(w.id);
    const sinceReset = period ? (at - w.resetAt) % period : at - w.resetAt;
    return clamp(100 - (rate * sinceReset) / HOUR);
  }
  return clamp(w.remaining - (rate * (at - now)) / HOUR);
}

export function quotaSeries(history: QuotaHistory, provider = '') {
  const filter = (a: QuotaAccount) => !provider || a.provider === provider;
  const samples = history.samples.map((s) => ({ ...s, accounts: s.accounts.filter(filter) }));
  const latest = samples[samples.length - 1];
  const actual: QuotaPoint[] = samples.map((s) => ({
    at: s.at,
    values: available(s.accounts),
    kind: 'observed',
  }));
  const providers = [...new Set(samples.flatMap((s) => s.accounts.map((a) => a.provider)))].sort();
  const forecast: QuotaPoint[] = [];
  let projectedAccounts = 0;
  let heldAccounts = 0;
  const fresh =
    latest && history.now - latest.at <= 5 * 60000 && latest.accounts.length > 0 && !history.error;
  if (fresh) {
    const rates = latest.accounts.map((a) =>
      a.windows.map((w) => windowBurn(samples, a.id, w.id, history.now))
    );
    const ready = latest.accounts.map(
      (a, i) =>
        a.windows.length > 0 &&
        history.now - a.readAt <= 20 * 60000 &&
        a.readAt <= history.now &&
        rates[i].every((r) => r !== null)
    );
    projectedAccounts = ready.filter(Boolean).length;
    heldAccounts = latest.accounts.length - projectedAccounts;
    if (projectedAccounts > 0) {
      // Include reset instants explicitly, so the chart doesn't smooth away replenishment.
      const times = new Set(Array.from({ length: 385 }, (_, i) => history.now + (i * HOUR) / 2));
      for (const a of latest.accounts.filter((_, i) => ready[i]))
        for (const w of a.windows) {
          if (w.resetAt && w.resetAt > history.now) {
            const period = windowPeriod(w.id);
            for (
              let reset = w.resetAt;
              reset <= history.now + 8 * DAY;
              reset += period ?? 9 * DAY
            ) {
              times.add(reset - 1);
              times.add(reset);
            }
          }
        }
      for (const at of [...times].sort((a, b) => a - b))
        forecast.push({
          at,
          kind: 'projected',
          values: available(
            latest.accounts.map((a, ai) => ({
              ...a,
              // Keep the cohort/denominator and current anchor unchanged. An
              // uncalibrated account is explicitly held at its last reading,
              // not assigned a measured zero burn or assumed future resets.
              windows: !ready[ai]
                ? a.windows
                : a.windows.map((w, wi) => {
                    return {
                      ...w,
                      remaining: projectedWindow(w, rates[ai][wi] ?? 0, history.now, at),
                    };
                  }),
            }))
          ),
        });
    }
  }
  const reconstructed: QuotaPoint[] = [];
  if (latest?.accounts.length) {
    const cumulative = new Map<string, { at: number; total: number }[]>();
    for (const item of history.activity ?? []) {
      const rows = cumulative.get(item.account) ?? [];
      rows.push({ at: item.at, total: (rows[rows.length - 1]?.total ?? 0) + item.tokens });
      cumulative.set(item.account, rows);
    }
    const activityAt = (id: string, at: number) => {
      const rows = cumulative.get(id) ?? [];
      let lo = 0,
        hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (rows[mid].at <= at) lo = mid + 1;
        else hi = mid;
      }
      return rows[lo - 1]?.total ?? 0;
    };
    const units = (id: string, start: number, end: number) =>
      Math.max(0, activityAt(id, end) - activityAt(id, start));
    const burns = new Map<string, number | null>();
    const estimate = (a: QuotaAccount, w: QuotaWindow, at: number) => {
      const period = windowPeriod(w.id);
      const start = period && w.resetAt ? w.resetAt - period : null;
      const used = 100 - w.remaining;
      const currentUnits = start !== null ? units(a.id, start, a.readAt) : 0;
      const key = `${a.id}|${w.id}`;
      if (!burns.has(key)) burns.set(key, windowBurn(samples, a.id, w.id, history.now));
      const burn = burns.get(key) ?? null;
      if (start !== null && period) {
        const cycleStart = start + Math.floor((at - start) / period) * period;
        if (currentUnits > 0 && used > 0) {
          if (at >= start)
            return clamp(w.remaining + (units(a.id, at, a.readAt) * used) / currentUnits);
          return clamp(100 - (units(a.id, cycleStart, at) * used) / currentUnits);
        }
        const hourly = burn ?? used / Math.max(1 / 60, (a.readAt - start) / HOUR);
        return at >= start
          ? clamp(w.remaining + (hourly * (a.readAt - at)) / HOUR)
          : clamp(100 - (hourly * (at - cycleStart)) / HOUR);
      }
      return clamp(w.remaining + ((burn ?? 0) * (a.readAt - at)) / HOUR);
    };
    let index = 0;
    for (let at = history.now - 14 * DAY; at < history.now; at += HOUR / 2) {
      while (index + 1 < actual.length && actual[index + 1].at <= at) index++;
      const near = [actual[index], actual[index + 1]].filter(Boolean);
      if (near.some((p) => Math.abs(p.at - at) <= 5 * 60000 && Object.keys(p.values).length))
        continue;
      reconstructed.push({
        at,
        kind: 'estimated',
        values: available(
          latest.accounts.map((a) => ({
            ...a,
            windows: a.windows.map((w) => ({ ...w, remaining: estimate(a, w, at) })),
          }))
        ),
      });
    }
  }
  // A single timeline avoids overlapping estimated and observed stacks.
  const past = [...actual.filter((p) => Object.keys(p.values).length), ...reconstructed].sort(
    (a, b) => a.at - b.at
  );
  return {
    actual,
    past,
    reconstructed,
    forecast,
    projectedAccounts,
    heldAccounts,
    providers,
    measured: latest?.accounts.length ?? 0,
    fresh: Boolean(fresh),
  };
}
