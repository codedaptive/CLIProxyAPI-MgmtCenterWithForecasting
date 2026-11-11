import { overviewTopology } from '@/features/overview/topology';
import { authFilesApi, configApi } from '@/services/api';
import { spendApi } from '@/services/api/spend';
import { collectPlanAccounts, catalogTerms } from './accountPlans';
import { currentMonth } from '@/features/spend/model';
import {
  purchaseOptions,
  DEFAULT_TAX_RATE,
  DEFAULT_PURCHASE_POLICY,
  type PlanningSettings,
} from './prices';
import { calibrate } from './calibration';
import { planningRanges, planOptions } from './model';
import { planRecordedUsage, forecastMonth } from './reconciliation';

// Explicit Calculate only. Read cached recorder data, never refresh provider quota.
export async function loadPlanning(
  apiBase: string,
  now = Date.now(),
  settings: PlanningSettings = { taxRate: DEFAULT_TAX_RATE, catalog: null }
) {
  settings = { ...DEFAULT_PURCHASE_POLICY, ...settings };
  const month = currentMonth();
  const ranges = planningRanges(now);
  const [data, report, credentials, config, ...usage] = await Promise.all([
    spendApi.planning(apiBase),
    spendApi.report(apiBase, month),
    authFilesApi.list(),
    configApi.getConfig(),
    ...ranges.map((r) => spendApi.demand(apiBase, month, (r.end - r.start) / 86400000, r.end)),
  ]);
  const files = overviewTopology(credentials.files, {}, config).files;
  const accounts = collectPlanAccounts(data, report, files, usage).map((account) => ({
    ...account,
    terms: catalogTerms(account, settings.catalog),
  }));
  const calibration = calibrate(
    accounts,
    data,
    usage.flatMap((r) => r.rows)
  );
  const forecast = forecastMonth(now);
  const existing = planOptions(accounts, forecast.end - 1, settings.individualPlansOnly);
  const options = purchaseOptions(existing, settings);
  const scenarios = ranges.map((range, i) => ({
    ...range,
    ...planRecordedUsage(
      options,
      calibration,
      usage[i],
      range.start,
      range.end,
      forecast.days,
      settings.preferFewestAccounts
    ),
  }));
  return {
    now,
    forecast,
    data,
    report,
    accounts,
    month,
    calibration,
    options,
    existing,
    scenarios,
    settings,
  };
}
export type PlanningResult = Awaited<ReturnType<typeof loadPlanning>>;
