import type { AuthFileItem } from '@/types';
import type { ResetQuotaAccount } from '@/services/api/overview';
import type { QuotaSample } from '@/features/spend/quotaModel';
import { quotaFor, quotaIsStale } from './model';
import { CLAUDE_QUOTA_MAX_AGE } from './claudeQuota';

/** Use the same fresh observations for the graph and account rows, including manual resets. */
export function overviewQuotaSample(
  files: AuthFileItem[],
  accounts: ResetQuotaAccount[],
  at: number,
  maxAgeMs: number,
  workerFailed = false
): QuotaSample {
  return {
    at,
    accounts: files.flatMap((file) => {
      const account = quotaFor(file, accounts);
      const id = String(file.authIndex ?? '');
      const maxAge = account?.source === 'direct' ? CLAUDE_QUOTA_MAX_AGE : maxAgeMs;
      if (
        file.disabled ||
        !id ||
        !account ||
        (account.source !== 'direct' && workerFailed) ||
        quotaIsStale(account, maxAge, at) ||
        account.readAt! > at
      )
        return [];
      // An elapsed primary reset needs a new measurement; do not imply replenishment.
      if (
        account.windows.some(
          (w) => ['seven_day', 'five_hour'].includes(w.id) && w.resetAt !== null && w.resetAt <= at
        )
      )
        return [];
      const windows = account.windows.flatMap((w) => {
        const readAt = w.readAt === undefined ? account.readAt : w.readAt;
        if (
          w.used === null ||
          w.stale ||
          readAt === null ||
          readAt > at ||
          at - readAt > maxAge ||
          (w.resetAt !== null && w.resetAt <= at)
        )
          return [];
        return [{ id: w.id, remaining: 100 - w.used, resetAt: w.resetAt, readAt }];
      });
      return windows.length
        ? [{ id, provider: account.provider, readAt: account.readAt!, windows }]
        : [];
    }),
  };
}
