import { useCallback, useEffect, useRef } from 'react';
import type { AuthFileItem } from '@/types';
import { apiClient } from '@/services/api/client';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { shouldReadClaudeQuota } from './claudeQuota';

export function useOverviewClaudeQuota(
  files: AuthFileItem[],
  connected: boolean,
  directReadsEnabled: boolean
) {
  const cache = useQuotaStore((state) => state.claudeQuota);
  const { loadQuota, batchLoading } = useQuotaBatchLoader();
  const attempts = useRef(new Map<string, number>());
  const busy = useRef(false);
  const refresh = useCallback(
    async (force = true) => {
      if (!connected || !directReadsEnabled || busy.current) return;
      const revision = apiClient.getConnectionRevision();
      const current = () => revision === apiClient.getConnectionRevision();
      const targets = files.filter(
        (file) =>
          CLAUDE_CONFIG.filterFn(file) &&
          shouldReadClaudeQuota(
            useQuotaStore.getState().claudeQuota[getQuotaCacheKey(file)],
            attempts.current.get(`${revision}:${getQuotaCacheKey(file)}`),
            Date.now(),
            force
          )
      );
      busy.current = true;
      try {
        // Bound provider reads; share the Quota page's cache and mutation/session guards.
        for (let i = 0; i < targets.length; i += 2) {
          if (!current()) return;
          const batch = targets.slice(i, i + 2);
          batch.forEach((file) =>
            attempts.current.set(`${revision}:${getQuotaCacheKey(file)}`, Date.now())
          );
          await loadQuota(batch.map((file) => ({ file, type: 'claude' as const })));
        }
      } finally {
        busy.current = false;
      }
    },
    [files, connected, directReadsEnabled, loadQuota]
  );

  useEffect(() => {
    // The router already polls centrally; browser tabs must not duplicate those reads.
    if (!directReadsEnabled) return;
    if (document.visibilityState === 'visible') void refresh(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(false);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh, directReadsEnabled]);

  return { cache, loading: batchLoading, refresh };
}
