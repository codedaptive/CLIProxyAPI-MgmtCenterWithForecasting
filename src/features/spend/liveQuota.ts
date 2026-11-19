import type { QuotaHistory, QuotaSample } from './quotaModel';

/** Overlay live measurements without rewriting recorded history or inventing burn samples. */
export function withLiveQuota(history: QuotaHistory, live?: QuotaSample): QuotaHistory {
  if (!live || history.now - live.at > 5 * 60000) return history;
  const last = history.samples[history.samples.length - 1];
  const at = Math.max(history.now, live.at);
  const accounts = live.accounts.map((account) => {
    const recorded = last?.accounts.find((a) => a.id === account.id);
    if (!recorded) return account;
    // A newer complete snapshot also controls which windows still exist.
    const base = recorded.readAt > account.readAt ? recorded : account;
    const other = base === recorded ? account : recorded;
    return {
      ...base,
      windows: base.windows.map((window) => {
        const candidate = other.windows.find((w) => w.id === window.id);
        return candidate && (candidate.readAt ?? other.readAt) > (window.readAt ?? base.readAt)
          ? candidate
          : window;
      }),
    };
  });
  return {
    ...history,
    now: at,
    samples: [...history.samples.filter((s) => s.at < at), { at, accounts }],
  };
}
