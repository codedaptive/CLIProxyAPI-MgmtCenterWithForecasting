import { overviewTopology } from '@/features/overview/topology';
import { authFilesApi, configApi } from '@/services/api';
import { spendApi } from '@/services/api/spend';
import { accountLabel, providerOf } from '@/features/overview/model';
import type { AuthFileItem } from '@/types';
import type { SpendReport } from '@/features/spend/types';
import type { PlanningData, SubscriptionTerms } from './types';
import type { PlanningAccount } from './model';
import { providerPlans, type PlanCatalog } from './prices';

// User-defined baseline. Absence of a window only counts in an observed quota set.
export function baselinePlanName(provider: string, terms: SubscriptionTerms, windows: string[]) {
  if (provider === 'claude' && windows.includes('seven_day')) {
    if (/team|business/i.test(terms.planType))
      return windows.includes('seven_day_fable') ? 'Team Premium' : 'Team Standard';
    if (/^(?:pro|max|ultra)(?:\b|\s)/i.test(terms.planType))
      return windows.includes('five_hour') ? 'Pro' : 'Ultra';
  }
  if (provider === 'antigravity') {
    if (/^Business (Starter|Standard|Plus)$/.test(terms.planType))
      return `Google Workspace ${terms.planType}`;
    if (/^(Plus|Pro)$/.test(terms.planType)) return `Google AI ${terms.planType}`;
  }
  return terms.planType;
}

export function catalogTerms(
  account: PlanningAccount,
  catalog: PlanCatalog | null
): SubscriptionTerms {
  if (account.terms.planId) return account.terms;
  const name = baselinePlanName(account.provider, account.terms, account.quotaWindows ?? []);
  const plan = providerPlans(catalog, account.provider).find(
    (p) => p.name === name && p.cadence === account.terms.cadence
  );
  return plan ? { ...account.terms, planType: plan.name, planId: plan.id } : account.terms;
}

export function collectPlanAccounts(
  data: PlanningData,
  report: SpendReport,
  files: AuthFileItem[],
  usage: SpendReport[] = []
): PlanningAccount[] {
  const identity = (f: AuthFileItem) => String(f.authIndex ?? f.auth_index ?? '');
  const rows = [report, ...usage].flatMap((r) => r.rows);
  const ids = new Set([
    ...Object.keys(report.plans),
    ...files.map(identity),
    ...data.cycles.map((c) => c.account),
    ...(data.mixed ?? []).map((c) => c.account),
    ...rows.map((r) => r.account),
  ]);
  ids.delete('');
  return [...ids].map((id) => {
    const file = files.find((f) => identity(f) === id);
    return {
      id,
      label: report.accountLabels?.[id] ?? (file ? accountLabel(file) : id),
      provider: file
        ? providerOf(file)
        : (rows.find((r) => r.account === id)?.provider ??
          data.cycles.find((c) => c.account === id)?.provider ??
          'unknown'),
      terms: report.terms?.[id] ??
        data.terms[id] ?? { planType: 'Unclassified', cadence: 'monthly', renewalDate: null },
      fee: report.plans[id] ?? null,
      active: Boolean(file && !file.disabled),
      quotaWindows: data.windows?.filter((w) => w.account === id).map((w) => w.window),
    };
  });
}

export async function loadPlanAccounts(apiBase: string, month: string) {
  const [data, report, credentials, config] = await Promise.all([
    spendApi.planning(apiBase),
    spendApi.report(apiBase, month),
    authFilesApi.list(),
    configApi.getConfig(),
  ]);
  return collectPlanAccounts(data, report, overviewTopology(credentials.files, {}, config).files);
}
