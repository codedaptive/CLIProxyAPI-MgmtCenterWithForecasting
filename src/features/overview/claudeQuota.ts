import type { AuthFileItem, ClaudeQuotaState, Config } from '@/types';
import { overviewRouting, type ResetQuotaAccount } from '@/services/api/overview';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { providerOf, quotaFor } from './model';

// Wait for connection config before deciding who owns provider polling.
export function overviewNeedsDirectQuota(config: Config | null | undefined): boolean {
  return config != null && !overviewRouting(config).quotaPlugin;
}

export const CLAUDE_QUOTA_MAX_AGE = 5 * 60 * 1000;

export function shouldReadClaudeQuota(
  quota: ClaudeQuotaState | undefined,
  attemptedAt: number | undefined,
  now: number,
  force: boolean
) {
  if (quota?.status === 'loading') return false;
  if (force) return true;
  const observedAt = Date.parse(quota?.observedAt ?? '') || 0;
  return now - Math.max(observedAt, attemptedAt ?? 0) >= CLAUDE_QUOTA_MAX_AGE;
}

/** A post-reset read must win over the independent routing worker's older snapshot. */
export function mergeClaudeQuota(
  files: AuthFileItem[],
  accounts: ResetQuotaAccount[],
  cache: Record<string, ClaudeQuotaState>
): ResetQuotaAccount[] {
  return files.flatMap((file) => {
    const routed = quotaFor(file, accounts);
    const direct = providerOf(file) === 'claude' ? cache[getQuotaCacheKey(file)] : undefined;
    const readAt = Date.parse(direct?.observedAt ?? '');
    if (!direct || !Number.isFinite(readAt) || readAt < (routed?.readAt ?? 0)) {
      return routed ? [routed] : [];
    }
    return [
      {
        id: file.name,
        authIndex: String(file.authIndex ?? ''),
        provider: 'claude',
        planType: direct.planType ?? undefined,
        readAt,
        failures: direct.stale || direct.status === 'error' ? 1 : 0,
        source: 'direct' as const,
        windows: direct.windows.map((window) => ({
          id: window.id.replace(/-/g, '_'),
          labelKey: window.labelKey,
          used:
            window.usedPercent === null || !Number.isFinite(window.usedPercent)
              ? null
              : Math.max(0, Math.min(100, window.usedPercent)),
          resetAt: window.resetAtMs ?? null,
        })),
      },
    ];
  });
}
