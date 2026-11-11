import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  rollingRanges,
  subscriptionTokenCosts,
  type RollingSlice,
} from '../src/features/spend/rollingCosts';
import { analyzeSpend, monthRange } from '../src/features/spend/model';
import { ModelSpendRows } from '../src/features/spend/ModelSpendRows';
import type { UsageRow } from '../src/features/spend/types';
const row = (model: string, account = 'a', input = 1_000_000): UsageRow => ({
  model,
  account,
  input,
  provider: 'codex',
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  prompt: 1000,
  incomplete: 0,
  failed: 0,
  requests: 1,
});
const slice = (month: string, days = 1): RollingSlice => {
  const range = monthRange(month);
  return {
    month,
    start: range.start,
    end: range.start + days * 86400000,
    report: {
      version: 1,
      month,
      createdAt: range.start - 86400000,
      lastPoll: range.start,
      enabled: true,
      error: null,
      rejected: 0,
      gaps: 0,
      plans: { a: 300 },
      rows: [row('gpt-6.1-terra'), row('gpt-5.6-terra')],
    },
  };
};
test('daily subscription fee is allocated by API value within account, not full monthly fee', () => {
  const rates = subscriptionTokenCosts([slice('2026-11')]);
  const period = monthRange('2026-11');
  const fee = (300 * 86400000) / (period.end - period.start);
  expect(rates.get('gpt-6.1-terra')).toBeCloseTo(fee / 3);
  expect(rates.get('gpt-5.6-terra')).toBeCloseTo((fee * 2) / 3);
});
test('rolling ranges cover exact duration across calendar month boundaries and DST', () => {
  const end = new Date(2026, 10, 5, 12).getTime();
  const ranges = rollingRanges(end - 30 * 86400000, end);
  expect(ranges.map((r) => r.month)).toEqual(['2026-10', '2026-11']);
  expect(ranges.reduce((n, r) => n + r.end - r.start, 0)).toBe(30 * 86400000);
  expect(ranges[0].end).toBe(ranges[1].start);
});
test('each month uses its own fee; account allocation happens before summing models', () => {
  const a = slice('2026-10'),
    b = slice('2026-11');
  a.report.plans.a = 620;
  b.report.plans = { a: 300, b: 600 };
  b.report.rows.push(row('gpt-6.1-terra', 'b', 2_000_000));
  const value = subscriptionTokenCosts([a, b]).get('gpt-6.1-terra');
  const fee = (s: RollingSlice, price: number) =>
    (price * (s.end - s.start)) / (monthRange(s.month).end - monthRange(s.month).start);
  expect(value).toBeCloseTo((fee(a, 620) / 3 + fee(b, 300) / 3 + fee(b, 600)) / 4);
});
test('excludes accounts without plan fees and honors provider filters', () => {
  const s = slice('2026-11');
  s.report.rows.push(row('gpt-6.1-terra', 'api-only', 90_000_000));
  expect(subscriptionTokenCosts([s]).get('gpt-6.1-terra')).toBeCloseTo(
    subscriptionTokenCosts([slice('2026-11')]).get('gpt-6.1-terra')!
  );
  expect(subscriptionTokenCosts([s], 'claude').size).toBe(0);
});
test('unknown prices invalidate account allocations; empty usage is not a zero rate', () => {
  const s = slice('2026-11');
  s.report.rows.push(row('unknown'));
  expect(subscriptionTokenCosts([s]).get('gpt-6.1-terra')).toBeNull();
  s.report.rows = [];
  expect(subscriptionTokenCosts([s]).size).toBe(0);
});
test('partial recorder coverage prorates only observed time; zero-fee plan stays zero', () => {
  const s = slice('2026-11');
  s.report.createdAt = s.start + 43200000;
  expect(subscriptionTokenCosts([s]).get('gpt-6.1-terra')).toBeCloseTo(
    subscriptionTokenCosts([slice('2026-11')]).get('gpt-6.1-terra')! / 2
  );
  s.report.plans.a = 0;
  expect(subscriptionTokenCosts([s]).get('gpt-6.1-terra')).toBe(0);
});
test('three rate cells appear only when requested and honor sticky cost visibility', () => {
  const model = analyzeSpend([row('gpt-6.1-terra')], { a: 300 })[0].models[0];
  const tokenCosts = { days30: 2, hours24: 3 };
  const render = (props = {}) =>
    renderToStaticMarkup(React.createElement(ModelSpendRows, { model, tokenCosts, ...props }));
  expect(render().match(/<td/g)?.length).toBe(8);
  expect(render({ hideApi: true }).match(/<td/g)?.length).toBe(6);
  expect(render({ hidePlan: true }).match(/<td/g)?.length).toBe(4);
  expect(render({ hidePlan: true, hideApi: true }).match(/<td/g)?.length).toBe(2);
});
