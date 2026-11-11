import type { AuthFileItem } from '@/types/authFile';
import type { ResetQuotaAccount, ResetQuotaWindow } from '@/services/api/overview';
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { accountLabel, quotaFor, quotaIsStale } from './model';

export function orderedQuotaWindows(windows: ResetQuotaWindow[]) {
  const rank = (id: string) =>
    id === 'seven_day' ? 0 : id === 'five_hour' ? 1 : id === 'seven_day_fable' ? 2 : 3;
  return [...windows].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export function quotaRowState(
  file: AuthFileItem,
  quota: ResetQuotaAccount | undefined,
  now: number,
  maxAgeMs: number,
  workerFailed = false
) {
  const stale =
    !quota ||
    quotaIsStale(quota, quota.source === 'direct' ? 300000 : maxAgeMs, now) ||
    (quota.source !== 'direct' && workerFailed);
  // Model-specific limits must not make the entire account appear exhausted.
  const limits = quota?.windows.filter((w) => w.id === 'five_hour' || w.id === 'seven_day') ?? [];
  const current = limits.filter((w) => w.used !== null && (w.resetAt === null || w.resetAt > now));
  const hasQuota =
    stale || !current.length
      ? null
      : current.some((w) => w.used! >= 100)
        ? false
        : current.length === limits.length
          ? true
          : null;
  const snapshot = file.cooldownSnapshot;
  const timeout =
    snapshot?.records == null ? null : summarizeCooldowns(snapshot, now).earliestSeconds > 0;
  const reset = (id: string) =>
    quota?.windows.find((w) => w.id === id && w.resetAt !== null && w.resetAt > now)?.resetAt ??
    Infinity;
  return { hasQuota, timeout, fiveHour: reset('five_hour'), weekly: reset('seven_day') };
}

/** Request timestamps from the durable ledger, never quota/auth refresh times. */
export function accountLastUsed(file: AuthFileItem, lastUsed: Record<string, number>) {
  const at = file.authIndex == null ? undefined : lastUsed[String(file.authIndex)];
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}

export function sortQuotaAccounts(files: AuthFileItem[], accounts: ResetQuotaAccount[]) {
  return files
    .map((file) => {
      const quota = quotaFor(file, accounts);
      const reset = (id: string) => {
        const at = quota?.windows.find((w) => w.id === id)?.resetAt;
        return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : Infinity;
      };
      return { file, weekly: reset('seven_day'), fiveHour: reset('five_hour') };
    })
    .sort(
      (a, b) =>
        a.weekly - b.weekly ||
        a.fiveHour - b.fiveHour ||
        accountLabel(a.file).localeCompare(accountLabel(b.file)) ||
        a.file.name.localeCompare(b.file.name)
    )
    .map(({ file }) => file);
}
