import type { PlanCatalog } from '@/features/planning/prices';
import type { PlanningData, SubscriptionTerms } from '@/features/planning/types';
import { apiClient } from './client';
import type { SpendReport, SpendTimelineData } from '@/features/spend/types';
import type { QuotaHistory } from '@/features/spend/quotaModel';
import { rollingRanges, type RollingCosts } from '@/features/spend/rollingCosts';
import { monthRange } from '@/features/spend/model';

// MiniLLM's local recorder extension, separate from CPA's v8 API. Same configured origin only.
function endpoint(apiBase: string) {
  return new URL('/minillm/spend', apiBase).toString();
}
export interface AccountActivity {
  version: 1;
  lastUsed: Record<string, number>;
  lastPoll: number | null;
  enabled: boolean;
  error: string | null;
}
export const spendApi = {
  async planCatalog(apiBase: string): Promise<PlanCatalog> {
    const data = await apiClient.get<PlanCatalog>(endpoint(apiBase), {
      params: { view: 'plan-prices' },
    });
    if (data?.version !== 1 || !Array.isArray(data.sources))
      throw new Error('Invalid plan catalog');
    return data;
  },
  async refreshPlanPrices(apiBase: string): Promise<PlanCatalog> {
    const data = await apiClient.post<PlanCatalog>(endpoint(apiBase) + '?view=plan-prices', {});
    if (
      data?.version !== 1 ||
      !Array.isArray(data.sources) ||
      !data.checkedAt ||
      data.sources.some(
        (s) =>
          !Array.isArray(s.plans) ||
          s.plans.some(
            (p) =>
              !Number.isFinite(p.amount) ||
              p.amount <= 0 ||
              !['monthly', 'annual'].includes(p.cadence)
          )
      )
    )
      throw new Error('Invalid plan catalog');
    return data;
  },
  async planning(apiBase: string): Promise<PlanningData> {
    const data = await apiClient.get<PlanningData>(endpoint(apiBase), {
      params: { view: 'planning' },
    });
    if (data?.version !== 1 || !Array.isArray(data.cycles) || !data.terms)
      throw new Error('Planning unavailable');
    return data;
  },
  async demand(
    apiBase: string,
    month: string,
    days: number,
    now = Date.now()
  ): Promise<SpendReport> {
    const data = await apiClient.get<SpendReport>(endpoint(apiBase), {
      params: { month, start: now - days * 86400000, end: now },
    });
    if (data?.version !== 1 || !Array.isArray(data.rows) || !data.plans)
      throw new Error('Planning usage unavailable');
    return data;
  },
  async rolling(apiBase: string, now = Date.now()): Promise<RollingCosts> {
    const load = async (duration: number) =>
      Promise.all(
        rollingRanges(now - duration, now).map(async (range) => {
          const report = await apiClient.get<SpendReport>(endpoint(apiBase), { params: range });
          if (
            report?.version !== 1 ||
            report.month !== range.month ||
            !Array.isArray(report.rows) ||
            !report.plans ||
            !Number.isFinite(report.createdAt)
          )
            throw new Error('Invalid rolling spend report');
          return { ...range, report };
        })
      );
    const [days30, hours24] = await Promise.all([load(30 * 86400000), load(86400000)]);
    return { now, days30, hours24 };
  },
  async activity(apiBase: string): Promise<AccountActivity> {
    const value = await apiClient.get<AccountActivity>(endpoint(apiBase), {
      params: { view: 'activity' },
    });
    if (
      value?.version !== 1 ||
      !value.lastUsed ||
      typeof value.lastUsed !== 'object' ||
      Array.isArray(value.lastUsed) ||
      !Object.values(value.lastUsed).every((at) => Number.isSafeInteger(at) && at > 0)
    )
      throw new Error('Invalid account activity');
    return value;
  },
  async timeline(apiBase: string, month: string): Promise<SpendTimelineData> {
    const value = await apiClient.get<SpendTimelineData>(endpoint(apiBase), {
      params: { view: 'timeline', month, ...monthRange(month) },
    });
    if (
      value?.version !== 1 ||
      value.month !== month ||
      !Array.isArray(value.rows) ||
      !Array.isArray(value.recent) ||
      !Number.isFinite(value.now)
    )
      throw new Error('Invalid spend timeline');
    return value;
  },
  async quota(apiBase: string): Promise<QuotaHistory> {
    const value = await apiClient.get<QuotaHistory>(endpoint(apiBase), {
      params: { view: 'quota' },
    });
    if (value?.version !== 1 || !Array.isArray(value.samples) || !Number.isFinite(value.now))
      throw new Error('Invalid quota history');
    return value;
  },
  async report(apiBase: string, month: string): Promise<SpendReport> {
    const value = await apiClient.get<SpendReport>(endpoint(apiBase), {
      params: { month, ...monthRange(month) },
    });
    if (
      value?.version !== 1 ||
      value.month !== month ||
      !Array.isArray(value.rows) ||
      !value.plans
    ) {
      throw new Error('Spend recorder unavailable');
    }
    return value;
  },
  savePlan: (
    apiBase: string,
    month: string,
    account: string,
    amount: number | null,
    terms?: SubscriptionTerms
  ) => apiClient.put(endpoint(apiBase), { month, account, amount, terms }),
};
