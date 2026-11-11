import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { ThroughputChart } from '@/features/dashboard/components/ThroughputChart';
import { Meter } from '@/features/dashboard/components/Meter';
import { providerLabel } from '@/features/dashboard/utils';
import { QuotaAvailability } from '@/features/spend/QuotaAvailability';
import {
  accountLastUsed,
  orderedQuotaWindows,
  quotaRowState,
  sortQuotaAccounts,
} from './quotaRows';
import { overviewRouting } from '@/services/api/overview';
import { useOverview } from './useOverview';
import { overviewPlanLabel } from './plans';
import { overviewTopology, overviewUsage } from './topology';
import { useOverviewClaudeQuota } from './useOverviewClaudeQuota';
import { CLAUDE_QUOTA_MAX_AGE, mergeClaudeQuota, overviewNeedsDirectQuota } from './claudeQuota';
import { accountLabel, providerOf, quotaFor, quotaIsStale, summarizeTraffic } from './model';
import styles from './OverviewPage.module.scss';

export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const { snapshot, loading: snapshotLoading, connected, refresh: refreshSnapshot } = useOverview();
  const oauthFiles = useMemo(() => snapshot?.files ?? [], [snapshot?.files]);
  const topology = useMemo(
    () => overviewTopology(oauthFiles, snapshot?.models ?? {}, snapshot?.config ?? null),
    [oauthFiles, snapshot?.models, snapshot?.config]
  );
  const usage = useMemo(
    () => overviewUsage(snapshot?.usage ?? {}, snapshot?.config ?? null),
    [snapshot?.usage, snapshot?.config]
  );
  const files = topology.files;
  const displayProvider = (id: string) => topology.providerNames[id] ?? providerLabel(id, id);
  const claudeQuota = useOverviewClaudeQuota(
    oauthFiles,
    connected,
    overviewNeedsDirectQuota(snapshot?.config)
  );
  const loading = snapshotLoading || claudeQuota.loading;
  const refresh = async () => {
    await Promise.all([refreshSnapshot(), claudeQuota.refresh()]);
  };
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  useHeaderRefresh(refresh, connected);
  const accounts = mergeClaudeQuota(files, snapshot?.quota?.accounts ?? [], claudeQuota.cache);
  const now = useNow();
  const filtered = files.filter((f) => !provider || providerOf(f) === provider);
  const providers = [...new Set([...files.map(providerOf), ...Object.keys(usage)])].sort();
  const traffic = useMemo(
    () => summarizeTraffic(oauthFiles, usage, provider),
    [oauthFiles, usage, provider]
  );
  const routes = useMemo(() => {
    const result = new Map<string, typeof files>();
    topology.files
      .filter((f) => !provider || providerOf(f) === provider)
      .forEach((file) => {
        (topology.models[file.name] ?? []).forEach((model) =>
          result.set(model, [...(result.get(model) ?? []), file])
        );
      });
    return [...result.entries()]
      .filter(([model]) => model.toLowerCase().includes(search.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [topology, provider, search]);
  const routing = overviewRouting(snapshot?.config ?? null);
  const quotaFiles = sortQuotaAccounts(
    filtered.filter((file) => !file.disabled),
    accounts
  );
  const trafficKnown =
    snapshot && !snapshot.errors.some((e) => e === 'credentials' || e === 'traffic');
  const lastFile = files.find(
    (f) => f.name === snapshot?.quota?.lastAccount || f.id === snapshot?.quota?.lastAccount
  );
  const date = (value: number) =>
    new Date(value).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const percent = (value: number | null) =>
    value === null ? '—' : `${value.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}%`;
  const number = (value: number) =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: 2 });
  const status = (disabled?: boolean, unavailable?: boolean) =>
    disabled ? 'disabled' : unavailable ? 'unavailable' : 'enabled';
  const metrics = [
    {
      label: 'requests',
      value: trafficKnown ? number(traffic.total) : '—',
      hint: t('overview.window', { minutes: traffic.windowMinutes }),
    },
    {
      label: 'rpm',
      value:
        trafficKnown && traffic.windowMinutes ? number(traffic.total / traffic.windowMinutes) : '—',
      hint: t('overview.average'),
    },
    {
      label: 'success',
      value: trafficKnown ? percent(traffic.successRate) : '—',
      hint: trafficKnown
        ? t('overview.failures', { count: traffic.totalFailure })
        : t('overview.unknown'),
    },
    {
      label: 'accounts',
      value:
        snapshot && !snapshot.errors.some((e) => e === 'credentials' || e === 'routing')
          ? `${filtered.filter((f) => !f.disabled && !f.unavailable).length} / ${filtered.length}`
          : '—',
      hint: t('overview.accounts_hint'),
    },
  ];
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <header className={styles.hero}>
          <h1>{t('overview.title')}</h1>
          <div className={styles.controls}>
            <label>
              {t('overview.provider')}
              <select
                aria-label={t('overview.provider')}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="">{t('overview.all')}</option>
                {providers.map((id) => (
                  <option key={id} value={id}>
                    {displayProvider(id)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={() => void refresh()}
              disabled={!connected || loading}
            >
              <IconRefreshCw size={16} />
              {t('overview.refresh')}
            </Button>
          </div>
        </header>
        <div className={styles.freshness} role="status">
          <span
            className={styles.dot}
            data-ok={connected && !!snapshot && !snapshot.errors.length}
          />
          {!connected
            ? t('overview.disconnected')
            : loading
              ? t('overview.loading')
              : snapshot
                ? t('overview.updated', { time: date(snapshot.readAt) })
                : t('overview.unknown')}
          <span>{t('overview.polling')}</span>
        </div>
      </div>
      {!!snapshot?.errors.length && (
        <div className={styles.notice} role="alert">
          {t('overview.partial', {
            sections: snapshot.errors.map((e) => t(`overview.section_${e}`)).join(', '),
          })}
        </div>
      )}
      <section className={styles.metrics} aria-label={t('overview.traffic')}>
        {metrics.map((m) => (
          <article className={styles.metric} key={m.label}>
            <span>{t(`overview.${m.label}`)}</span>
            <strong>{m.value}</strong>
            <small>{m.hint}</small>
          </article>
        ))}
      </section>
      <section className={`${styles.panel} ${styles.trafficPanel}`}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>{t('overview.traffic')}</span>
            <h2>{t('overview.traffic_title')}</h2>
          </div>
          <span className={styles.pill}>{t('overview.buckets')}</span>
        </div>
        {trafficKnown ? (
          <ThroughputChart traffic={traffic} compact />
        ) : (
          <p className={styles.empty}>{t('overview.traffic_unavailable')}</p>
        )}
        <p className={styles.footnote}>{t('overview.telemetry_limit')}</p>
      </section>
      <QuotaAvailability provider={provider} />
      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>{t('overview.quota')}</span>
            <h2>{t('overview.quota_title')}</h2>
          </div>
          <Link to="/quota">{t('overview.quota_link')} →</Link>
        </div>
        <p className={styles.footnote}>{t('overview.quota_hint')}</p>
        <div className={styles.quotaGrid}>
          {quotaFiles.map((file) => {
            const quota = quotaFor(file, accounts);
            const rowState = quotaRowState(
              file,
              quota,
              now,
              snapshot?.quota?.maxAgeMs ?? 0,
              snapshot?.quota?.workerFailed
            );
            const yesNo = (value: boolean | null) =>
              value === null ? '—' : t(value ? 'common.yes' : 'common.no');
            const lastUsed = accountLastUsed(file, snapshot?.lastUsed ?? {});
            const plan = overviewPlanLabel(
              file,
              quota,
              quota?.planType ?? snapshot?.plans[file.name],
              t
            );
            const stale =
              quota &&
              ((quota.source !== 'direct' && snapshot?.quota?.workerFailed) ||
                quotaIsStale(
                  quota,
                  quota.source === 'direct'
                    ? CLAUDE_QUOTA_MAX_AGE
                    : (snapshot?.quota?.maxAgeMs ?? 0),
                  now
                ));
            return (
              <article className={styles.quotaCard} key={file.name}>
                <div className={styles.quotaIdentity}>
                  <header>
                    <span className={styles.eyebrow}>
                      {displayProvider(providerOf(file))}
                      {plan ? ` (${plan})` : ''}
                    </span>
                    <span className={styles.pill}>
                      {t(`overview.${status(file.disabled, file.unavailable)}`)}
                    </span>
                  </header>
                  <h3 title={file.name}>{accountLabel(file)}</h3>
                  <small className={stale ? styles.warning : ''}>
                    {quota?.readAt
                      ? t(stale ? 'overview.stale' : 'overview.observed', {
                          time: date(quota.readAt),
                        })
                      : t('overview.no_snapshot')}
                  </small>
                  <small>
                    {lastUsed
                      ? t('overview.last_used', { time: date(lastUsed) })
                      : t('overview.no_recorded_use')}
                  </small>
                  <div className={styles.quotaFlags}>
                    <span>
                      {t('overview.quota_left')}: {yesNo(rowState.hasQuota)}
                    </span>
                    <span>
                      {t('overview.on_timeout')}: {yesNo(rowState.timeout)}
                    </span>
                  </div>
                </div>
                <div className={styles.quotaWindows}>
                  {orderedQuotaWindows(quota?.windows ?? []).map((window) => {
                    const label = t(
                      ['seven_day', 'five_hour', 'seven_day_fable'].includes(window.id)
                        ? `claude_quota.${window.id}`
                        : (window.labelKey ?? `overview.window_${window.id}`),
                      {
                        defaultValue: window.id.replace(/_/g, ' '),
                      }
                    );
                    const elapsed = window.resetAt !== null && window.resetAt <= now;
                    return (
                      <div className={styles.quotaWindow} key={window.id}>
                        <div className={styles.windowHead}>
                          <span>{label}</span>
                          <strong>
                            {t('overview.remaining', {
                              value: percent(window.used === null ? null : 100 - window.used),
                            })}
                          </strong>
                        </div>
                        <Meter
                          value={window.used === null ? null : 100 - window.used}
                          ariaLabel={`${accountLabel(file)} · ${label} · ${t('overview.quota')}`}
                          tone={
                            stale || elapsed || window.used === null
                              ? 'idle'
                              : window.used >= 90
                                ? 'critical'
                                : window.used >= 70
                                  ? 'warning'
                                  : 'good'
                          }
                        />
                        <div className={styles.windowMeta}>
                          <span>{t('overview.used', { value: percent(window.used) })}</span>
                          <span title={window.resetAt ? date(window.resetAt) : undefined}>
                            {window.resetAt
                              ? elapsed
                                ? t('overview.reset_pending')
                                : t('overview.resets', { time: date(window.resetAt) })
                              : t('overview.no_reset')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {!quota?.windows.length && (
                    <p className={styles.empty}>
                      {t(
                        file.overviewSource === 'configuration'
                          ? 'overview.config_quota_unknown'
                          : 'overview.quota_unknown'
                      )}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {!quotaFiles.length && <p className={styles.empty}>{t('overview.no_accounts')}</p>}
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>{t('overview.routing')}</span>
            <h2>{t('overview.routing_title')}</h2>
          </div>
          <Link to="/ai-providers">{t('overview.providers_link')} →</Link>
        </div>
        <div className={styles.policies}>
          <div>
            <span>{t('overview.scheduler')}</span>
            <strong>
              {snapshot?.quota?.mode === 'active'
                ? t('overview.reset_first')
                : snapshot?.config?.routingStrategy || '—'}
            </strong>
            <small>
              {t('overview.fallback', { strategy: snapshot?.config?.routingStrategy || '—' })}
            </small>
          </div>
          <div>
            <span>{t('overview.affinity')}</span>
            <strong>
              {routing.affinity === null
                ? '—'
                : t(routing.affinity ? 'overview.sticky' : 'overview.per_request')}
            </strong>
            <small>{t('overview.affinity_hint')}</small>
          </div>
          <div>
            <span>{t('overview.last_pick')}</span>
            <strong>{lastFile ? accountLabel(lastFile) : '—'}</strong>
            <small>{t('overview.last_pick_hint')}</small>
          </div>
        </div>
        <p className={styles.footnote}>{t('overview.routes_hint')}</p>
        <label className={styles.search}>
          {t('overview.search')}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('overview.search_placeholder')}
          />
        </label>
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label={t('overview.routing')}
        >
          <table>
            <thead>
              <tr>
                <th>{t('overview.model')}</th>
                <th>{t('overview.destinations')}</th>
                <th>{t('overview.available')}</th>
              </tr>
            </thead>
            <tbody>
              {routes.map(([model, destinations]) => (
                <tr key={model}>
                  <td>
                    <code>{model}</code>
                  </td>
                  <td>
                    <div className={styles.tags}>
                      {destinations.map((file) => (
                        <span
                          key={file.name}
                          className={styles.tag}
                          data-muted={file.disabled || file.unavailable}
                          title={t(`overview.${status(file.disabled, file.unavailable)}`)}
                        >
                          {displayProvider(providerOf(file))}
                          <span> / </span>
                          {accountLabel(file)}
                          {file.disabled || file.unavailable
                            ? ` · ${t(`overview.${status(file.disabled, file.unavailable)}`)}`
                            : ''}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {destinations.filter((f) => !f.disabled && !f.unavailable).length} /{' '}
                    {destinations.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!routes.length && <p className={styles.empty}>{t('overview.no_models')}</p>}
        </div>
      </section>
    </div>
  );
}
