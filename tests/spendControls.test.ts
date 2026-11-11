import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeSpend, apiEquivalent } from '../src/features/spend/model';
import { spendCsv } from '../src/features/spend/export';
import { ModelSpendRows } from '../src/features/spend/ModelSpendRows';
import {
  quotaSeries,
  windowBurn,
  available,
  type QuotaSample,
} from '../src/features/spend/quotaModel';
const row = {
  account: 'a',
  provider: 'codex',
  model: 'gpt-6.1-terra',
  input: 1000000,
  output: 1000000,
  cacheRead: 1000000,
  cacheWrite: 1000000,
  prompt: 272000,
  incomplete: 0,
  failed: 0,
  requests: 1,
};
test('Terra prices all token categories and long prompts', () => {
  expect(apiEquivalent(row)).toBeCloseTo(7.3);
  expect(apiEquivalent({ ...row, prompt: 272001 })).toBeCloseTo(12.1);
});
test('export retains token buckets, costs and allocation, and escapes spreadsheet formulas', () => {
  const csv = spendCsv('2026-11', analyzeSpend([row], { a: 200 }));
  expect(csv).toContain('cache_read_cost_usd');
  expect(csv).toContain('"200"');
  expect(csv).toContain('"7.3"');
  const dangerous = spendCsv(
    '2026-11',
    analyzeSpend([{ ...row, account: '=1+1', model: 'a,"b' }], {})
  );
  expect(dangerous).toContain('"\'=1+1"');
  expect(dangerous).toContain('"a,""b"');
});
test('visibility toggles remove amount cells while keeping model and tokens', () => {
  const m = analyzeSpend([row], { a: 200 })[0].models[0];
  const both = renderToStaticMarkup(
    React.createElement(ModelSpendRows, { model: m, hideApi: true, hidePlan: true })
  );
  expect(both.match(/<td/g)?.length).toBe(2);
  expect(both).not.toContain('$');
  expect(
    renderToStaticMarkup(React.createElement(ModelSpendRows, { model: m, hideApi: true })).match(
      /<td/g
    )?.length
  ).toBe(4);
});
const now = Date.UTC(2026, 10, 3, 12);
const sample = (ago: number, remaining: number, resetAt: number | null = null): QuotaSample => ({
  at: now - ago * 60000,
  accounts: [
    {
      id: 'a',
      provider: 'claude',
      readAt: now - ago * 60000,
      windows: [{ id: 'weekly', remaining, resetAt }],
    },
  ],
});
test('quota stack uses limiting window and equal account weights', () => {
  const a = sample(0, 80).accounts[0];
  expect(
    available([
      { ...a, windows: [...a.windows, { id: 'five', remaining: 30, resetAt: null }] },
      { ...a, id: 'b', provider: 'codex' },
    ])
  ).toEqual({ claude: 15, codex: 40 });
});
test('burn ignores repeated reads, resets, stale gaps and out-of-window samples', () => {
  expect(
    windowBurn([sample(20, 80), sample(10, 70), sample(0, 60)], 'a', 'weekly', now)
  ).toBeCloseTo(60);
  const repeated = sample(0, 70);
  repeated.accounts[0].readAt = now - 10 * 60000;
  expect(windowBurn([sample(10, 70), repeated], 'a', 'weekly', now)).toBeNull();
  expect(windowBurn([sample(30, 80), sample(0, 60)], 'a', 'weekly', now)).toBeNull();
  expect(windowBurn([sample(10, 20), sample(0, 100)], 'a', 'weekly', now)).toBeNull();
  expect(windowBurn([sample(190, 100), sample(0, 60)], 'a', 'weekly', now)).toBeNull();
});
test('forecast reaches zero, resets once, and stays within 0–100', () => {
  const reset = now + 3600000;
  const history = {
    version: 1 as const,
    now,
    error: null,
    samples: [sample(10, 80, reset), sample(0, 70, reset)],
  };
  const s = quotaSeries(history);
  expect(s.forecast.find((p) => p.at === reset)?.values.claude).toBe(100);
  expect(s.forecast[s.forecast.length - 1].values.claude).toBe(0);
  expect(s.forecast.every((p) => p.values.claude >= 0 && p.values.claude <= 100)).toBe(true);
  expect(quotaSeries({ ...history, error: 'offline' }).forecast).toEqual([]);
  expect(quotaSeries({ ...history, samples: [sample(30, 70)] }).forecast).toEqual([]);
  expect(
    quotaSeries(history, 'codex').actual.every((p) => Object.keys(p.values).length === 0)
  ).toBe(true);
});

