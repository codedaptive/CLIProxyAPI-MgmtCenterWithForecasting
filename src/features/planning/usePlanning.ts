import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { spendApi } from '@/services/api/spend';
import { loadPlanning, type PlanningResult } from './loadPlanning';
import type { PlanningSettings } from './prices';
import type { SubscriptionTerms } from './types';

export function usePlanning() {
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setResult(null);
    setError(false);
    setLoading(false);
    setSaving(false);
    setDirty(false);
    return () => {
      generation.current += 1;
    };
  }, [apiBase, key, connected]);

  const guard = () => {
    const epoch = generation.current;
    const revision = apiClient.getConnectionRevision();
    return () => epoch === generation.current && revision === apiClient.getConnectionRevision();
  };
  const calculate = async (settings: PlanningSettings) => {
    if (!connected || busy.current) return;
    const current = guard();
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const next = await loadPlanning(apiBase, Date.now(), settings);
      if (current()) {
        setResult(next);
        setDirty(false);
      }
    } catch {
      if (current()) setError(true);
    } finally {
      if (current()) {
        busy.current = false;
        setLoading(false);
      }
    }
  };
  const savePlan = async (account: string, amount: number | null, terms: SubscriptionTerms) => {
    if (!connected || busy.current || !result) return false;
    const current = guard();
    busy.current = true;
    setSaving(true);
    try {
      await spendApi.savePlan(apiBase, result.month, account, amount, terms);
      if (!current()) return false;
      // Reflect saved contract fields, but leave the calculated comparisons frozen.
      setResult(
        (previous) =>
          previous && {
            ...previous,
            accounts: previous.accounts.map((a) =>
              a.id === account ? { ...a, fee: amount, terms } : a
            ),
          }
      );
      setDirty(true);
      return true;
    } catch {
      return false;
    } finally {
      if (current()) {
        busy.current = false;
        setSaving(false);
      }
    }
  };
  return { result, error, loading, saving, dirty, connected, calculate, savePlan };
}
