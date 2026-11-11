import { expect, test } from 'bun:test';
import {
  accountLastUsed,
  orderedQuotaWindows,
  quotaRowState,
  sortQuotaAccounts,
} from '../src/features/overview/quotaRows';
import type { ResetQuotaAccount } from '../src/services/api/overview';
import type { AuthFileItem } from '../src/types/authFile';
const now = 1000000;
const file = (name: string): AuthFileItem => ({
  name,
  cooldownSnapshot: { receivedAtMs: now, records: [] },
});
const quota = (id: string, reset: number, used = 20): ResetQuotaAccount => ({
  id,
  authIndex: id,
  provider: 'claude',
  readAt: now,
  failures: 0,
  windows: [
    { id: 'five_hour', used, resetAt: now + reset },
    { id: 'seven_day', used: 40, resetAt: now + 100000 },
  ],
});
test('quota rows sort by weekly reset, then five-hour reset, with missing resets last', () => {
  const files = ['unknown', 'late', 'weekly-only', 'early-five', 'late-five', 'no-week'].map(file);
  const qs = files.filter((f) => f.name !== 'unknown').map((f) => quota(f.name, 100));
  const get = (name: string) => qs.find((q) => q.id === name)!;
  get('late').windows[1].resetAt = now + 200000;
  get('early-five').windows[0].resetAt = now + 1000;
  get('late-five').windows[0].resetAt = now + 2000;
  get('weekly-only').windows = get('weekly-only').windows.slice(1);
  get('no-week').windows = get('no-week').windows.slice(0, 1);
  get('early-five').windows[0].used = 100;
  files[3].unavailable = true;
  expect(sortQuotaAccounts(files, qs).map((f) => f.name)).toEqual([
    'early-five',
    'late-five',
    'weekly-only',
    'late',
    'no-week',
    'unknown',
  ]);
  expect(files.map((f) => f.name)).toEqual([
    'unknown',
    'late',
    'weekly-only',
    'early-five',
    'late-five',
    'no-week',
  ]);
});
test('quota sorting uses credential identity, ignores model-specific reset windows, and resolves ties by label', () => {
  const files: AuthFileItem[] = [
    { name: 'b', authIndex: 123 },
    { name: 'a', authIndex: '456' },
    { name: 'c' },
  ];
  const qs = [quota('123', 100), quota('456', 100), quota('c', 100)];
  qs[0].windows.push({ id: 'seven_day_fable', used: 0, resetAt: 1 });
  qs[2].windows[1].resetAt = NaN;
  qs[2].windows[0].resetAt = null;
  expect(sortQuotaAccounts(files, qs).map((f) => f.name)).toEqual(['a', 'b', 'c']);
  expect(sortQuotaAccounts(files, []).map((f) => f.name)).toEqual(['a', 'b', 'c']);
});
test('last-use labels still match credential IDs independently of the reset ordering', () => {
  expect(accountLastUsed({ name: 'a', authIndex: 123 }, { '123': 200 })).toBe(200);
  expect(accountLastUsed({ name: 'a' }, { a: 300 })).toBeNull();
  expect(accountLastUsed({ name: 'a', authIndex: 'a' }, { a: NaN })).toBeNull();
});
test('stale or elapsed windows remain unknown; model-only exhaustion does not block other models', () => {
  const a = quota('one', 1000);
  a.windows.push({ id: 'seven_day_fable', used: 100, resetAt: now + 10000 });
  expect(quotaRowState(file('one'), a, now, 60000).hasQuota).toBe(true);
  expect(quotaRowState(file('one'), a, now + 70000, 60000).hasQuota).toBe(null);
  a.windows[0].resetAt = now - 1;
  expect(quotaRowState(file('one'), a, now, 60000).hasQuota).toBe(null);
  expect(quotaRowState({ name: 'one' }, undefined, now, 60000).timeout).toBe(null);
});
test('timeout expires using receipt-relative timers and quota windows use requested order', () => {
  const f = file('one');
  f.cooldownSnapshot!.records = [
    { scope: 'credential', reason: 'transient_error', retryAt: '', remainingSeconds: 5 },
  ];
  expect(quotaRowState(f, quota('one', 10000), now + 6000, 60000).timeout).toBe(false);
  expect(
    orderedQuotaWindows(
      ['seven_day_fable', 'five_hour', 'seven_day'].map((id) => ({ id, used: 0, resetAt: null }))
    ).map((w) => w.id)
  ).toEqual(['seven_day', 'five_hour', 'seven_day_fable']);
});
