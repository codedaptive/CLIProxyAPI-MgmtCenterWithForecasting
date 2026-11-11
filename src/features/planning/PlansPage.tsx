import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { spendApi } from '@/services/api/spend';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { MonthPicker } from '@/features/spend/MonthPicker';
import { currentMonth } from '@/features/spend/model';
import { providerLabel } from '@/features/dashboard/utils';
import { PlanSelection } from './PlanSelection';
import { loadPlanAccounts, catalogTerms } from './accountPlans';
import { DEFAULT_TAX_RATE, validTax, type PlanCatalog } from './prices';
import type { PlanningAccount } from './model';
import type { SubscriptionTerms } from './types';
import styles from '@/features/spend/SpendPage.module.scss';
import planStyles from './PlansPage.module.scss';

export function PlansPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requestedMonth = params.get('month') ?? '';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : currentMonth();
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [hideApi, setHideApi] = useLocalStorage('minillm-spend-hide-api', false);
  const [hidePlan, setHidePlan] = useLocalStorage('minillm-spend-hide-plan', false);
  const [savedTax, setSavedTax] = useLocalStorage('minillm-planning-tax', DEFAULT_TAX_RATE);
  const [tax, setTax] = useState(String(validTax(savedTax) ? savedTax : DEFAULT_TAX_RATE));
  const [accounts, setAccounts] = useState<PlanningAccount[]>([]);
  const [catalog, setCatalog] = useState<PlanCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const guard = generation;
    const epoch = ++guard.current;
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      epoch === generation.current && revision === apiClient.getConnectionRevision();
    setAccounts([]);
    setCatalog(null);
    setError(false);
    setSaved(false);
    busy.current = false;
    if (connected) {
      busy.current = true;
      setLoading(true);
      void Promise.all([loadPlanAccounts(apiBase, month), spendApi.planCatalog(apiBase)])
        .then(async ([rows, prices]) => {
          if (!current()) return;
          if (!prices.checkedAt) prices = await spendApi.refreshPlanPrices(apiBase);
          if (current()) {
            setAccounts(rows);
            setCatalog(prices);
          }
        })
        .catch(() => {
          if (current()) setError(true);
        })
        .finally(() => {
          if (current()) {
            busy.current = false;
            setLoading(false);
          }
        });
    } else setLoading(false);
    return () => {
      guard.current++;
    };
  }, [apiBase, key, connected, month]);
  const save = async (account: string, amount: number | null, terms: SubscriptionTerms) => {
    if (!connected || busy.current) return false;
    const epoch = generation.current,
      revision = apiClient.getConnectionRevision();
    busy.current = true;
    setLoading(true);
    setSaved(false);
    try {
      await spendApi.savePlan(apiBase, month, account, amount, terms);
      if (epoch !== generation.current || revision !== apiClient.getConnectionRevision())
        return false;
      setAccounts((rows) => rows.map((a) => (a.id === account ? { ...a, fee: amount, terms } : a)));
      setSaved(true);
      return true;
    } catch {
      return false;
    } finally {
      if (epoch === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  };
  const refresh = async () => {
    if (!connected || busy.current) return;
    const epoch = generation.current,
      revision = apiClient.getConnectionRevision();
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const [next, rows] = await Promise.all([
        spendApi.refreshPlanPrices(apiBase),
        loadPlanAccounts(apiBase, month),
      ]);
      if (epoch === generation.current && revision === apiClient.getConnectionRevision()) {
        setCatalog(next);
        setAccounts(rows);
      }
    } catch {
      if (epoch === generation.current) setError(true);
    } finally {
      if (epoch === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  };
  const money = (n: number) =>
    n.toLocaleString(i18n.language, { style: 'currency', currency: 'USD' });
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t('spend.plan_settings')}</h1>
        <MonthPicker value={month} onChange={(month) => setParams({ month })} />
      </header>
      <div className={styles.toolbar}>
        <Link to="/spend">{t('planning.spend_link')}</Link>
        <Link to="/planning">{t('planning.title')}</Link>
      </div>
      <p className={styles.subtitle}>{t('planning.shared_plans_hint')}</p>
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <ToggleSwitch checked={hideApi} onChange={setHideApi} label={t('spend.hide_api')} />
          <ToggleSwitch checked={hidePlan} onChange={setHidePlan} label={t('spend.hide_plan')} />
        </div>
        <div className={styles.controls}>
          <Button
            variant="secondary"
            disabled={!connected || loading}
            onClick={() => void refresh()}
          >
            {t('planning.refresh_prices')}
          </Button>
          <label>
            {t('planning.tax_rate')}
            <input
              aria-label={t('planning.tax_rate')}
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={tax}
              onChange={(e) => {
                setTax(e.target.value);
                if (validTax(e.target.value)) setSavedTax(Number(e.target.value));
              }}
            />
          </label>
        </div>
        {!validTax(tax) && <p role="alert">{t('planning.invalid_tax')}</p>}
        {catalog && (
          <details>
            <summary>
              {t('planning.published_prices')} ·{' '}
              {catalog.checkedAt ? new Date(catalog.checkedAt).toLocaleString(i18n.language) : '—'}
            </summary>
            <p>{t('planning.catalog_price_hint')}</p>
            {catalog.sources.map((source) => (
              <div key={source.url}>
                <h3>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.provider === 'antigravity'
                      ? 'Google Gemini'
                      : providerLabel(source.provider, source.provider)}
                  </a>
                </h3>
                {source.status !== 'ok' && <p>{t('planning.source_unavailable')}</p>}
                {source.plans.map((p) => (
                  <p key={p.id}>
                    {p.name} · {t(`planning.${p.cadence}`)} · {money(p.amount)}{' '}
                    {t('planning.monthly_equivalent')}
                  </p>
                ))}
              </div>
            ))}
          </details>
        )}
      </section>
      {error && <p role="alert">{t('planning.unavailable')}</p>}
      {saved && <p role="status">{t('planning.saved')}</p>}
      {loading && <p role="status">{t('spend.loading')}</p>}
      <section className={`${styles.panel} ${planStyles.accounts}`}>
        <h2>{t('planning.contracts')}</h2>
        <p className={styles.subtitle}>{t('planning.selection_hint')}</p>
        {accounts.map((a) => (
          <div key={a.id} className={planStyles.accountRow}>
            <div className={planStyles.identity}>
              <span className={planStyles.provider}>
                {a.provider === 'antigravity'
                  ? 'Google Gemini (Antigravity)'
                  : providerLabel(a.provider, a.provider)}
              </span>
              <strong>{a.label}</strong>
              {!a.active && <span className={planStyles.inactive}>{t('planning.inactive')}</span>}
            </div>
            <PlanSelection
              key={`${month}:${a.id}:${JSON.stringify(a.terms)}`}
              terms={catalogTerms(a, catalog)}
              provider={a.provider}
              catalog={catalog}
              taxRate={Number(tax)}
              label={a.label}
              disabled={loading}
              save={(amount, terms) => save(a.id, amount, terms)}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
