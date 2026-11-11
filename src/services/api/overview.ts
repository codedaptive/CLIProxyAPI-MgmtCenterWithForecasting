import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import type { Config } from '@/types';

export interface ResetQuotaWindow {
  id: string;
  labelKey?: string;
  used: number | null;
  resetAt: number | null;
}
export interface ResetQuotaAccount {
  id: string;
  authIndex: string;
  provider: string;
  planType?: string;
  readAt: number | null;
  failures: number;
  windows: ResetQuotaWindow[];
  source?: 'direct';
}
export interface ResetRouterStatus {
  mode: string;
  maxAgeMs: number;
  workerFailed: boolean;
  lastAccount: string;
  lastReason: string;
  accounts: ResetQuotaAccount[];
}
const dateMs = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
export function parseDuration(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d+)?(?:ms|h|m|s))+$/.test(value)) return 0;
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)].reduce(
    (sum, [, n, unit]) => sum + Number(n) * ({ h: 3600000, m: 60000, s: 1000, ms: 1 }[unit] ?? 0),
    0
  );
}
export function normalizeResetRouterStatus(raw: unknown): ResetRouterStatus {
  if (!isRecord(raw) || !isRecord(raw.accounts)) throw new Error('Invalid quota snapshot');
  const decision = isRecord(raw.last_decision) ? raw.last_decision : {};
  return {
    mode: typeof raw.mode === 'string' ? raw.mode : 'unknown',
    maxAgeMs: parseDuration(raw.max_age),
    workerFailed: raw.worker_failed === true,
    lastAccount: typeof decision.auth_id === 'string' ? decision.auth_id : '',
    lastReason: typeof decision.reason === 'string' ? decision.reason : '',
    accounts: Object.entries(raw.accounts).flatMap(([id, value]) => {
      if (!isRecord(value)) return [];
      const quota = isRecord(value.quota) ? value.quota : {};
      return [
        {
          id,
          authIndex: typeof value.auth_index === 'string' ? value.auth_index : '',
          provider: typeof value.provider === 'string' ? value.provider : 'unknown',
          planType: typeof quota.plan_type === 'string' ? quota.plan_type : undefined,
          readAt: dateMs(quota.read_at),
          failures: typeof value.consecutive_failures === 'number' ? value.consecutive_failures : 0,
          windows: Object.entries(quota).flatMap(([key, window]) => {
            if (!isRecord(window) || !('utilization' in window)) return [];
            const used = window.utilization;
            return [
              {
                id: key,
                used:
                  typeof used === 'number' && Number.isFinite(used)
                    ? Math.max(0, Math.min(100, used))
                    : null,
                resetAt: dateMs(window.resets_at),
              },
            ];
          }),
        },
      ];
    }),
  };
}
// The richer router keeps quota windows on /accounts; /status contains only a summary.
export function normalizeKpatdevQuota(status: unknown, detail: unknown): ResetRouterStatus {
  const result = normalizeResetRouterStatus(status);
  if (!isRecord(detail) || !Array.isArray(detail.accounts))
    throw new Error('Invalid quota accounts');
  result.accounts = detail.accounts.flatMap((account) => {
    if (!isRecord(account) || typeof account.id !== 'string' || !Array.isArray(account.windows))
      return [];
    const windows = account.windows.filter(isRecord);
    const observations = windows
      .map((w) => dateMs(w.observed_at))
      .filter((n): n is number => n !== null);
    return [
      {
        id: account.id,
        authIndex: '',
        provider: typeof account.provider === 'string' ? account.provider : 'unknown',
        planType: typeof account.plan === 'string' ? account.plan : undefined,
        readAt: observations.length ? Math.min(...observations) : null,
        failures: account.poll_error || windows.some((w) => w.stale === true) ? 1 : 0,
        windows: windows.map((w) => ({
          id:
            w.kind === 'weekly'
              ? 'seven_day'
              : w.kind === 'model_weekly'
                ? `seven_day_${String(w.family)}`
                : String(w.key),
          used:
            typeof w.used_percent === 'number' && Number.isFinite(w.used_percent)
              ? Math.max(0, Math.min(100, w.used_percent))
              : null,
          resetAt: dateMs(w.resets_at),
        })),
      },
    ];
  });
  return result;
}
export function quotaRouterId(config: Config | null) {
  const plugins = config?.raw?.plugins;
  if (!isRecord(plugins) || plugins.enabled !== true || !isRecord(plugins.configs)) return null;
  const configs = plugins.configs;
  return (
    (['kpatdev-quota-router', 'quota-reset-router'] as const).find(
      (id) => isRecord(configs[id]) && configs[id].enabled === true
    ) ?? null
  );
}
export function overviewRouting(config: Config | null) {
  const raw = config?.raw;
  const routing = isRecord(raw?.routing) ? raw.routing : {};
  return {
    affinity: typeof routing['session-affinity'] === 'boolean' ? routing['session-affinity'] : null,
    quotaPlugin: quotaRouterId(config) !== null,
  };
}
export const overviewApi = {
  async resetRouterStatus(apiBase: string, config: Config | null): Promise<ResetRouterStatus> {
    // This is the plugin's declared custom extension, not a legacy core API fallback.
    // Derive the URL from the authenticated connection; never from plugin-supplied URLs.
    const pluginId = quotaRouterId(config);
    if (!pluginId) throw new Error('Quota router is disabled');
    const base = apiBase.replace(/\/+$/, '').replace(/\/v8\/management$/, '');
    const raw = await apiClient.get<unknown>(`${base}/v0/management/plugins/${pluginId}/status`, {
      timeout: 10000,
    });
    if (pluginId === 'kpatdev-quota-router') {
      const detail = await apiClient.get<unknown>(
        `${base}/v0/management/plugins/${pluginId}/accounts`,
        { timeout: 10000 }
      );
      return normalizeKpatdevQuota(raw, detail);
    }
    return normalizeResetRouterStatus(raw);
  },
};
