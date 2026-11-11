import type { PlanningData, CapacityCycle, QuotaRun } from './types';
import type { PlanningAccount } from './model';
import type { UsageRow } from '@/features/spend/types';

export const planKey = (provider: string, tier: string) => JSON.stringify([provider, tier]);
export interface Calibration {
  key: string;
  provider: string;
  planType: string;
  model: string;
  window: CapacityCycle['window'];
  tokensPerQuota: number | null;
  tokens: number;
  quotaPoints: number | null;
  observations: number;
  method: 'direct' | 'fitted' | 'pooled';
  error: number | null;
  quotaPerMillion?: number;
  tokenShare?: number;
  fullRuns?: number;
  partialRuns?: number;
  samples?: { actual: number; predicted: number }[];
}

const total = (r: UsageRow) => r.input + r.output + r.cacheRead + r.cacheWrite;

// Normalize every run to a 100%-used allowance, weighting by the fraction
// actually observed. Solve sum(model tokens * quota points/token) = quota used.
// A small ridge toward the observed pool average makes sparse/collinear models
// usable estimates instead of zero-cost tokens or a discarded forecast.
export function fitQuotaCosts(rows: { tokens: Record<string, number>; used: number }[]) {
  const models = [...new Set(rows.flatMap((r) => Object.keys(r.tokens)))].sort();
  const quota = rows.reduce((s, r) => s + r.used, 0);
  const tokens = rows.reduce((s, r) => s + Object.values(r.tokens).reduce((a, b) => a + b, 0), 0);
  const base = quota / tokens;
  const weights = rows.map((r) => r.used / 100);
  const x = rows.map((r) => models.map((m) => ((r.tokens[m] ?? 0) * base) / r.used));
  const rates = models.map(() => 1);
  const prediction = x.map((row) => row.reduce((s, n) => s + n, 0));
  const ridge = weights.reduce((s, w) => s + w, 0) * 0.001;
  for (let iteration = 0; iteration < 4000; iteration++) {
    let change = 0;
    for (let j = 0; j < models.length; j++) {
      let numerator = ridge,
        denominator = ridge;
      for (let i = 0; i < x.length; i++) {
        numerator += weights[i] * x[i][j] * (1 - prediction[i] + x[i][j] * rates[j]);
        denominator += weights[i] * x[i][j] ** 2;
      }
      const next = Math.max(0.01, numerator / denominator);
      const delta = next - rates[j];
      for (let i = 0; i < x.length; i++) prediction[i] += x[i][j] * delta;
      change = Math.max(change, Math.abs(delta));
      rates[j] = next;
    }
    if (change < 1e-9) break;
  }
  // Keep total fitted quota equal to observed quota after regularization.
  const fittedTotal = rows.reduce((s, r, i) => s + prediction[i] * r.used, 0);
  const scale = quota / fittedTotal;
  const costs = Object.fromEntries(models.map((m, i) => [m, rates[i] * base * scale]));
  const samples = rows.map((r) => ({
    actual: r.used,
    predicted: Object.entries(r.tokens).reduce((s, [m, n]) => s + n * costs[m], 0),
  }));
  return {
    costs,
    base,
    samples,
    error: Math.sqrt(samples.reduce((s, r) => s + (r.predicted - r.actual) ** 2, 0) / rows.length),
  };
}

// Accept the previous recorder response while its independent process restarts.
// Never include both representations of the same recorded tokens.
export function quotaRuns(data: PlanningData): QuotaRun[] {
  if (data.quotaRuns) return data.quotaRuns;
  return [
    ...data.cycles
      .filter((r) => !r.estimated)
      .map((r) => ({
        ...r,
        startRemaining: r.used,
        endRemaining: 0,
        exhausted: false,
        rows: [
          {
            account: r.account,
            provider: r.provider,
            model: r.model,
            input: r.tokens,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            prompt: 0,
            incomplete: 0,
            failed: 0,
            requests: 0,
          },
        ],
      })),
    ...(data.mixed ?? []).map((r) => ({
      ...r,
      intervals: r.intervals ?? 1,
      startRemaining: r.used,
      endRemaining: 0,
      exhausted: false,
    })),
  ];
}

