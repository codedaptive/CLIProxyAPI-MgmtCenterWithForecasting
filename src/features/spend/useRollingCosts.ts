import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { spendApi } from '@/services/api/spend';
import type { SpendReport } from './types';
import type { RollingCosts } from './rollingCosts';

export function useRollingCosts(report: SpendReport | null) {
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [data, setData] = useState<RollingCosts | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const revision = apiClient.getConnectionRevision();
    const current = () => active && apiClient.getConnectionRevision() === revision;
    setData(null);
    setError(false);
    if (connected && report) {
      void spendApi.rolling(apiBase).then(
        (value) => {
          if (current()) setData(value);
        },
        () => {
          if (current()) setError(true);
        }
      );
    }
    return () => {
      active = false;
    };
  }, [apiBase, key, connected, report]);
  return { data, error };
}
