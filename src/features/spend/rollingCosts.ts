import { analyzeSpend, currentMonth, monthRange } from './model';
import type { SpendReport } from './types';

export interface RollingSlice {
  start: number;
  end: number;
  month: string;
  report: SpendReport;
}
export interface RollingCosts {
  now: number;
  days30: RollingSlice[];
  hours24: RollingSlice[];
}

// Split at local calendar month boundaries so each slice uses that month's plan fees.
export function rollingRanges(start: number, end: number) {
  const ranges: { start: number; end: number; month: string }[] = [];
  for (let at = start; at < end;) {
    const month = currentMonth(new Date(at));
    const next = Math.min(end, monthRange(month).end);
    ranges.push({ start: at, end: next, month });
    at = next;
  }
  return ranges;
}

/** USD per million recorded tokens, with fees allocated inside each account/month slice. */
export function subscriptionTokenCosts(slices: RollingSlice[], provider = '') {
  const models = new Map<string, { cost: number; tokens: number; incomplete: boolean }>();
  for (const slice of slices) {
    const month = monthRange(slice.month);
    // Do not charge unobserved time before this recorder existed to observed tokens.
    const observedStart = Math.max(slice.start, slice.report.createdAt);
    const fraction = Math.max(0, slice.end - observedStart) / (month.end - month.start);
    const fees = Object.fromEntries(
      Object.entries(slice.report.plans).map(([id, fee]) => [id, fee * fraction])
    );
    for (const account of analyzeSpend(slice.report.rows, fees)) {
      // Pay-as-you-go/unconfigured accounts have no subscription cost to allocate.
      if (account.fee === null || (provider && account.provider !== provider)) continue;
      for (const model of account.models) {
        const value = models.get(model.model) ?? { cost: 0, tokens: 0, incomplete: false };
        value.cost += model.allocated;
        value.tokens += model.tokens;
        value.incomplete ||= account.missing > 0 || (account.api === 0 && account.fee > 0);
        models.set(model.model, value);
      }
    }
  }
  return new Map(
    [...models].map(([model, value]) => [
      model,
      !value.incomplete && value.tokens > 0 ? (value.cost * 1_000_000) / value.tokens : null,
    ])
  );
}
