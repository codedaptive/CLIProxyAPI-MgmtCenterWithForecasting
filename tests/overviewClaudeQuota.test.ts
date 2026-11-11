import { describe, expect, test } from 'bun:test';
import type { AuthFileItem, ClaudeQuotaState } from '../src/types';
import type { ResetQuotaAccount } from '../src/services/api/overview';
import {
  CLAUDE_QUOTA_MAX_AGE,
  mergeClaudeQuota,
  shouldReadClaudeQuota,
  overviewNeedsDirectQuota,
} from '../src/features/overview/claudeQuota';

const at = Date.parse('2026-10-22T01:50:00Z');
const file: AuthFileItem = { name: 'max.json', authIndex: 'max-id', type: 'claude' };
const routed: ResetQuotaAccount = {
  id: file.name,
  authIndex: 'max-id',
  provider: 'claude',
  readAt: at - 60000,
  failures: 0,
  windows: [{ id: 'seven_day', used: 100, resetAt: at + 86400000 }],
};
const reset: ClaudeQuotaState = {
  status: 'success',
  observedAt: new Date(at).toISOString(),
  planType: 'plan_max',
  windows: [
    {
      id: 'seven-day',
      label: 'Weekly',
      labelKey: 'claude_quota.seven_day',
      usedPercent: 0,
      resetLabel: '',
      resetAtMs: at + 86400000,
    },
  ],
};

describe('Overview Claude quota after a reset', () => {
  test('uses the fresh zero reading instead of exhausted routing cache', () => {
    const [result] = mergeClaudeQuota([file], [routed], { [file.name]: reset });
    expect(result.windows[0]).toEqual({
      id: 'seven_day',
      labelKey: 'claude_quota.seven_day',
      used: 0,
      resetAt: at + 86400000,
    });
    expect(result.readAt).toBe(at);
    expect(result.source).toBe('direct');
    expect(result.planType).toBe('plan_max');
    expect(result.failures).toBe(0);
  });
  test('keeps newer routing data and never merges windows from different reads', () => {
    expect(
      mergeClaudeQuota([file], [{ ...routed, readAt: at + 1 }], { [file.name]: reset })[0].source
    ).toBeUndefined();
    const [empty] = mergeClaudeQuota([file], [routed], { [file.name]: { ...reset, windows: [] } });
    expect(empty.windows).toEqual([]);
    expect(mergeClaudeQuota([file], [], { [file.name]: reset })[0].windows[0].used).toBe(0);
  });
  test('failed reads preserve last-known values as stale, never invent zero', () => {
    const [failed] = mergeClaudeQuota([file], [routed], {
      [file.name]: { ...reset, status: 'error', stale: true },
    });
    expect(failed.failures).toBe(1);
    expect(failed.readAt).toBe(at);
    expect(
      mergeClaudeQuota([file], [routed], { [file.name]: { status: 'error', windows: [] } })
    ).toEqual([routed]);
    expect(
      mergeClaudeQuota([file], [routed], { [file.name]: { ...reset, observedAt: 'invalid' } })
    ).toEqual([routed]);
  });
  test('retains non-Claude accounts and ignores removed accounts', () => {
    const codex = { ...file, type: 'codex' };
    expect(mergeClaudeQuota([codex], [routed], { [file.name]: reset })).toEqual([routed]);
    expect(mergeClaudeQuota([], [routed], { [file.name]: reset })).toEqual([]);
  });
  test('bounds polling including failures, while explicit refresh bypasses TTL', () => {
    expect(shouldReadClaudeQuota(reset, undefined, at + 1, false)).toBe(false);
    expect(shouldReadClaudeQuota(reset, undefined, at + CLAUDE_QUOTA_MAX_AGE, false)).toBe(true);
    expect(shouldReadClaudeQuota(undefined, at, at + 1000, false)).toBe(false);
    expect(shouldReadClaudeQuota(undefined, undefined, at, false)).toBe(true);
    expect(shouldReadClaudeQuota(reset, at, at + 1, true)).toBe(true);
    expect(
      shouldReadClaudeQuota({ ...reset, status: 'loading' }, at, at + CLAUDE_QUOTA_MAX_AGE, true)
    ).toBe(false);
  });
});

test('Overview leaves provider polling to either enabled router, including when its cache is stale', () => {
  expect(overviewNeedsDirectQuota(undefined)).toBe(false);
  expect(overviewNeedsDirectQuota(null)).toBe(false);
  for (const id of ['kpatdev-quota-router', 'quota-reset-router']) {
    expect(
      overviewNeedsDirectQuota({
        raw: { plugins: { enabled: true, configs: { [id]: { enabled: true } } } },
      })
    ).toBe(false);
    expect(
      overviewNeedsDirectQuota({
        raw: { plugins: { enabled: true, configs: { [id]: { enabled: false } } } },
      })
    ).toBe(true);
  }
});
