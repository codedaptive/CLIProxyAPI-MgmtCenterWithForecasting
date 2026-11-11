import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores';
import { authFilesApi, configApi } from '@/services/api';
import { apiKeyUsageApi } from '@/services/api/apiKeyUsage';
import { apiClient } from '@/services/api/client';
import { overviewApi, overviewRouting, type ResetRouterStatus } from '@/services/api/overview';
import type { Config } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { ApiKeyUsageResponse } from '@/utils/recentRequests';
import { sessionMatches, providerOf } from './model';
import { readClaudePlan } from './plans';
import { spendApi } from '@/services/api/spend';

export interface OverviewSnapshot {
  files: AuthFileItem[];
  usage: ApiKeyUsageResponse;
  config: Config | null;
  quota: ResetRouterStatus | null;
  models: Record<string, string[]>;
  errors: string[];
  readAt: number;
  plans: Record<string, string | null>;
  lastUsed: Record<string, number>;
}
export function useOverview() {
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    let busy = false;
    let topologyAt = 0;
    let plansLoading = false;
    const planTimes: Record<string, number> = {};
    const plans: Record<string, string | null> = {};
    let models: Record<string, string[]> = {};
    let lastUsed: Record<string, number> = {};
    let config: Config | null = null;
    let topologyErrors: string[] = [];
    const revision = apiClient.getConnectionRevision();
    const current = () => sessionMatches(revision, apiClient.getConnectionRevision(), active);
    setSnapshot(null);
    const refresh = async () => {
      if (!connected || busy || !current()) return;
      busy = true;
      setLoading(true);
      try {
        const errors: string[] = [];
        const [filesResult, usageResult, activityResult] = await Promise.allSettled([
          authFilesApi.list(),
          apiKeyUsageApi.getUsage(),
          spendApi.activity(apiBase),
        ]);
        if (!current()) return;
        if (activityResult.status === 'fulfilled') {
          const activity = activityResult.value;
          lastUsed = activity.lastUsed;
          if (
            !activity.enabled ||
            activity.error ||
            !activity.lastPoll ||
            Date.now() - activity.lastPoll > 60000
          )
            errors.push('activity');
        } else errors.push('activity');
        if (filesResult.status === 'rejected') errors.push('credentials');
        if (usageResult.status === 'rejected') errors.push('traffic');
        const files = filesResult.status === 'fulfilled' ? filesResult.value.files : [];
        const usage = usageResult.status === 'fulfilled' ? usageResult.value : {};
        if (
          !topologyAt ||
          Date.now() - topologyAt > 120000 ||
          files.some((f) => !(f.name in models))
        ) {
          topologyErrors = [];
          try {
            config = await configApi.getConfig();
          } catch {
            config = null;
            topologyErrors.push('routing');
          }
          if (!current()) return;
          const next: Record<string, string[]> = {};
          // Bound local API concurrency; no inference requests or provider quota refreshes.
          for (let i = 0; i < files.length; i += 4) {
            const batch = files.slice(i, i + 4);
            const results = await Promise.allSettled(
              batch.map((f) => authFilesApi.getModelsForAuthFile(f.name))
            );
            if (!current()) return;
            results.forEach((result, index) => {
              if (result.status === 'fulfilled')
                next[batch[index].name] = result.value.map((m) => m.id);
              else if (!topologyErrors.includes('models')) topologyErrors.push('models');
            });
          }
          models = next;
          topologyAt = Date.now();
        }
        errors.push(...topologyErrors);
        let quota: ResetRouterStatus | null = null;
        if (overviewRouting(config).quotaPlugin) {
          try {
            quota = await overviewApi.resetRouterStatus(apiBase, config);
          } catch {
            errors.push('quota');
          }
        }
        if (!current()) return;
        setSnapshot({
          files,
          lastUsed,
          usage,
          config,
          quota,
          models,
          errors,
          readAt: Date.now(),
          plans: { ...plans },
        });
        if (!plansLoading) {
          const pending = files.filter(
            (f) =>
              providerOf(f) === 'claude' &&
              !f.disabled &&
              (!planTimes[f.name] || Date.now() - planTimes[f.name] > 30 * 60 * 1000)
          );
          if (pending.length) {
            plansLoading = true;
            void (async () => {
              try {
                for (let i = 0; i < pending.length; i += 2) {
                  if (!current()) return;
                  const batch = pending.slice(i, i + 2);
                  const results = await Promise.allSettled(batch.map(readClaudePlan));
                  if (!current()) return;
                  results.forEach((result, index) => {
                    const name = batch[index].name;
                    planTimes[name] = Date.now();
                    plans[name] = result.status === 'fulfilled' ? result.value : null;
                  });
                  setSnapshot((previous) =>
                    previous ? { ...previous, plans: { ...plans } } : previous
                  );
                }
              } finally {
                plansLoading = false;
              }
            })();
          }
        }
      } finally {
        busy = false;
        if (current()) setLoading(false);
      }
    };
    refreshRef.current = async () => {
      topologyAt = 0;
      await refresh();
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiBase, key, connected]);
  return { snapshot, loading, connected, refresh: () => refreshRef.current() };
}
