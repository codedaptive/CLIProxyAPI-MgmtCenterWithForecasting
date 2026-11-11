import type { AuthFileItem } from '@/types/authFile';
import type { ApiKeyUsageResponse, RecentRequestBucket } from '@/utils/recentRequests';
import {
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestUsageEntry,
} from '@/utils/recentRequests';
import type { TrafficWindow } from '@/features/dashboard/types';
import type { ResetQuotaAccount } from '@/services/api/overview';

export const providerOf = (file: AuthFileItem) => String(file.type || file.provider || 'unknown');
// Never display `account`: for API-key credentials it contains the secret itself.
export const accountLabel = (file: AuthFileItem) => file.note || file.email || file.name;
export function summarizeTraffic(
  files: AuthFileItem[],
  usage: ApiKeyUsageResponse,
  provider: string
): TrafficWindow {
  const groups: RecentRequestBucket[][] = [];
  const keys = new Set<string>();
  Object.entries(usage).forEach(([id, entries]) => {
    if (provider && provider !== id) return;
    Object.entries(entries).forEach(([key, entry]) => {
      const split = key.indexOf('|');
      if (split >= 0) keys.add(key.slice(split + 1));
      groups.push(normalizeRecentRequestUsageEntry(entry).recentRequests);
    });
  });
  files.forEach((file) => {
    if (provider && providerOf(file) !== provider) return;
    if (
      file.account_type === 'api_key' &&
      typeof file.account === 'string' &&
      keys.has(file.account)
    )
      return;
    groups.push(file.recentRequests ?? []);
  });
  const buckets = mergeRecentRequestBucketGroups(groups);
  const totalSuccess = buckets.reduce((sum, b) => sum + b.success, 0);
  const totalFailure = buckets.reduce((sum, b) => sum + b.failed, 0);
  const total = totalSuccess + totalFailure;
  const peakTotal = Math.max(0, ...buckets.map((b) => b.success + b.failed));
  return {
    buckets,
    totalSuccess,
    totalFailure,
    total,
    successRate: total ? (totalSuccess / total) * 100 : null,
    peakTotal,
    peakIndex: peakTotal ? buckets.findIndex((b) => b.success + b.failed === peakTotal) : -1,
    windowMinutes: buckets.length * 10,
  };
}
export function quotaFor(file: AuthFileItem, accounts: ResetQuotaAccount[]) {
  return accounts.find(
    (a) =>
      (a.authIndex && a.authIndex === String(file.authIndex)) ||
      a.id === file.name ||
      a.id === file.id
  );
}
export function quotaIsStale(account: ResetQuotaAccount, maxAgeMs: number, now: number) {
  return (
    account.failures > 0 || !account.readAt || maxAgeMs <= 0 || now - account.readAt > maxAgeMs
  );
}
export function nextReset(account: ResetQuotaAccount | undefined, now: number): number {
  return Math.min(
    ...(account?.windows.flatMap((w) => (w.resetAt && w.resetAt > now ? [w.resetAt] : [])) ?? [])
  );
}
export function sessionMatches(revision: number, current: number, active: boolean) {
  return active && revision === current;
}
