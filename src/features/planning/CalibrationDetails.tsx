import { useTranslation } from 'react-i18next';
import { providerLabel } from '@/features/dashboard/utils';
import type { PlanningResult } from './loadPlanning';
import { planKey, quotaRuns } from './calibration';
import shared from '@/features/spend/SpendPage.module.scss';
import styles from './PlanningPage.module.scss';

export function CalibrationDetails({ result }: { result: PlanningResult }) {
  const { t, i18n } = useTranslation();
  const number = (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: 2 });
  const groups = [...new Set(result.calibration.map((c) => JSON.stringify([c.key, c.window])))];
  return (
    <details className={shared.panel}>
      <summary>{t('planning.quota_calibration')}</summary>
      {groups.map((id) => {
        const [key, window] = JSON.parse(id) as [string, string];
        const rows = result.calibration.filter((c) => c.key === key && c.window === window);
        const first = rows[0];
        const samples = first.samples ?? [];
        const ceiling = Math.max(100, ...samples.map((s) => s.predicted));
        const x = (n: number) => 40 + (n / ceiling) * 280;
        const y = (n: number) => 180 - (n / ceiling) * 150;
        const runs = quotaRuns(result.data).filter((run) => {
          const account = result.accounts.find((a) => a.id === run.account);
          return (
            account &&
            planKey(account.provider, account.terms.planType) === key &&
            run.window === window
          );
        });
        return (
          <details className={styles.capacityPeriod} key={id}>
            <summary>
              {providerLabel(first.provider, first.provider)} · {first.planType} ·{' '}
              {t(window === 'five_hour' ? 'planning.quota_five_hour' : 'planning.quota_weekly')}
              {window.startsWith('seven_day_') ? ` · ${window.slice(10)}` : ''}
            </summary>
            <p className={shared.subtitle}>
              {t('planning.run_counts', {
                full: first.fullRuns ?? 0,
                partial: first.partialRuns ?? 0,
              })}
            </p>
            <svg
              viewBox="0 0 360 220"
              className={styles.fitPlot}
              role="img"
              aria-label={t('planning.fit_plot')}
            >
              <title>{t('planning.fit_plot')}</title>
              <path d="M40 30 V180 H320" fill="none" stroke="currentColor" />
              <path
                d="M40 180 L320 30"
                fill="none"
                stroke="currentColor"
                strokeDasharray="4 4"
                opacity="0.3"
              />
              <text x="40" y="198">
                0
              </text>
              <text x="300" y="198">
                {Math.ceil(ceiling)}%
              </text>
              <text x="4" y="35">
                {Math.ceil(ceiling)}%
              </text>
              <text x="180" y="217" textAnchor="middle">
                {t('planning.observed_quota')}
              </text>
              <text x="180" y="16" textAnchor="middle">
                {t('planning.fitted_quota')}
              </text>
              {samples.map((s, i) => (
                <circle
                  key={i}
                  cx={x(s.actual)}
                  cy={y(s.predicted)}
                  r={3 + s.actual / 25}
                  fill="currentColor"
                  opacity="0.7"
                >
                  <title>
                    {number(s.actual)}% → {number(s.predicted)}%
                  </title>
                </circle>
              ))}
            </svg>
            <div
              className={shared.tableScroll}
              tabIndex={0}
              role="region"
              aria-label={t('planning.quota_calibration')}
            >
              <table>
                <thead>
                  <tr>
                    {[
                      'model',
                      'matched_tokens',
                      'token_share',
                      'quota_per_million',
                      'capacity_tokens',
                    ].map((k) => (
                      <th key={k}>{t(`planning.${k}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.model}>
                      <td>{c.model}</td>
                      <td>{number(c.tokens)}</td>
                      <td>{number((c.tokenShare ?? 0) * 100)}%</td>
                      <td>{(c.quotaPerMillion ?? 0).toFixed(4)}%</td>
                      <td>{number(c.tokensPerQuota ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className={styles.modelDemand}>
              <summary>{t('planning.observed_runs')}</summary>
              <div
                className={shared.tableScroll}
                tabIndex={0}
                role="region"
                aria-label={t('planning.observed_runs')}
              >
                <table>
                  <thead>
                    <tr>
                      {[
                        'account',
                        'run_dates',
                        'quota_points',
                        'run_tokens',
                        'model',
                        'recorded_tokens',
                        'token_share',
                        'normalized_tokens',
                      ].map((k) => (
                        <th key={k}>{t(`planning.${k}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.flatMap((run, i) => {
                      const total = run.rows.reduce(
                        (s, r) => s + r.input + r.output + r.cacheRead + r.cacheWrite,
                        0
                      );
                      return run.rows.map((r) => {
                        const tokens = r.input + r.output + r.cacheRead + r.cacheWrite;
                        return (
                          <tr key={`${i}:${r.model}`}>
                            <td>
                              {result.accounts.find((a) => a.id === run.account)?.label ??
                                run.account}
                            </td>
                            <td>
                              {new Date(run.start).toLocaleDateString(i18n.language)} –{' '}
                              {new Date(run.end).toLocaleDateString(i18n.language)}
                            </td>
                            <td>
                              {number(run.used)}%{' ('}
                              {number(run.startRemaining)} → {number(run.endRemaining)}
                              {')'}
                            </td>
                            <td>{number(total)}</td>
                            <td>{r.model}</td>
                            <td>{number(tokens)}</td>
                            <td>{number((tokens / total) * 100)}%</td>
                            <td>{number((tokens * 100) / run.used)}</td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </details>
        );
      })}
    </details>
  );
}