test('viewport zoom stays within full 14-day past and 8-day future domain', async () => {
  const { quotaViewport, DAY } = await import('../src/features/spend/quotaModel');
  expect(quotaViewport(now, 0)).toEqual({ start: now - 14 * DAY, end: now + 8 * DAY });
  const close = quotaViewport(now, 100);
  expect(close.end - close.start).toBeCloseTo(6 * 3600000);
  expect(close.start).toBeLessThan(now);
  expect(close.end).toBeGreaterThan(now);
  expect(quotaViewport(now, -2)).toEqual(quotaViewport(now, 0));
});
test('forecast repeats known resets across eight days, preserving current anchor', async () => {
  const { projectedWindow } = await import('../src/features/spend/quotaModel');
  const w = { id: 'five_hour', remaining: 60, resetAt: now + 3600000 };
  expect(projectedWindow(w, 10, now, now)).toBe(60);
  expect(projectedWindow(w, 10, now, now + 3600000)).toBe(100);
  expect(projectedWindow(w, 10, now, now + 6 * 3600000)).toBe(100);
  expect(projectedWindow(w, 10, now, now + 7 * 3600000)).toBe(90);
});
test('reconstruction uses recorded activity and never overwrites measured samples', () => {
  const reset = now + 3 * 86400000;
  const history = {
    version: 1 as const,
    now,
    error: null,
    samples: [sample(10, 70, reset), sample(0, 60, reset)],
    activity: [
      { account: 'a', at: now - 2 * 86400000, tokens: 100 },
      { account: 'a', at: now - 3600000, tokens: 100 },
    ],
  };
  const s = quotaSeries(history);
  expect(s.reconstructed.length).toBeGreaterThan(600);
  expect(s.reconstructed.every((p) => p.kind === 'estimated')).toBe(true);
  expect(s.past.find((p) => p.at === now)?.kind).toBe('observed');
  expect(s.past.find((p) => p.at === now)?.values.claude).toBe(60);
  const at = s.reconstructed.find((p) => p.at === now - 86400000);
  expect(at?.values.claude).toBe(80);
  expect(s.forecast[s.forecast.length - 1].at).toBe(now + 8 * 86400000);
  expect(s.reconstructed.every((p) => p.values.claude >= 0 && p.values.claude <= 100)).toBe(true);
});

test('burn tolerates sub-second provider reset timestamp jitter but rejects a real new cycle', () => {
  const reset = now + 3600000;
  expect(
    windowBurn([sample(10, 80, reset), sample(0, 70, reset + 958)], 'a', 'weekly', now)
  ).toBeCloseTo(60);
  expect(
    windowBurn([sample(10, 80, reset), sample(0, 70, reset + 86400000)], 'a', 'weekly', now)
  ).toBeNull();
  expect(
    windowBurn([sample(10, 80, now - 60000), sample(0, 70, now - 59000)], 'a', 'weekly', now)
  ).toBeNull();
});

test('Sol export includes estimates, original counters, costs, and method provenance', () => {
  const csv = spendCsv(
    '2026-11',
    analyzeSpend(
      [
        {
          ...row,
          model: 'gpt-6.1-sol',
          input: 50,
          cacheWrite: 1_000_800,
          estimatedCacheWrite: 1_000_000,
        },
      ],
      { a: 200 }
    )
  );
  const lines = csv.trim().split('\r\n');
  const columns = lines[0]
    .replace(/^\uFEFF/, '')
    .split(',')
    .map((x) => x.replace(/^"|"$/g, ''));
  const values = lines[1].split(',').map((x) => x.replace(/^"|"$/g, ''));
  const field = (key: string) => values[columns.indexOf(key)];
  expect(values.length).toBe(columns.length);
  expect(field('input_tokens')).toBe('50');
  expect(field('cache_write_tokens')).toBe('1000800');
  expect(Number(field('cache_write_cost_usd'))).toBeCloseTo(2.502);
  expect(field('estimated_cache_write_tokens')).toBe('1000000');
  expect(field('cache_write_accounting')).toBe('sol-implicit-v1');
  expect(field('reported_input_tokens')).toBe('1000050');
  expect(field('reported_cache_write_tokens')).toBe('800');
  expect(field('plan_allocation_usd')).toBe('200');
});

test('a newly observed account does not suppress forecasts for established accounts', () => {
  const reset = now + 3600000;
  const first = sample(10, 80, reset);
  const last = sample(0, 70, reset);
  last.accounts.push({
    id: 'new',
    provider: 'codex',
    readAt: now,
    windows: [{ id: 'seven_day', remaining: 60, resetAt: reset }],
  });
  const s = quotaSeries({ version: 1, now, error: null, samples: [first, last] });
  expect(s.projectedAccounts).toBe(1);
  expect(s.heldAccounts).toBe(1);
  expect(s.forecast[0].values).toEqual(s.actual[1].values);
  expect(s.forecast.find((p) => p.at === reset)?.values).toEqual({ claude: 50, codex: 30 });
  expect(s.forecast.at(-1)?.values.codex).toBe(30);
  expect(s.forecast.at(-1)?.at).toBe(now + 8 * 86400000);
  expect(windowBurn([first, last], 'new', 'seven_day', now)).toBeNull();
  expect(
    quotaSeries({ version: 1, now, error: null, samples: [first, last] }, 'codex').forecast
  ).toEqual([]);
});
test('a partially observed account is held as a whole and joins projection after calibration', () => {
  const first = sample(10, 80, now + 3600000),
    last = sample(0, 70, now + 3600000);
  const account = {
    id: 'new',
    provider: 'codex',
    readAt: now - 10 * 60000,
    windows: [{ id: 'weekly', remaining: 70, resetAt: null }],
  };
  first.accounts.push(account);
  last.accounts.push({
    ...account,
    readAt: now,
    windows: [
      { id: 'weekly', remaining: 60, resetAt: null },
      { id: 'five_hour', remaining: 20, resetAt: now + 3600000 },
    ],
  });
  const s = quotaSeries({ version: 1, now, error: null, samples: [first, last] });
  expect(s.heldAccounts).toBe(1);
  expect(s.forecast.at(-1)?.values.codex).toBe(10);
  const next = {
    ...last,
    at: now + 10 * 60000,
    accounts: last.accounts.map((a) => ({ ...a, readAt: now + 10 * 60000 })),
  };
  const calibrated = quotaSeries({
    version: 1,
    now: next.at,
    error: null,
    samples: [first, last, next],
  });
  expect(calibrated.projectedAccounts).toBe(2);
  expect(calibrated.heldAccounts).toBe(0);
});
