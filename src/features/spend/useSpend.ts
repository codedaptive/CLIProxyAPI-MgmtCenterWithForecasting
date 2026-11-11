import type { SubscriptionTerms } from '@/features/planning/types';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { spendApi } from '@/services/api/spend';
import type { SpendReport } from './types';

export function useSpend(month: string) {
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [report, setReport] = useState<SpendReport | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const refreshRef = useRef(async () => {});
  const saveRef = useRef(
    async (_account: string, _amount: number | null, _terms?: SubscriptionTerms) => false
  );
  useEffect(() => {
    let writeRevision = 0;
    let active = true,
      busy = false;
    const revision = apiClient.getConnectionRevision();
    const current = () => active && apiClient.getConnectionRevision() === revision;
    setReport(null);
    setError(false);
    const refresh = async () => {
      if (!connected || busy || !current()) return;
      busy = true;
      const writeAtStart = writeRevision;
      setLoading(true);
      try {
        const result = await spendApi.report(apiBase, month);
        if (current() && writeAtStart === writeRevision) {
          setReport(result);
          setError(false);
        }
      } catch {
        if (current()) setError(true);
      } finally {
        busy = false;
        if (current()) setLoading(false);
      }
    };
    refreshRef.current = refresh;
    saveRef.current = async (account, amount, terms) => {
      if (!connected || !current()) return false;
      try {
        writeRevision += 1;
        await spendApi.savePlan(apiBase, month, account, amount, terms);
        if (!current()) return false;
        // Preserve any in-flight report refresh, then load the committed settings.
        const result = await spendApi.report(apiBase, month);
        if (!current()) return false;
        setReport(result);
        return true;
      } catch {
        return false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiBase, key, connected, month]);
  return {
    report,
    error,
    loading,
    refresh: () => refreshRef.current(),
    savePlan: (account: string, amount: number | null, terms?: SubscriptionTerms) =>
      saveRef.current(account, amount, terms),
  };
}
