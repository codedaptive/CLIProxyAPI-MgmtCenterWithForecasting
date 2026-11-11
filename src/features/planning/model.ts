import solver, { type Model, type SolveResult } from 'javascript-lp-solver';
import type { SubscriptionTerms, CapacityCycle } from './types';
import type { SpendReport } from '@/features/spend/types';
import { planKey, type Calibration } from './calibration';
export const DAY = 86400000;
export const isTeamPlan = (name: string) => /\bteam\b|\bbusiness\b|\bworkspace\b/i.test(name);
export interface PlanningAccount {
  id: string;
  label: string;
  provider: string;
  terms: SubscriptionTerms;
  fee: number | null;
  active: boolean;
  quotaWindows?: CapacityCycle['window'][];
}
export function planningRanges(now: number) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return [30, 7, 0].map((days) => {
    const start = new Date(midnight);
    start.setDate(start.getDate() - days);
    return {
      id: days === 0 ? 'hours5' : days === 7 ? 'days7' : 'days30',
      start: days === 0 ? now - 5 * 3600000 : start.getTime(),
      end: days === 0 ? now : midnight.getTime(),
    };
  });
}
export interface PlanOption {
  id: string;
  key: string;
  provider: string;
  planType: string;
  cadence: SubscriptionTerms['cadence'];
  price: number | null;
  fixed: number;
  availableFixed: number;
  current: number;
  committedCost: number;
  unknownCost: boolean;
  limit?: number;
  minimum?: number;
  planIds?: string[];
  quotaWindows?: CapacityCycle['window'][];
}
export function planOptions(
  accounts: PlanningAccount[],
  now: number,
  retireTeams = false
): PlanOption[] {
  const result = new Map<string, PlanOption>();
  for (const a of accounts) {
    const expiry = a.terms.renewalDate
      ? new Date(a.terms.renewalDate + 'T23:59:59').getTime()
      : Infinity;
    const committed =
      expiry >= now &&
      (a.terms.cadence === 'annual' ||
        (retireTeams && isTeamPlan(a.terms.planType) && a.terms.renewalDate !== null));
    if (!a.active && !committed) continue;
    const key = planKey(a.provider, a.terms.planType);
    const id = JSON.stringify([key, a.terms.cadence]);
    const option = result.get(id) ?? {
      id,
      key,
      provider: a.provider,
      planType: a.terms.planType,
      cadence: a.terms.cadence,
      price: null,
      fixed: 0,
      availableFixed: 0,
      current: 0,
      committedCost: 0,
      unknownCost: false,
    };
    option.planIds = [
      ...new Set([...(option.planIds ?? []), ...(a.terms.planId ? [a.terms.planId] : [])]),
    ];
    if (a.quotaWindows?.length)
      option.quotaWindows = [...new Set([...(option.quotaWindows ?? []), ...a.quotaWindows])];
    option.current++;
    // Existing prices are candidate assumptions; use the highest entered rate, not a discount minimum.
    if (a.fee !== null) option.price = Math.max(option.price ?? 0, a.fee);
    if (committed) {
      option.fixed++;
      if (a.active) option.availableFixed++;
      option.committedCost += a.fee ?? 0;
      option.unknownCost ||= a.fee === null;
    }
    result.set(id, option);
  }
  return [...result.values()].sort(
    (a, b) => (b.price ?? -1) - (a.price ?? -1) || a.planType.localeCompare(b.planType)
  );
}
export function recordedDemand(usage: SpendReport, start: number, end: number) {
  const observedStart = Math.max(start, usage.createdAt);
  const observedEnd = Math.min(end, usage.lastPoll ?? start);
  const hours = Math.max(0, (observedEnd - observedStart) / 3600000);
  const byModel = new Map<
    string,
    { model: string; tokens: number; perHour: number; requests: number }
  >();
  for (const r of usage.rows) {
    const row = byModel.get(r.model) ?? { model: r.model, tokens: 0, perHour: 0, requests: 0 };
    row.tokens += r.input + r.output + r.cacheRead + r.cacheWrite;
    row.requests += r.requests;
    byModel.set(r.model, row);
  }
  const demand = [...byModel.values()]
    .filter((r) => r.tokens > 0)
    .map((r) => ({ ...r, perHour: hours > 0 ? r.tokens / hours : 0 }));
  const partial =
    hours <= 0 ||
    observedStart > start ||
    observedEnd < end - 60000 ||
    !usage.enabled ||
    !!usage.error ||
    usage.gaps > 0 ||
    usage.rejected > 0 ||
    usage.rows.some((r) => r.incomplete > 0);
  return { demand, hours, partial, observedStart, observedEnd };
}

