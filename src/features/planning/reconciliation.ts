import type { SpendReport } from '@/features/spend/types';
import type { Calibration } from './calibration';
import { optimizePlans, recordedDemand, type PlanOption } from './model';

export function forecastMonth(now: number) {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 2, 1);
  const days = new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate();
  return { start: start.getTime(), end: end.getTime(), days };
}

export function planRecordedUsage(
  options: PlanOption[],
  calibration: Calibration[],
  usage: SpendReport,
  start: number,
  end: number,
  monthDays: number,
  preferFewestAccounts = false
) {
  const recorded = recordedDemand(usage, start, end);
  const demand = recorded.demand.map((d) => ({
    ...d,
    perDay: d.perHour * 24,
    perWeek: d.perHour * 168,
    nextMonth: d.perHour * 24 * monthDays,
  }));
  // Every scenario forecasts a sustained daily/weekly rate. The five-hour
  // lookback is a rate sample too, not a one-off burst to buy a month of plans for.
  const result = optimizePlans(options, calibration, demand, preferFewestAccounts);
  return { ...recorded, demand, result };
}
