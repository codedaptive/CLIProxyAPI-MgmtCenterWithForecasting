import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { spendApi } from '@/services/api/spend';
import { TYPE_COLORS } from '@/utils/quota';
import { providerLabel } from '@/features/dashboard/utils';
import { quotaSeries, quotaViewport, type QuotaHistory, type QuotaPoint } from './quotaModel';
import styles from './SpendPage.module.scss';

export function QuotaAvailability({ provider }: { provider: string }) {
  const { t, i18n } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [history, setHistory] = useState<QuotaHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(0);
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(1100);
  const hasChart = Boolean(
    history?.samples.some((s) => s.accounts.some((a) => !provider || a.provider === provider))
  );
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, entries[0].contentRect.width))
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasChart]);
  useEffect(() => {
    let active = true,
      busy = false;
    const revision = apiClient.getConnectionRevision();
    setHistory(null);
    setFailed(false);
    const refresh = async () => {
      if (!connected || busy) return;
      busy = true;
      try {
        const data = await spendApi.quota(apiBase);
        if (active && revision === apiClient.getConnectionRevision()) {
          setHistory(data);
          setFailed(false);
        }
      } catch {
        if (active && revision === apiClient.getConnectionRevision()) setFailed(true);
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [apiBase, key, connected]);
  const series = useMemo(
    () => (history ? quotaSeries(history, provider) : null),
    [history, provider]
  );
  const now = history?.now ?? 0;
  const { start, end } = quotaViewport(now, zoom);
  const x = (at: number) => 48 + ((at - start) / (end - start)) * (width - 68);
  const y = (value: number) => 184 - value * 1.5;
  const time = (at: number) =>
    new Date(at).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const color = (p: string) => (TYPE_COLORS[p] ?? TYPE_COLORS.unknown).light.text;
  const points = [...(series?.past ?? []), ...(series?.forecast ?? [])].filter(
    (p) => p.at >= start && p.at <= end
  );
  const selected =
    hover === null
      ? (series?.actual[series.actual.length - 1] ?? null)
      : points.reduce<QuotaPoint | null>(
          (best, p) => (!best || Math.abs(p.at - hover) < Math.abs(best.at - hover) ? p : best),
          null
        );
  const areas = (data: QuotaPoint[], kind: 'observed' | 'estimated' | 'projected') => {
    const segments: QuotaPoint[][] = [];
    // Draw adjacent intervals in their own provenance style, sharing endpoints only.
    for (let i = 0; i < data.length; i++) {
      const point = data[i],
        previous = data[i - 1];
      if (!previous || point.at < start || previous.at > end) continue;
      const intervalKind =
        previous.kind === 'estimated' || point.kind === 'estimated' ? 'estimated' : point.kind;
      if (intervalKind !== kind) continue;
      let segment = segments[segments.length - 1];
      if (!segment || segment[segment.length - 1] !== previous) {
        segment = [previous];
        segments.push(segment);
      }
      segment.push(point);
    }
    return series?.providers.flatMap((p, i) =>
      segments
        .filter((s) => s.length > 0)
        .map((s, si) => {
          const lower = (point: QuotaPoint) =>
            series.providers.slice(0, i).reduce((v, key) => v + (point.values[key] ?? 0), 0);
          const top = s.map(
            (point) => `${x(point.at)},${y(lower(point) + (point.values[p] ?? 0))}`
          );
          const bottom = [...s].reverse().map((point) => `${x(point.at)},${y(lower(point))}`);
          return (
            <path
              key={`${p}-${si}`}
              d={`M${top.join(' L')} L${bottom.join(' L')} Z`}
              fill={color(p)}
              fillOpacity={kind === 'observed' ? 0.65 : kind === 'estimated' ? 0.32 : 0.2}
              stroke={color(p)}
              strokeWidth="1"
              strokeDasharray={
                kind === 'observed' ? undefined : kind === 'estimated' ? '2 3' : '5 4'
              }
            />
          );
        })
    );
  };
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <h2>{t('spend.quota_title')}</h2>
        <span>{zoom === 0 ? t('spend.quota_range') : `${time(start)} – ${time(end)}`}</span>
      </div>
      <label className={styles.quotaZoom}>
        {t('spend.quota_zoom')}
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={zoom}
          aria-label={t('spend.quota_zoom')}
          aria-valuetext={t('spend.quota_zoom_hours', {
            hours: Math.round((end - start) / 3600000),
          })}
          onChange={(e) => {
            setZoom(Number(e.target.value));
            setHover(null);
          }}
        />
        <span>{t('spend.quota_zoom_hours', { hours: Math.round((end - start) / 3600000) })}</span>
      </label>
      {failed || history?.error ? (
        <p role="status" className={styles.warning}>
          {t('spend.quota_unavailable')}
        </p>
      ) : null}
      {!series?.actual.some((p) => Object.keys(p.values).length) ? (
        <p className={styles.empty}>{t('spend.quota_empty')}</p>
      ) : (
        <>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${width} 230`}
            className={styles.quotaChart}
            role="img"
            aria-label={t('spend.quota_title')}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setHover(
                start +
                  ((((e.clientX - box.left) / box.width) * width - 48) / (width - 68)) *
                    (end - start)
              );
            }}
          >
            <title>{t('spend.quota_method')}</title>
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line
                  x1="48"
                  x2={width - 20}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="currentColor"
                  opacity=".15"
                />
                <text x="40" y={y(v) + 4} textAnchor="end" fill="currentColor" fontSize="11">
                  {v}%
                </text>
              </g>
            ))}
            <defs>
              <clipPath id={clipId}>
                <rect x="48" y="25" width={width - 68} height="160" />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
              {areas(series.past, 'estimated')}
              {areas(series.past, 'observed')}
              {areas(series.forecast, 'projected')}
            </g>
            <line
              x1={x(now)}
              x2={x(now)}
              y1="25"
              y2="184"
              stroke="currentColor"
              strokeDasharray="4 4"
            />
            <text x={x(now) + 6} y="20" fill="currentColor" fontSize="11">
              {t('spend.now')}
            </text>
            {(width < 600
              ? [start, end]
              : [
                  start,
                  start + (end - start) / 4,
                  start + (end - start) / 2,
                  start + (3 * (end - start)) / 4,
                  end,
                ]
            ).map((at) => (
              <text
                key={at}
                x={x(at)}
                y="212"
                textAnchor={at === start ? 'start' : at === end ? 'end' : 'middle'}
                fill="currentColor"
                fontSize="11"
              >
                {new Date(at).toLocaleString(
                  i18n.language,
                  end - start > 2 * 86400000
                    ? { month: 'short', day: 'numeric' }
                    : { hour: 'numeric', minute: '2-digit' }
                )}
              </text>
            ))}
          </svg>
          <div className={styles.quotaReadout} aria-live="polite">
            {selected ? (
              <>
                <span>
                  {time(selected.at)} ·{' '}
                  {t(
                    selected.kind === 'estimated'
                      ? 'spend.reconstructed'
                      : selected.kind === 'projected'
                        ? 'spend.projected'
                        : 'spend.observed'
                  )}
                </span>
                {series.providers.map((p) => (
                  <span key={p}>
                    {providerLabel(p, p)}:{' '}
                    {selected.values[p] === undefined ? '—' : `${selected.values[p].toFixed(1)}%`}
                  </span>
                ))}
              </>
            ) : (
              <span>{t('spend.quota_coverage', { count: series.measured })}</span>
            )}
          </div>
          <div className={styles.quotaLegend}>
            {series.providers.map((p) => (
              <span key={p}>
                <i style={{ background: color(p) }} />
                {providerLabel(p, p)}
              </span>
            ))}
            <span>{t('spend.quota_styles')}</span>
          </div>
          {series.forecast.length > 0 && series.heldAccounts > 0 && (
            <p className={styles.subtitle} role="status">
              {t('spend.quota_partial_forecast', {
                projected: series.projectedAccounts,
                total: series.measured,
                held: series.heldAccounts,
              })}
            </p>
          )}
          {!series.forecast.length && <p className={styles.subtitle}>{t('spend.quota_warming')}</p>}
        </>
      )}
      <details className={styles.quotaExplanation}>
        <summary>{t('spend.quota_method_label')}</summary>
        <p className={styles.subtitle}>{t('spend.quota_method')}</p>
      </details>
    </section>
  );
}
