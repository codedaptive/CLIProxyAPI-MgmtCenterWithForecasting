import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { spendApi } from '@/services/api/spend';
import type { SpendTimelineData } from './types';
import { spendTimeline, spendViewport, type SpendPoint, type SpendUnit } from './timelineModel';
import styles from './SpendPage.module.scss';

const categoryKeys = {
  input: 'input',
  output: 'output',
  cacheRead: 'cache_read',
  cacheWrite: 'cache_write',
};
export function SpendTimeline({
  month,
  provider,
  hideApi,
}: {
  month: string;
  provider: string;
  hideApi: boolean;
}) {
  const { t, i18n } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const connected = useAuthStore((s) => s.connectionStatus === 'connected');
  const [data, setData] = useState<SpendTimelineData | null>(null);
  const [failed, setFailed] = useState(false);
  const [unit, setUnit] = useState<SpendUnit>('tokens');
  const [zoom, setZoom] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(1100);
  const chartRef = useRef<SVGSVGElement>(null);
  const clipId = useId();
  const effectiveUnit = hideApi ? 'tokens' : unit;
  useEffect(() => {
    let active = true,
      busy = false;
    const revision = apiClient.getConnectionRevision();
    setData(null);
    setFailed(false);
    setHover(null);
    const refresh = async () => {
      if (!connected || busy) return;
      busy = true;
      try {
        const result = await spendApi.timeline(apiBase, month);
        if (active && revision === apiClient.getConnectionRevision()) {
          setData(result);
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
  }, [apiBase, key, connected, month]);
  const hasData = !!data;
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, entries[0].contentRect.width))
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasData]);
  const series = useMemo(
    () => (data ? spendTimeline(data, provider, effectiveUnit) : null),
    [data, provider, effectiveUnit]
  );
  const viewport = data
    ? spendViewport(data.start, data.end, data.now, zoom)
    : { start: 0, end: 1 };
  const { start, end } = viewport;
  const x = (at: number) => 64 + ((at - start) / (end - start)) * (width - 84);
  const paths = useMemo(() => {
    if (!series) return { items: [], max: 1 };
    const points = [...series.actual, ...series.projected];
    const visible = points.filter(
      (p, i) =>
        (p.at >= start && p.at <= end) ||
        (p.at < start && points[i + 1]?.at >= start) ||
        (p.at > end && points[i - 1]?.at <= end)
    );
    const max =
      Math.max(1, ...visible.map((p) => Object.values(p.values).reduce((a, b) => a + b, 0))) * 1.05;
    const px = (at: number) => 64 + ((at - start) / (end - start)) * (width - 84);
    const y = (v: number) => 184 - (v / max) * 150;
    const items = [false, true].flatMap((projected) => {
      const points = projected ? series.projected : series.actual;
      const lower = points.map(() => 0);
      return series.layers.map((layer) => {
        const bottom = points.map((p, i) => `${px(p.at)},${y(lower[i])}`).reverse();
        const top = points.map((p, i) => {
          lower[i] += p.values[layer.key] ?? 0;
          return `${px(p.at)},${y(lower[i])}`;
        });
        return {
          key: layer.key,
          color: layer.color,
          projected,
          d: points.length > 1 ? `M${top.join(' L')} L${bottom.join(' L')} Z` : '',
        };
      });
    });
    return { items: items.filter((item) => item.d), max };
  }, [series, start, end, width]);
  const points = [...(series?.actual ?? []), ...(series?.projected ?? [])];
  const selected =
    hover === null
      ? series?.actual[series.actual.length - 1]
      : points.reduce<SpendPoint | undefined>(
          (best, p) => (!best || Math.abs(p.at - hover) < Math.abs(best.at - hover) ? p : best),
          undefined
        );
  const number = (v: number, compact = false) =>
    v.toLocaleString(i18n.language, {
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: effectiveUnit === 'api' ? 2 : 0,
      ...(effectiveUnit === 'api' ? { style: 'currency', currency: 'USD' } : {}),
    });
  const date = (at: number) =>
    new Date(at).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <h2>{t('spend.timeline_title')}</h2>
        {!hideApi && (
          <label className={styles.chartUnit}>
            {t('spend.chart_unit')}{' '}
            <select
              aria-label={t('spend.chart_unit')}
              value={unit}
              onChange={(e) => setUnit(e.target.value as SpendUnit)}
            >
              <option value="tokens">{t('spend.tokens')}</option>
              <option value="api">{t('spend.api_cost')}</option>
            </select>
          </label>
        )}
      </div>
      <p className={styles.subtitle}>{t('spend.timeline_hint')}</p>
      <label className={styles.quotaZoom}>
        {t('spend.quota_zoom')}{' '}
        <input
          type="range"
          min="0"
          max="100"
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
      {failed && (
        <p role="status" className={styles.warning}>
          {t('spend.unavailable')}
        </p>
      )}
      {data && series ? (
        <>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${width} 230`}
            className={styles.quotaChart}
            role="img"
            aria-label={t('spend.timeline_title')}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setHover(
                start +
                  ((((e.clientX - box.left) / box.width) * width - 64) / (width - 84)) *
                    (end - start)
              );
            }}
          >
            <title>{t('spend.timeline_hint')}</title>
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line
                  x1="64"
                  x2={width - 20}
                  y1={184 - v * 150}
                  y2={184 - v * 150}
                  stroke="currentColor"
                  opacity=".15"
                />
                <text x="56" y={188 - v * 150} textAnchor="end" fill="currentColor" fontSize="11">
                  {number(v * paths.max, true)}
                </text>
              </g>
            ))}
            <defs>
              <clipPath id={clipId}>
                <rect x="64" y="25" width={width - 84} height="160" />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
              {paths.items.map((p) => (
                <path
                  key={`${p.key}-${p.projected}`}
                  d={p.d}
                  fill={p.color}
                  fillOpacity={p.projected ? 0.3 : 0.85}
                  stroke={p.color}
                  strokeWidth=".6"
                  strokeDasharray={p.projected ? '5 4' : undefined}
                />
              ))}
            </g>
            {data.now >= start && data.now <= end && (
              <g>
                <line
                  x1={x(data.now)}
                  x2={x(data.now)}
                  y1="25"
                  y2="184"
                  stroke="currentColor"
                  strokeDasharray="4 4"
                />
                <text x={x(data.now) + 6} y="20" fill="currentColor" fontSize="11">
                  {t('spend.now')}
                </text>
              </g>
            )}
            {(width < 600
              ? [start, end]
              : [
                  start,
                  start + (end - start) / 4,
                  start + (end - start) / 2,
                  start + ((end - start) * 3) / 4,
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
          <div className={styles.quotaReadout}>
            {selected && (
              <span>
                {date(selected.at)} ·{' '}
                {t(selected.at > data.now ? 'spend.projected' : 'spend.observed')} ·{' '}
                {number(Object.values(selected.values).reduce((a, b) => a + b, 0))}{' '}
                {effectiveUnit === 'tokens' ? t('spend.tokens') : ''}
              </span>
            )}
          </div>
          <div className={styles.modelLegend}>
            {[...new Set(series.layers.map((l) => l.model))].map((model) => (
              <details key={model}>
                <summary>
                  <span className={styles.modelSwatches}>
                    {series.layers
                      .filter((l) => l.model === model)
                      .map((l) => (
                        <i key={l.key} style={{ background: l.color }} />
                      ))}
                  </span>
                  {model}
                </summary>
                <div className={styles.quotaLegend}>
                  {series.layers
                    .filter((l) => l.model === model)
                    .map((l) => (
                      <span key={l.key}>
                        <i style={{ background: l.color }} />
                        {t(
                          `spend.${l.estimatedWrites && l.category === 'input' ? 'estimated_uncached_input' : l.estimatedWrites && l.category === 'cacheWrite' ? 'estimated_cache_write' : categoryKeys[l.category]}`
                        )}
                        : {number(selected?.values[l.key] ?? 0)}
                      </span>
                    ))}
                </div>
              </details>
            ))}
          </div>
          {series.layers.some((l) => l.estimatedWrites) && (
            <p className={styles.subtitle}>{t('spend.sol_write_chart_hint')}</p>
          )}
          {!series.layers.length && <p className={styles.empty}>{t('spend.empty')}</p>}
          {!!series.missing && <p className={styles.warning}>{t('spend.timeline_partial')}</p>}
          {data.now >= data.start && data.now < data.end && !series.projected.length && (
            <p className={styles.subtitle}>{t('spend.timeline_warming')}</p>
          )}
        </>
      ) : (
        !failed && <p className={styles.empty}>{t('spend.loading')}</p>
      )}
    </section>
  );
}
