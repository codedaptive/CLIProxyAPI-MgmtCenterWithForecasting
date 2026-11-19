import { expect, test } from 'bun:test';
import { normalizeKpatdevQuota, type ResetQuotaAccount } from '../src/services/api/overview';
import { mergeClaudeQuota } from '../src/features/overview/claudeQuota';
import { overviewQuotaSample } from '../src/features/overview/quotaSnapshot';
import { withLiveQuota } from '../src/features/spend/liveQuota';
import { quotaSeries, windowBurn, type QuotaHistory } from '../src/features/spend/quotaModel';
import type { AuthFileItem, ClaudeQuotaState } from '../src/types';

const now = Date.parse('2026-11-19T18:37:00Z');
const minute = 60000;
const resetAt = now + 86400000;
const file: AuthFileItem = { name: 'team.json', authIndex: 'team-id', type: 'claude' };
const account: ResetQuotaAccount = {
  id: file.name,
  authIndex: 'team-id',
  provider: 'claude',
  failures: 0,
  readAt: now - 7 * minute,
  windows: [{ id: 'seven_day', used: 100, resetAt }],
};
const direct: ClaudeQuotaState = {
  status: 'success',
  observedAt: new Date(now).toISOString(),
  windows: [
    { id: 'seven-day', label: 'Weekly', usedPercent: 0, resetLabel: '', resetAtMs: resetAt },
  ],
};
const history: QuotaHistory = {
  version: 1,
  now,
  error: null,
  samples: [overviewQuotaSample([file], [account], now - minute, 20 * minute)],
};

test('a newly measured reset updates chart and forecast anchor before the router poll', () => {
  const rows = mergeClaudeQuota([file], [account], { [file.name]: direct });
  const live = overviewQuotaSample([file], rows, now, 20 * minute);
  const result = withLiveQuota(history, live);
  expect(result.samples.at(-1)?.accounts[0].windows[0].remaining).toBe(100);
  expect(quotaSeries(result).actual.at(-1)?.values.claude).toBe(100);
  expect(result.samples[0]).toBe(history.samples[0]);
  expect(history.samples).toHaveLength(1);
});

test('old model-specific readings do not hide fresh weekly quota or let older browser cache win', () => {
  const routed = normalizeKpatdevQuota(
    { accounts: {}, max_age: '20m' },
    {
      accounts: [
        {
          id: file.name,
          provider: 'claude',
          windows: [
            {
              kind: 'weekly',
              key: 'weekly',
              used_percent: 42,
              observed_at: new Date(now).toISOString(),
              resets_at: new Date(resetAt).toISOString(),
            },
            {
              kind: 'model_weekly',
              family: 'fable',
              used_percent: 99,
              stale: true,
              observed_at: new Date(now - 30 * minute).toISOString(),
              resets_at: new Date(resetAt).toISOString(),
            },
          ],
        },
      ],
    }
  );
  expect(routed.accounts[0].readAt).toBe(now);
  expect(routed.accounts[0].failures).toBe(0);
  const rows = mergeClaudeQuota([file], routed.accounts, {
    [file.name]: { ...direct, observedAt: new Date(now - minute).toISOString() },
  });
  expect(rows[0].windows[0].used).toBe(42);
  const live = overviewQuotaSample([file], rows, now, 20 * minute);
  expect(live.accounts[0].windows).toHaveLength(1);
  expect(live.accounts[0].windows[0].remaining).toBe(58);
});

test('newer recorded observations win over slower browser responses', () => {
  const current = { ...account, readAt: now, windows: [{ id: 'seven_day', used: 75, resetAt }] };
  const recorded = {
    ...history,
    samples: [overviewQuotaSample([file], [current], now, 20 * minute)],
  };
  const live = overviewQuotaSample([file], [account], now, 20 * minute);
  expect(withLiveQuota(recorded, live).samples.at(-1)?.accounts[0].windows[0].remaining).toBe(25);
});

test('disabled, stale, failed and elapsed-reset accounts do not get a fresh chart observation', () => {
  expect(
    overviewQuotaSample([{ ...file, disabled: true }], [account], now, 20 * minute).accounts
  ).toEqual([]);
  expect(
    overviewQuotaSample([file], [{ ...account, failures: 1 }], now, 20 * minute).accounts
  ).toEqual([]);
  expect(overviewQuotaSample([file], [account], now, minute).accounts).toEqual([]);
  expect(overviewQuotaSample([file], [account], now, 20 * minute, true).accounts).toEqual([]);
  expect(
    overviewQuotaSample(
      [file],
      [{ ...account, windows: [{ id: 'seven_day', used: 100, resetAt: now }] }],
      now,
      20 * minute
    ).accounts
  ).toEqual([]);
  expect(withLiveQuota(history, { at: now, accounts: [] }).samples.at(-1)?.accounts).toEqual([]);
});

test('repeated cached browser snapshots do not fabricate a measured zero burn', () => {
  const live = overviewQuotaSample(
    [file],
    [{ ...account, windows: [{ id: 'seven_day', used: 50, resetAt }] }],
    now,
    20 * minute
  );
  const updated = withLiveQuota({ ...history, samples: [live] }, { ...live, at: now + minute });
  expect(windowBurn(updated.samples, 'team-id', 'seven_day', now + minute)).toBeNull();
  expect(withLiveQuota(history, { ...live, at: now - 6 * minute })).toBe(history);
});