export function calibrate(
  accounts: PlanningAccount[],
  data: PlanningData,
  usage: UsageRow[] = []
): Calibration[] {
  const batches = new Map<
    string,
    {
      account: PlanningAccount;
      window: CapacityCycle['window'];
      runs: QuotaRun[];
    }
  >();
  for (const run of quotaRuns(data)) {
    const account = accounts.find((a) => a.id === run.account);
    if (
      !account ||
      run.used <= 0 ||
      run.used > 100 ||
      run.rows.some((r) => r.incomplete) ||
      !run.rows.some((r) => total(r) > 0)
    )
      continue;
    const id = JSON.stringify([planKey(account.provider, account.terms.planType), run.window]);
    const batch = batches.get(id) ?? { account, window: run.window, runs: [] };
    batch.runs.push(run);
    batches.set(id, batch);
  }
  const result: Calibration[] = [];
  for (const { account, window, runs } of batches.values()) {
    const rows = runs.map((run) => {
      const tokens: Record<string, number> = {};
      for (const row of run.rows)
        if (total(row) > 0) tokens[row.model] = (tokens[row.model] ?? 0) + total(row);
      return { tokens, used: run.used };
    });
    const fitted = fitQuotaCosts(rows);
    const totalTokens = rows.reduce(
      (s, r) => s + Object.values(r.tokens).reduce((a, b) => a + b, 0),
      0
    );
    for (const [model, cost] of Object.entries(fitted.costs)) {
      const tokens = rows.reduce((s, r) => s + (r.tokens[model] ?? 0), 0);
      result.push({
        key: planKey(account.provider, account.terms.planType),
        provider: account.provider,
        planType: account.terms.planType,
        model,
        window,
        tokensPerQuota: 100 / cost,
        quotaPerMillion: cost * 1e6,
        tokens,
        quotaPoints: tokens * cost,
        tokenShare: tokens / totalTokens,
        observations: rows.length,
        fullRuns: runs.filter((r) => r.used >= 99.5).length,
        partialRuns: runs.filter((r) => r.used < 99.5).length,
        method: Object.keys(fitted.costs).length === 1 ? 'direct' : 'fitted',
        error: fitted.error,
        samples: fitted.samples,
      });
    }
  }
  // Sparse model traffic starts at this tier's measured average token cost.
  // Where another tier has measured that model, carry its relative model cost
  // across, scaled by this tier's own observed tokens per quota point.
  const baseRate = (rows: Calibration[]) =>
    rows.reduce((s, c) => s + (c.quotaPoints ?? 0), 0) / rows.reduce((s, c) => s + c.tokens, 0);
  const measured = [...result];
  for (const { account, window } of batches.values()) {
    const key = planKey(account.provider, account.terms.planType);
    const pool = measured.filter((c) => c.key === key && c.window === window);
    const models = new Set(
      [
        ...usage.filter((r) => r.provider === account.provider && total(r) > 0).map((r) => r.model),
        ...measured.filter((c) => c.provider === account.provider).map((c) => c.model),
      ].filter((m) => !window.startsWith('seven_day_') || m.includes(window.slice(10)))
    );
    for (const model of models) {
      if (
        account.provider === 'claude' &&
        model.includes('fable') &&
        !accounts.some(
          (a) =>
            a.provider === account.provider &&
            a.terms.planType === account.terms.planType &&
            a.quotaWindows?.includes('seven_day_fable')
        )
      )
        continue;
      if (result.some((c) => c.key === key && c.window === window && c.model === model)) continue;
      const peers = measured.filter(
        (c) => c.provider === account.provider && c.window === window && c.model === model
      );
      let ratioSum = 0,
        weight = 0;
      for (const peer of peers) {
        const peerBase = baseRate(
          measured.filter((c) => c.key === peer.key && c.window === window)
        );
        ratioSum += (100 / peer.tokensPerQuota! / peerBase) * peer.tokens;
        weight += peer.tokens;
      }
      const cost = baseRate(pool) * (weight > 0 ? ratioSum / weight : 1);
      result.push({
        ...pool[0],
        model,
        tokens: 0,
        quotaPoints: 0,
        tokenShare: 0,
        tokensPerQuota: 100 / cost,
        quotaPerMillion: cost * 1e6,
        method: 'pooled',
      });
    }
  }
  // Until a dedicated model window has dropped, use the measured shared window
  // rate for that same model. Replace it automatically as observations arrive.
  for (const w of data.windows ?? []) {
    if (!w.window.startsWith('seven_day_')) continue;
    const account = accounts.find((a) => a.id === w.account);
    if (!account) continue;
    const key = planKey(account.provider, account.terms.planType);
    for (const c of result.filter(
      (c) => c.key === key && c.window === 'seven_day' && c.model.includes(w.window.slice(10))
    )) {
      if (!result.some((r) => r.key === key && r.model === c.model && r.window === w.window))
        result.push({
          ...c,
          window: w.window,
          method: 'pooled',
          tokens: 0,
          quotaPoints: 0,
          observations: 0,
          fullRuns: 0,
          partialRuns: 0,
          samples: [],
        });
    }
  }
  return result;
}
