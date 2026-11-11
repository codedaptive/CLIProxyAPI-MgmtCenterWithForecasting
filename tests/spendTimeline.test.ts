import { expect, test } from 'bun:test';
import {
  spendTimeline,
  spendViewport,
  tokenColor,
  modelColorFamily,
} from '../src/features/spend/timelineModel';
import { apiEquivalent } from '../src/features/spend/model';
import type { SpendTimelineData, UsageRow } from '../src/features/spend/types';
const HOUR = 3600000;
const now = Date.parse('2026-11-03T12:00:00Z');
const row: UsageRow & { at: number } = {
  at: now - HOUR,
  account: 'one',
  provider: 'claude',
  model: 'claude-opus-5-5',
  prompt: 100,
  input: 100,
  output: 20,
  cacheRead: 30,
  cacheWrite: 10,
  incomplete: 0,
  failed: 0,
  requests: 1,
};
const data: SpendTimelineData = {
  version: 1,
  month: '2026-11',
  now,
  start: now - 48 * HOUR,
  end: now + 24 * HOUR,
  bucketMs: HOUR / 2,
  createdAt: now - 72 * HOUR,
  lastPoll: now,
  enabled: true,
  error: null,
  rows: [row],
  recent: [row],
};
test('token layers reconcile, group adjacent categories, and project a three-hour average', () => {
  const s = spendTimeline(data, '', 'tokens');
  expect(s.layers.map((l) => l.category)).toEqual(['input', 'output', 'cacheRead', 'cacheWrite']);
  expect(Object.values(s.actual[s.actual.length - 1].values).reduce((a, b) => a + b, 0)).toBe(160);
  const forecast = s.projected.find((p) => p.at === now + 3 * HOUR)!;
  expect(Object.values(forecast.values).reduce((a, b) => a + b, 0)).toBe(320);
  expect(s.projected[s.projected.length - 1].at).toBe(data.end);
  expect(spendTimeline(data, 'codex', 'tokens').layers).toHaveLength(0);
});
test('API chart preserves per-request price bands and equals report costs', () => {
  const long = { ...row, model: 'gpt-6.1-terra', provider: 'codex', prompt: 300000, input: 300000 };
  const short = { ...long, prompt: 100, input: 100 };
  const s = spendTimeline({ ...data, rows: [long, short], recent: [] }, '', 'api');
  const total = Object.values(s.actual[s.actual.length - 1].values).reduce((a, b) => a + b, 0);
  expect(total).toBeCloseTo(apiEquivalent(long)! + apiEquivalent(short)!, 8);
});
test('forecasts do not appear for historical months, stale collectors, or short coverage', () => {
  for (const patch of [
    { now: data.end + 1 },
    { lastPoll: now - 60001 },
    { createdAt: now - HOUR },
    { error: 'offline' },
    { enabled: false },
  ])
    expect(spendTimeline({ ...data, ...patch }, '', 'tokens').projected).toHaveLength(0);
  expect(spendTimeline({ ...data, now: data.end + 1, rows: [] }, '', 'tokens').layers).toHaveLength(
    0
  );
});
test('unknown pricing preserves measured tokens while marking API totals partial', () => {
  const unknown = { ...row, model: 'test-unpriced' };
  expect(spendTimeline({ ...data, rows: [unknown], recent: [] }, '', 'api').missing).toBe(1);
  const s = spendTimeline({ ...data, rows: [unknown], recent: [] }, '', 'tokens');
  expect(Object.values(s.actual[s.actual.length - 1].values).reduce((a, b) => a + b, 0)).toBe(160);
});
test('model manufacturer determines colors even when the gateway provider differs', () => {
  expect(modelColorFamily('claude-opus-5-5', 'antigravity')).toBe('claude');
  const colors = ['input', 'output', 'cacheRead', 'cacheWrite'].map((c) =>
    tokenColor('claude-opus-5-5', 'antigravity', c as 'input')
  );
  expect(new Set(colors).size).toBe(4);
  expect(colors[0]).toBe('rgb(192, 86, 33)');
});
test('spend zoom stays within the selected month and reaches six hours', () => {
  expect(spendViewport(data.start, data.end, now, 0)).toEqual({ start: data.start, end: data.end });
  const v = spendViewport(data.start, data.end, now, 100);
  expect(v.end - v.start).toBeCloseTo(6 * HOUR);
  expect(v.start).toBeLessThan(now);
  expect(v.end).toBeGreaterThan(now);
  const edge = spendViewport(data.start, data.end, data.end - 1, 100);
  expect(edge.end).toBe(data.end);
});

test('Sol estimated writes keep chart tokens, costs and forecast consistent with the report', () => {
  const sol = {
    ...row,
    provider: 'codex',
    model: 'gpt-6.1-sol',
    prompt: 300000,
    input: 0,
    cacheRead: 200000,
    cacheWrite: 100000,
    estimatedCacheWrite: 100000,
  };
  const series = spendTimeline({ ...data, rows: [sol], recent: [sol] }, '', 'tokens');
  const end = series.actual[series.actual.length - 1].values;
  expect(end['gpt-6.1-sol|input']).toBe(0);
  expect(end['gpt-6.1-sol|cacheWrite']).toBe(100000);
  expect(Object.values(end).reduce((a, b) => a + b, 0)).toBe(300020);
  expect(series.layers.every((l) => l.estimatedWrites)).toBe(true);
  const forecast = series.projected.find((p) => p.at === now + 3 * HOUR)!;
  expect(forecast.values['gpt-6.1-sol|cacheWrite']).toBe(200000);
  const dollars = spendTimeline({ ...data, rows: [sol], recent: [sol] }, '', 'api');
  const costs = dollars.actual[dollars.actual.length - 1].values;
  expect(costs['gpt-6.1-sol|cacheWrite']).toBe(0.5);
  expect(Object.values(costs).reduce((a, b) => a + b, 0)).toBeCloseTo(apiEquivalent(sol)!);
  expect(spendTimeline(data, '', 'tokens').layers.every((l) => !l.estimatedWrites)).toBe(true);
});
