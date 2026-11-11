import { useState } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { spendApi } from '@/services/api/spend';
import { DEFAULT_TAX_RATE, validTax } from './prices';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { providerLabel } from '@/features/dashboard/utils';
import { usePlanning } from './usePlanning';
import shared from '@/features/spend/SpendPage.module.scss';
import styles from './PlanningPage.module.scss';
import { CalibrationDetails } from './CalibrationDetails';

export function PlanningPage() {
  const { t, i18n } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const [savedTax] = useLocalStorage('minillm-planning-tax', DEFAULT_TAX_RATE);
  const tax = validTax(savedTax) ? savedTax : DEFAULT_TAX_RATE;
  const [refreshing, setRefreshing] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const { result, error, loading, connected, calculate } = usePlanning();
  const number = (n: number | null) =>
    n === null ? '—' : n.toLocaleString(i18n.language, { maximumFractionDigits: 0 });
  const money = (n: number | null) =>
    n === null
      ? '—'
      : n.toLocaleString(i18n.language, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 2,
        });
  const date = (at: number) => new Date(at).toLocaleString(i18n.language);
  const planName = (p: { provider: string; planType: string }) =>
    `${providerLabel(p.provider, p.provider)} · ${p.planType}`;
  return (
    <div className={shared.page}>
      <header className={shared.header}>
        <h1>{t('planning.title')}</h1>
        <Button
          variant="secondary"
          disabled={!connected || loading || refreshing || !validTax(tax)}
          onClick={async () => {
            const revision = apiClient.getConnectionRevision();
            setRefreshing(true);
            setPriceError(false);
            try {
              let catalog = await spendApi.planCatalog(apiBase);
              if (!catalog.checkedAt) catalog = await spendApi.refreshPlanPrices(apiBase);
              if (revision === apiClient.getConnectionRevision())
                await calculate({ taxRate: Number(tax), catalog });
            } catch {
              if (revision === apiClient.getConnectionRevision()) setPriceError(true);
            } finally {
              setRefreshing(false);
            }
          }}
        >
          {t(loading ? 'planning.calculating' : 'planning.calculate')}
        </Button>
      </header>
      <p className={shared.subtitle}>{t('planning.forecast_intro')}</p>
      <div className={shared.toolbar}>
        <Link to="/plans">{t('spend.plan_settings')}</Link>
      </div>
      {priceError && <p role="alert">{t('planning.price_error')}</p>}
      <Link to="/spend">{t('planning.spend_link')}</Link>
      {error && (
        <p role="alert" className={shared.notice}>
          {t('planning.unavailable')}
        </p>
      )}
      {!result && !error && (
        <p role="status">{t(loading ? 'planning.calculating' : 'planning.optimizer_idle')}</p>
      )}
      {result && (
        <>
          <p role="status" className={shared.subtitle}>
            {t('planning.forecast_for', {
              month: new Date(result.forecast.start).toLocaleDateString(i18n.language, {
                month: 'long',
                year: 'numeric',
              }),
            })}
            {' · '}
            {t('planning.snapshot', { time: date(result.now) })}
          </p>
          {result.scenarios.map((s) => (
            <section className={shared.panel} key={s.id}>
              <h2>{t(`planning.rate_${s.id}`)}</h2>
              <p>
                {date(s.start)} → {date(s.end)}
              </p>
              {s.result.additionalCost !== null && (
                <>
                  <p>
                    <strong>
                      {t('planning.flexible_cost')}: {money(s.result.additionalCost)}
                    </strong>{' '}
                    · {t('planning.forecast_total')}:{' '}
                    {s.result.unknownCost
                      ? '—'
                      : money(s.result.committedCost + s.result.additionalCost)}
                  </p>
                  <div
                    className={shared.tableScroll}
                    tabIndex={0}
                    role="region"
                    aria-label={t('planning.recommendations')}
                  >
                    <table>
                      <thead>
                        <tr>
                          {[
                            'plan_type',
                            'fixed',
                            'total',
                            'buy',
                            'weekly_windows',
                            'monthly_cost',
                          ].map((k) => (
                            <th key={k}>{t(`planning.${k}`)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.result.lines
                          .filter((p) => p.total > 0)
                          .map((p) => (
                            <tr key={p.id}>
                              <td>{planName(p)}</td>
                              <td>{p.fixed}</td>
                              <td>{p.total}</td>
                              <td>{p.buy}</td>
                              <td>{p.weeklyWindows.toFixed(2)}</td>
                              <td>{p.unknownCost ? '—' : money(p.cost)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {s.result.additionalCost === null && <p>{t('planning.no_forecast_data')}</p>}
              <details className={styles.modelDemand}>
                <summary>{t('planning.actual_by_model')}</summary>
                <div
                  className={shared.tableScroll}
                  tabIndex={0}
                  role="region"
                  aria-label={t('planning.actual_by_model')}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>{t('planning.model')}</th>
                        <th>{t('planning.recorded_tokens')}</th>
                        <th>{t('planning.tokens_day')}</th>
                        <th>{t('planning.tokens_week')}</th>
                        <th>{t('planning.tokens_forecast')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.demand.map((d) => (
                        <tr key={d.model}>
                          <td>{d.model}</td>
                          <td>{number(d.tokens)}</td>
                          <td>{number(d.perDay)}</td>
                          <td>{number(d.perWeek)}</td>
                          <td>{number(d.nextMonth)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          ))}
          <CalibrationDetails result={result} />
        </>
      )}
    </div>
  );
}
