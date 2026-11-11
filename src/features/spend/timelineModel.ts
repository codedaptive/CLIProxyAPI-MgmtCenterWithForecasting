import { TYPE_COLORS } from '@/utils/quota';
import { apiContributions, TOKEN_CATEGORIES, type TokenCategory } from './model';
import type { SpendTimelineData, UsageRow } from './types';

export interface SpendLayer {
  key: string;
  model: string;
  category: TokenCategory;
  color: string;
  estimatedWrites: boolean;
}
export interface SpendPoint {
  at: number;
  values: Record<string, number>;
}
export type SpendUnit = 'tokens' | 'api';
const HOUR = 3600000;
const layerKey = (model: string, category: TokenCategory) => `${model}|${category}`;

export function modelColorFamily(model: string, provider: string) {
  if (/claude|opus|sonnet|haiku|fable/i.test(model)) return 'claude';
  if (/^gpt-|^o[134](?:-|$)/i.test(model)) return 'codex';
  if (/gemini/i.test(model)) return 'gemini';
  if (/qwen/i.test(model)) return 'qwen';
  if (/deepseek/i.test(model)) return 'deepseek';
  if (/glm/i.test(model)) return 'glm';
  return provider;
}
export function tokenColor(model: string, provider: string, category: TokenCategory) {
  const family = modelColorFamily(model, provider);
  const hex = (TYPE_COLORS[family] ?? TYPE_COLORS.unknown).light.text;
  const blend = { input: 0, output: 0.22, cacheRead: 0.44, cacheWrite: 0.66 }[category];
  const rgb = [1, 3, 5].map((i) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - blend) + 255 * blend)
  );
  return `rgb(${rgb.join(', ')})`;
}

export function spendViewport(start: number, end: number, now: number, zoom: number) {
  const full = end - start;
  const span = full * (Math.min(6 * HOUR, full) / full) ** (Math.max(0, Math.min(100, zoom)) / 100);
  const anchor = now >= start && now < end ? now : (start + end) / 2;
  const left = Math.max(start, Math.min(end - span, anchor - span * 0.64));
  return { start: left, end: left + span };
}

export function spendTimeline(data: SpendTimelineData, provider: string, unit: SpendUnit) {
  const rows = data.rows.filter((r) => !provider || r.provider === provider);
  const recent =
    data.now >= data.start && data.now < data.end
      ? data.recent.filter((r) => !provider || r.provider === provider)
      : [];
  const models = new Map<string, string>();
  const estimatedModels = new Set(
    [...rows, ...recent].filter((r) => (r.estimatedCacheWrite ?? 0) > 0).map((r) => r.model)
  );
  for (const r of [...rows, ...recent]) models.set(r.model, modelColorFamily(r.model, r.provider));
  const layers: SpendLayer[] = [...models]
    .sort(([a, pa], [b, pb]) => pa.localeCompare(pb) || a.localeCompare(b))
    .flatMap(([model, family]) =>
      TOKEN_CATEGORIES.map((category) => ({
        key: layerKey(model, category),
        model,
        category,
        estimatedWrites: estimatedModels.has(model),
        color: tokenColor(model, family, category),
      }))
    );
  let missing = 0;
  const totals: Record<string, number> = Object.create(null);
  const add = (target: Record<string, number>, row: UsageRow) => {
    const costs = unit === 'api' ? apiContributions(row) : null;
    if (
      row.incomplete ||
      (unit === 'api' && (!costs || TOKEN_CATEGORIES.some((k) => costs[k] === null)))
    )
      missing += row.requests;
    for (const category of TOKEN_CATEGORIES) {
      const k = layerKey(row.model, category);
      target[k] = (target[k] ?? 0) + (unit === 'tokens' ? row[category] : (costs?.[category] ?? 0));
    }
  };
  const buckets = new Map<number, UsageRow[]>();
  for (const row of rows) {
    if (row.at >= data.end || row.at + data.bucketMs <= data.start || row.at >= data.now) continue;
    const at = Math.min(row.at + data.bucketMs, data.now, data.end);
    buckets.set(at, [...(buckets.get(at) ?? []), row]);
  }
  const coverageStart = Math.max(
    data.start,
    Math.min(data.createdAt, rows.length ? Math.min(...rows.map((r) => r.at)) : data.createdAt)
  );
  const actual: SpendPoint[] = [];
  if (coverageStart < Math.min(data.now, data.end)) actual.push({ at: coverageStart, values: {} });
  for (const [at, group] of [...buckets].sort(([a], [b]) => a - b)) {
    for (const row of group) add(totals, row);
    actual.push({ at, values: { ...totals } });
  }
  const lastAt = Math.min(data.now, data.end);
  if (actual.length && actual[actual.length - 1].at < lastAt)
    actual.push({ at: lastAt, values: { ...totals } });
  const rates: Record<string, number> = Object.create(null);
  for (const row of recent) add(rates, row);
  const canForecast =
    data.now >= data.start &&
    data.now < data.end &&
    data.enabled &&
    !data.error &&
    !!data.lastPoll &&
    data.now - data.lastPoll <= 60000 &&
    data.createdAt <= data.now - 3 * HOUR;
  const projected: SpendPoint[] = [];
  if (canForecast) {
    for (let at = data.now; ; at = Math.min(at + HOUR, data.end)) {
      const values: Record<string, number> = { ...totals };
      for (const [k, value] of Object.entries(rates))
        values[k] = (totals[k] ?? 0) + value * ((at - data.now) / (3 * HOUR));
      projected.push({ at, values });
      if (at === data.end) break;
    }
  }
  return { layers, actual, projected, missing };
}
