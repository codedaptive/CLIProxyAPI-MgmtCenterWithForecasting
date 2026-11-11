import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { MonthPicker } from './MonthPicker';
import { SpendTimeline } from './SpendTimeline';
import { spendCsv } from './export';
import { downloadBlob } from '@/utils/download';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useOverview } from '@/features/overview/useOverview';
import { accountLabel, providerOf, quotaFor } from '@/features/overview/model';
import { overviewPlanLabel } from '@/features/overview/plans';
import { providerLabel } from '@/features/dashboard/utils';
import { useRollingCosts } from './useRollingCosts';
import { subscriptionTokenCosts } from './rollingCosts';
import { useSpend } from './useSpend';
import { analyzeSpend, currentMonth, rollup, type ModelSpend } from './model';
import { ModelSpendRows } from './ModelSpendRows';
import {
  TERRA_RATE_DATE,
  DEEPSEEK_RATE_DATE,
  GLM_RATE_DATE,
  QWEN_RATE_DATE,
  IMAGE_RATE_DATE,
  RATE_DATE,
  RATE_SOURCES,
  TOKEN_RATES,
} from './rates';
import styles from './SpendPage.module.scss';

export function SpendPage() {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(currentMonth);
  const now = useNow();
  const [provider, setProvider] = useState('');
  const [hideApi] = useLocalStorage('minillm-spend-hide-api', false);
  const [hidePlan] = useLocalStorage('minillm-spend-hide-plan', false);
  const { report, error, loading, refresh } = useSpend(month);
  const rolling = useRollingCosts(report);
  const rolling30 = useMemo(
    () => subscriptionTokenCosts(rolling.data?.days30 ?? [], provider),
    [rolling.data, provider]
  );
  const rolling24 = useMemo(
    () => subscriptionTokenCosts(rolling.data?.hours24 ?? [], provider),
    [rolling.data, provider]
  );
  const partialRolling = rolling.data?.days30.some((slice) => slice.report.createdAt > slice.start);
  const { snapshot } = useOverview();
  const files = snapshot?.files ?? [];
  const analyzed = useMemo(() => analyzeSpend(report?.rows ?? [], report?.plans ?? {}), [report]);
  const accounts = [...analyzed];
  const accountIds = new Set(accounts.map((a) => a.id));
  // Include plans awaiting their first recorded request; their fee remains unallocated.
  for (const file of files) {
    const id = String(file.auth_index ?? '');
    if (
      !id ||
      accountIds.has(id) ||
      (file.disabled && !Object.prototype.hasOwnProperty.call(report?.plans ?? {}, id))
    )
      continue;
    accounts.push({
      id,
      provider: providerOf(file),
      api: 0,
      missing: 0,
      fee: report?.plans[id] ?? null,
      allocated: 0,
      models: [],
    });
    accountIds.add(id);
  }
  for (const [id, fee] of Object.entries(report?.plans ?? {})) {
    if (!accountIds.has(id))
      accounts.push({
        id,
        provider: 'unknown',
        api: 0,
        missing: 0,
        fee,
        allocated: 0,
        models: [],
      });
  }
  const displayProvider = (id: string) => report?.providerLabels?.[id] ?? providerLabel(id, id);
  const providers = [...new Set(accounts.map((a) => a.provider))].sort();
  const filtered = accounts.filter((a) => !provider || a.provider === provider);
  const total = rollup(filtered);
  const budget = filtered.reduce((sum, a) => sum + (a.fee ?? 0), 0);
  const money = (v: number) =>
    v.toLocaleString(i18n.language, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
  const date = (v: number) =>
    new Date(v).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const modelTable = (models: ModelSpend[], account = false, tokenCosts = false) => (
    <div
      className={styles.tableScroll}
      tabIndex={0}
      role="region"
      aria-label={t('spend.model_breakdown')}
    >
      <table>
        <thead>
          <tr>
            {[
              'model',
              'tokens',
              ...(tokenCosts && !hideApi ? ['token_list'] : []),
              ...(tokenCosts && !hidePlan ? ['token_sub_30d', 'token_sub_24h'] : []),
              ...(!hideApi ? ['api_cost'] : []),
              ...(!hidePlan ? [account ? 'account_share' : 'allocated_share', 'allocated'] : []),
            ].map((key) => (
              <th key={key}>{t(`spend.${key}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <ModelSpendRows
              key={m.model}
              model={m}
              hideApi={hideApi}
              hidePlan={hidePlan}
              tokenCosts={
                tokenCosts
                  ? {
                      days30: rolling30.get(m.model) ?? null,
                      hours24: rolling24.get(m.model) ?? null,
                    }
                  : undefined
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t('spend.title')}</h1>
        <div className={styles.controls}>
          <MonthPicker value={month} onChange={setMonth} />
          <label>
            {t('spend.provider')}
            <select
              aria-label={t('spend.provider')}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">{t('spend.all')}</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {displayProvider(p)}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" disabled={loading} onClick={() => void refresh()}>
            {t('spend.refresh')}
          </Button>
        </div>
      </header>
      <div className={styles.toolbar}>
        <Link to={`/plans?month=${month}`}>{t('spend.plan_settings')}</Link>
        <Button
          variant="secondary"
          disabled={!report || loading}
          title={t('spend.export_hint')}
          onClick={() =>
            downloadBlob({
              filename: `minillm-spend-${month}${provider ? '-' + provider.replace(/[^a-z0-9-]/gi, '_') : ''}.csv`,
              blob: new Blob([spendCsv(month, filtered)], { type: 'text/csv;charset=utf-8' }),
            })
          }
        >
          {t('spend.export')}
        </Button>
      </div>
      <p className={styles.subtitle}>{t('spend.subtitle')}</p>
      <SpendTimeline month={month} provider={provider} hideApi={hideApi} />
      {error && (
        <div className={styles.notice} role="alert">
          {t('spend.unavailable')}
        </div>
      )}
      {report && (
        <div className={styles.notice} role="status">
          <strong>{t(report.enabled ? 'spend.recording' : 'spend.disabled')}</strong>
          <span>{t('spend.coverage', { time: date(report.createdAt) })}</span>
          <span>{t('spend.observed_only')}</span>
          {(report.error ||
            !report.lastPoll ||
            now - report.lastPoll > 60000 ||
            report.gaps > 0 ||
            report.rejected > 0) && <span className={styles.warning}>{t('spend.gaps')}</span>}
        </div>
      )}
      <section className={styles.metrics} aria-label={t('spend.totals')}>
        {[
          ['api_cost', money(total.api) + (total.missing ? ' + ?' : ''), 'api_hint'],
          ['plan_budget', money(budget), 'budget_hint'],
          ['allocated', money(total.allocated), 'allocated_hint'],
          ['unallocated', money(Math.max(0, budget - total.allocated)), 'unallocated_hint'],
        ]
          .filter(([label]) => (label === 'api_cost' ? !hideApi : !hidePlan))
          .map(([label, value, hint]) => (
            <article key={label}>
              <span>{t(`spend.${label}`)}</span>
              <strong>{report ? value : '—'}</strong>
              <small>{t(`spend.${hint}`)}</small>
            </article>
          ))}
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>{t('spend.total')}</span>
            <h2>{t('spend.model_total')}</h2>
          </div>
          <span>{t('spend.usd')}</span>
        </div>
        {(!hideApi || !hidePlan) && <p className={styles.subtitle}>{t('spend.token_rate_hint')}</p>}
        {!hidePlan && partialRolling && (
          <p className={styles.subtitle}>{t('spend.token_rate_partial')}</p>
        )}
        {!hidePlan && rolling.error && (
          <p role="status" className={styles.warning}>
            {t('spend.token_rate_error')}
          </p>
        )}
        {total.models.length ? (
          modelTable(total.models, false, true)
        ) : (
          <p className={styles.empty}>{t(loading ? 'spend.loading' : 'spend.empty')}</p>
        )}
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <h2>{t('spend.by_provider')}</h2>
        </div>
        <div className={styles.providerGrid}>
          {providers
            .filter((p) => !provider || provider === p)
            .map((p) => {
              const plans = filtered.filter((a) => a.provider === p);
              const summary = rollup(plans);
              return (
                <details key={p}>
                  <summary>
                    <strong>{displayProvider(p)}</strong>
                    {!hidePlan && (
                      <span>
                        {money(summary.allocated)} <small>{t('spend.allocated')}</small>
                      </span>
                    )}
                  </summary>
                  <p className={styles.subtitle}>
                    {!hideApi && (
                      <span>
                        {t('spend.api_cost')}: {money(summary.api)}
                        {summary.missing ? ' + ?' : ''}{' '}
                      </span>
                    )}
                    {!hidePlan && (
                      <span>
                        {t('spend.plan_budget')}:{' '}
                        {money(plans.reduce((s, a) => s + (a.fee ?? 0), 0))}
                      </span>
                    )}
                  </p>
                  {summary.models.length ? modelTable(summary.models) : <p>{t('spend.empty')}</p>}
                </details>
              );
            })}
        </div>
      </section>
      <section>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>{t('spend.by_plan')}</span>
            <h2>{t('spend.account_title')}</h2>
          </div>
        </div>

        <div className={styles.accounts}>
          {filtered.map((a) => {
            const file = files.find((f) => String(f.auth_index) === a.id);
            const label =
              report?.accountLabels?.[a.id] ??
              (file ? accountLabel(file) : t('spend.archived_account', { id: a.id }));
            const plan = file
              ? overviewPlanLabel(
                  file,
                  quotaFor(file, snapshot?.quota?.accounts ?? []),
                  snapshot?.plans[file.name] ?? null,
                  t
                )
              : null;
            return (
              <article className={styles.panel} key={a.id}>
                <div className={styles.sectionHead}>
                  <div>
                    <span className={styles.eyebrow}>
                      {displayProvider(a.provider)}
                      {plan ? ` (${plan})` : ''}
                    </span>
                    <h3>{label}</h3>
                  </div>
                </div>
                <p className={styles.accountSummary}>
                  {!hideApi && (
                    <span>
                      {t('spend.api_cost')}: {money(a.api)}
                      {a.missing ? ' + ?' : ''}{' '}
                    </span>
                  )}
                  {!hidePlan && (
                    <span>
                      {t('spend.monthly_fee')}: {a.fee === null ? '—' : money(a.fee)}
                    </span>
                  )}
                </p>
                {!!a.missing && <p className={styles.warning}>{t('spend.blocked')}</p>}
                {!hidePlan && a.fee === null && (
                  <p className={styles.subtitle}>{t('spend.fee_needed')}</p>
                )}
                {a.models.length ? (
                  modelTable(a.models, true)
                ) : (
                  <p className={styles.empty}>{t('spend.empty')}</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <details className={styles.panel}>
        <summary>{t('spend.method')}</summary>
        <p>{t('spend.formula')}</p>
        <p className={styles.subtitle}>{t('spend.terra_rates_hint', { date: TERRA_RATE_DATE })}</p>
        <p className={styles.subtitle}>{t('spend.assumptions', { date: RATE_DATE })}</p>
        <p className={styles.subtitle}>{t('spend.image_rates_hint', { date: IMAGE_RATE_DATE })}</p>
        <p className={styles.subtitle}>
          {t('spend.deepseek_rates_hint', { date: DEEPSEEK_RATE_DATE })}
        </p>
        <p className={styles.subtitle}>{t('spend.glm_rates_hint', { date: GLM_RATE_DATE })}</p>
        <p className={styles.subtitle}>{t('spend.qwen_rates_hint', { date: QWEN_RATE_DATE })}</p>
        <div className={styles.sources}>
          {Object.entries(RATE_SOURCES).map(([name, url]) => (
            <a key={name} href={url} target="_blank" rel="noreferrer">
              {name}
            </a>
          ))}
        </div>
        {!hideApi && (
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label={t('spend.rates')}
          >
            <table>
              <thead>
                <tr>
                  {['model', 'modality', 'input', 'cache_read', 'cache_write', 'output'].map(
                    (k) => (
                      <th key={k}>{t(`spend.${k}`)}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {Object.entries(TOKEN_RATES).flatMap(([model, r]) => {
                  const rows = r.image
                    ? [
                        { modality: 'text', values: [r.input, r.cacheRead, null, null] },
                        {
                          modality: 'image',
                          values: [r.image.input, r.image.cacheRead, null, r.output],
                        },
                      ]
                    : [
                        {
                          modality: 'text',
                          values: [r.input, r.cacheRead, r.cacheWrite, r.output],
                        },
                      ];
                  return rows.map(({ modality, values }) => (
                    <tr key={`${model}-${modality}`}>
                      <td>{model}</td>
                      <td>{t(`spend.${modality}`)}</td>
                      {values.map((v, i) => (
                        <td key={i}>{v === null ? '—' : `$${v}`}</td>
                      ))}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