export function optimizePlans(
  options: PlanOption[],
  calibration: Calibration[],
  demand: ReturnType<typeof recordedDemand>['demand'],
  preferFewestAccounts = false,
  observedHours = 168
) {
  const model: Model = {
    optimize: preferFewestAccounts ? 'accounts' : 'cost',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {},
    timeout: 1500,
  };
  const windows = [...new Set(['seven_day', 'five_hour', ...calibration.map((c) => c.window)])];
  const canAcquire = (p: PlanOption) =>
    p.limit !== 0 &&
    p.price !== null &&
    p.price > 0 &&
    !/unclassified|unconfirmed/i.test(p.planType);
  const eligible = (p: PlanOption, name: string) =>
    (p.quotaWindows?.length ? p.quotaWindows : windows)
      .filter(
        (w) =>
          !w.startsWith('seven_day_') ||
          (name.includes(w.slice(10)) &&
            (p.quotaWindows?.includes(w as CapacityCycle['window']) ||
              calibration.some((c) => c.key === p.key && c.window === w)))
      )
      .map((window) =>
        calibration.find(
          (c) =>
            c.key === p.key &&
            c.model === name &&
            c.window === window &&
            c.tokensPerQuota !== null &&
            Number.isFinite(c.tokensPerQuota) &&
            c.tokensPerQuota > 0
        )
      );
  const missing = demand
    .filter(
      (d) =>
        !options.some(
          (p) =>
            (p.availableFixed > 0 || canAcquire(p)) &&
            eligible(p, d.model).length > 0 &&
            eligible(p, d.model).every(Boolean)
        )
    )
    .map((d) => d.model);
  const committedCost = options.reduce((s, p) => s + p.committedCost, 0);
  const coveredDemand = demand.filter((d) => !missing.includes(d.model));
  const base = {
    missing,
    covered: coveredDemand.map((d) => d.model),
    committedCost,
    unknownCost: options.some((p) => p.unknownCost),
  };
  if (!coveredDemand.length || !Number.isFinite(observedHours) || observedHours <= 0)
    return { ...base, status: 'insufficient' as const, additionalCost: null, lines: [] };
  options.forEach((p, i) => {
    for (const w of windows) model.constraints[`q${i}_${w}`] = { max: p.availableFixed };
    if (canAcquire(p)) {
      model.variables[`n${i}`] = {
        cost: p.price!,
        accounts: 1,
        ...Object.fromEntries(windows.map((w) => [`q${i}_${w}`, -1])),
      };
      model.ints![`n${i}`] = 1;
      if (p.limit !== undefined) {
        model.constraints[`limit${i}`] = { max: p.limit };
        model.variables[`n${i}`][`limit${i}`] = 1;
      }
      if ((p.minimum ?? 1) > 1) {
        // Binary activation enforces either zero or the published minimum seats.
        model.binaries ??= {};
        model.binaries[`b${i}`] = 1;
        model.constraints[`min${i}`] = { max: 0 };
        model.constraints[`max${i}`] = { max: 0 };
        model.variables[`n${i}`][`min${i}`] = -1;
        model.variables[`n${i}`][`max${i}`] = 1;
        model.variables[`b${i}`] = { cost: 0, [`min${i}`]: p.minimum!, [`max${i}`]: 10000 };
        model.variables[`b${i}`][`max${i}`] = -10000;
      }
    }
  });
  coveredDemand.forEach((d, j) => {
    model.constraints[`d${j}`] = { equal: 1 };
    options.forEach((p, i) => {
      const caps = eligible(p, d.model);
      if (!caps.length || !caps.every(Boolean) || (!p.availableFixed && !model.variables[`n${i}`]))
        return;
      model.variables[`x${i}_${j}`] = {
        cost: 0,
        [`d${j}`]: 1,
        ...Object.fromEntries(
          caps.map((c) => [
            `q${i}_${c!.window}`,
            // A five-hour burst must not be projected over an entire week.
            // Longer histories are normalized to each recurring quota period;
            // billing cadence never determines the allowance duration.
            (d.perHour * Math.min(observedHours, c!.window === 'five_hour' ? 5 : 168)) /
              c!.tokensPerQuota!,
          ])
        ),
      };
    });
  });
  const started = Date.now();
  let solved = solver.Solve(model) as SolveResult;
  let limited = Date.now() - started >= 1500;
  // Independently validate the returned allocation and integer purchase counts.
  const value = (v: string) => (typeof solved[v] === 'number' ? (solved[v] as number) : 0);
  const valid = () =>
    solved.feasible &&
    solved.bounded !== false &&
    Object.keys(model.variables).every(
      (v) =>
        Number.isFinite(value(v)) &&
        value(v) >= -1e-6 &&
        (!(model.ints?.[v] || model.binaries?.[v]) ||
          Math.abs(value(v) - Math.round(value(v))) < 1e-6)
    ) &&
    Object.entries(model.constraints).every(([key, bound]) => {
      if (typeof bound === 'string') return false;
      const sum = Object.entries(model.variables).reduce(
        (s, [v, c]) => s + (c[key] ?? 0) * value(v),
        0
      );
      return (
        (bound.max === undefined || sum <= bound.max + 1e-5) &&
        (bound.equal === undefined || Math.abs(sum - bound.equal) <= 1e-5)
      );
    });
  if (!valid()) return { ...base, status: 'unsolved' as const, additionalCost: null, lines: [] };
  if (preferFewestAccounts && !limited) {
    // Lexicographic optimization: fix the minimum account count before comparing
    // prices. A dollar penalty could accidentally trade accounts for savings.
    const count = options.reduce((sum, _, i) => sum + Math.round(value(`n${i}`)), 0);
    model.constraints.accountCount = { equal: count };
    options.forEach((_, i) => {
      if (model.variables[`n${i}`]) model.variables[`n${i}`].accountCount = 1;
    });
    model.optimize = 'cost';
    const countSolution = solved;
    const secondStarted = Date.now();
    solved = solver.Solve(model) as SolveResult;
    limited = Date.now() - secondStarted >= 1500;
    if (!valid()) {
      solved = countSolution;
      limited = true;
    }
  }
  const byTier = new Map<string, PlanLine>();
  options.forEach((p, i) => {
    const flexible = Math.round(value(`n${i}`));
    const key = JSON.stringify([p.key, p.cadence]);
    const previous = byTier.get(key);
    const line = {
      ...p,
      id: previous?.id ?? p.id,
      flexible,
      total: p.fixed + flexible,
      buy: 0,
      release: null as number | null,
      cost: flexible * (p.price ?? 0) + p.committedCost,
      weeklyWindows: coveredDemand.reduce((sum, d, j) => {
        const weekly = eligible(p, d.model).find((c) => c?.window === 'seven_day');
        return (
          sum + (weekly ? (d.perHour * 168 * value(`x${i}_${j}`)) / weekly.tokensPerQuota! : 0)
        );
      }, 0),
      allocation: coveredDemand
        .map((d, j) => ({ model: d.model, perHour: d.perHour * value(`x${i}_${j}`) }))
        .filter((a) => a.perHour > 1e-6),
    };
    if (previous) {
      // Retention and new-purchase prices are separate solver variables, not
      // separate plan tiers. Keep their actual costs while merging counts.
      for (const field of [
        'current',
        'fixed',
        'availableFixed',
        'flexible',
        'total',
        'committedCost',
        'cost',
        'weeklyWindows',
      ] as const)
        line[field] += previous[field];
      line.unknownCost ||= previous.unknownCost;
      const allocated = new Map(previous.allocation.map((a) => [a.model, a.perHour]));
      for (const a of line.allocation)
        allocated.set(a.model, (allocated.get(a.model) ?? 0) + a.perHour);
      line.allocation = [...allocated].map(([model, perHour]) => ({ model, perHour }));
    }
    const existingFlexible = line.current - line.fixed;
    line.buy = Math.max(0, line.flexible - existingFlexible);
    line.release = missing.length ? null : Math.max(0, existingFlexible - line.flexible);
    byTier.set(key, line);
  });
  const lines = [...byTier.values()].filter((p) => p.total || (!missing.length && p.current));
  return {
    ...base,
    status: missing.length
      ? ('partial' as const)
      : limited
        ? ('limited' as const)
        : ('optimal' as const),
    additionalCost: lines.reduce((s, p) => s + p.cost - p.committedCost, 0),
    lines,
  };
}

interface PlanLine extends PlanOption {
  flexible: number;
  total: number;
  buy: number;
  release: number | null;
  cost: number;
  weeklyWindows: number;
  allocation: { model: string; perHour: number }[];
}
