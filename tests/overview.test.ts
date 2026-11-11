import { describe, expect, test } from 'bun:test';
import {
  normalizeResetRouterStatus,
  overviewRouting,
  parseDuration,
  quotaRouterId,
  normalizeKpatdevQuota,
} from '../src/services/api/overview';
import {
  accountLabel,
  quotaFor,
  quotaIsStale,
  summarizeTraffic,
  sessionMatches,
} from '../src/features/overview/model';

describe('overview read-only snapshot calculations', () => {
  test('preserves unknown quota and distinguishes zero from exhausted', () => {
    const result = normalizeResetRouterStatus({
      max_age: '20m0s',
      mode: 'active',
      accounts: {
        'account.json': {
          auth_index: '1',
          provider: 'claude',
          quota: {
            read_at: '2026-10-19T12:00:00Z',
            five_hour: { utilization: 0 },
            seven_day: { utilization: 100 },
            other: { utilization: null },
          },
        },
      },
    });
    expect(result.maxAgeMs).toBe(1200000);
    expect(result.accounts[0].windows.map((w) => w.used)).toEqual([0, 100, null]);
    expect(
      quotaIsStale(result.accounts[0], result.maxAgeMs, Date.parse('2026-10-19T12:21:00Z'))
    ).toBe(true);
    expect(
      quotaIsStale(result.accounts[0], result.maxAgeMs, Date.parse('2026-10-19T12:01:00Z'))
    ).toBe(false);
    expect(
      quotaIsStale(
        { ...result.accounts[0], failures: 1 },
        result.maxAgeMs,
        Date.parse('2026-10-19T12:01:00Z')
      )
    ).toBe(true);
    expect(quotaFor({ name: 'renamed.json', authIndex: '1' }, result.accounts)).toBe(
      result.accounts[0]
    );
  });
  test('invalid quota shapes fail instead of showing healthy zeroes', () => {
    expect(() => normalizeResetRouterStatus({})).toThrow();
    expect(parseDuration('invalid')).toBe(0);
    expect(parseDuration('1h30m5s')).toBe(5405000);
  });
  test('counts bucket traffic once when an inline key also appears as a credential', () => {
    const usage = {
      claude: {
        'https://example.test|secret': {
          success: 999,
          recent_requests: [{ time: '12:00-12:10', success: 9, failed: 1 }],
        },
      },
    };
    const files = [
      {
        name: 'one',
        type: 'claude',
        account_type: 'api_key',
        account: 'secret',
        recentRequests: [{ time: '12:00-12:10', success: 9, failed: 1 }],
      },
      {
        name: 'two',
        type: 'codex',
        recentRequests: [{ time: '12:00-12:10', success: 5, failed: 0 }],
      },
    ];
    expect(summarizeTraffic(files, usage, '').total).toBe(15);
    expect(summarizeTraffic(files, usage, 'claude').total).toBe(10);
    expect(summarizeTraffic(files, usage, 'codex').total).toBe(5);
    expect(summarizeTraffic([], {}, '').successRate).toBeNull();
    expect(accountLabel(files[0])).toBe('one');
  });
  test('does not infer enabled affinity or plugin from missing configuration', () => {
    expect(overviewRouting(null)).toEqual({ affinity: null, quotaPlugin: false });
    expect(
      overviewRouting({
        raw: {
          routing: { 'session-affinity': false },
          plugins: { enabled: true, configs: { 'quota-reset-router': { enabled: true } } },
        },
      })
    ).toEqual({ affinity: false, quotaPlugin: true });
  });
  test('rejects old connection and unmounted responses including ABA revisions', () => {
    expect(sessionMatches(1, 1, true)).toBe(true);
    expect(sessionMatches(1, 3, true)).toBe(false);
    expect(sessionMatches(1, 1, false)).toBe(false);
  });
});

test('quota reader follows the active router after migration and rollback', () => {
  const config = {
    raw: {
      plugins: {
        enabled: true,
        configs: {
          'quota-reset-router': { enabled: true },
          'kpatdev-quota-router': { enabled: true },
        },
      },
    },
  };
  expect(quotaRouterId(config)).toBe('kpatdev-quota-router');
  config.raw.plugins.configs['kpatdev-quota-router'].enabled = false;
  expect(quotaRouterId(config)).toBe('quota-reset-router');
  config.raw.plugins.enabled = false;
  expect(quotaRouterId(config)).toBeNull();
});

test('custom router reads quota from exact account IDs, not redacted status labels', () => {
  const make = (id: string, used: number) => ({
    id,
    provider: 'claude',
    windows: [
      {
        key: 'weekly',
        kind: 'weekly',
        used_percent: used,
        observed_at: '2026-11-05T18:00:00Z',
        resets_at: '2026-11-07T18:00:00Z',
      },
    ],
  });
  const result = normalizeKpatdevQuota(
    { accounts: { masked: { provider: 'claude' } }, max_age: '10m' },
    { accounts: [make('bob-a.json', 90), make('bob-b.json', 20)] }
  );
  expect(result.accounts.map((a) => [a.id, a.windows[0].id, a.windows[0].used])).toEqual([
    ['bob-a.json', 'seven_day', 90],
    ['bob-b.json', 'seven_day', 20],
  ]);
  expect(result.maxAgeMs).toBe(600000);
  expect(result.accounts[0].readAt).toBe(Date.parse('2026-11-05T18:00:00Z'));
});
