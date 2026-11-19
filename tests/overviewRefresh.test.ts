import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { refreshOverviewQuota } from '../src/services/api/overviewRefresh';
import type { Config } from '../src/types';

const config: Config = {
  raw: { plugins: { enabled: true, configs: { 'kpatdev-quota-router': { enabled: true } } } },
};
const old = '2026-11-19T18:00:00Z';
const fresh = '2026-11-19T18:01:00Z';
const account = (id = 'a', last_poll_at = old, poll_error = '') => ({
  id,
  last_poll_at,
  poll_error,
  present: true,
  disabled: false,
});
function harness(snapshots: unknown[], postError?: Error) {
  let time = 0;
  let active = true;
  let reads = 0;
  const posts: { url: string; data: unknown }[] = [];
  const client = {
    async get<T>(): Promise<T> {
      return snapshots[Math.min(reads++, snapshots.length - 1)] as T;
    },
    async post<T>(url: string, data?: unknown): Promise<T> {
      posts.push({ url, data });
      if (postError) throw postError;
      return { scheduled: 2 } as T;
    },
  };
  return {
    posts,
    reads: () => reads,
    stop: () => {
      active = false;
    },
    run: (pause?: () => Promise<void>) =>
      refreshOverviewQuota(
        'https://proxy.test/v8/management',
        config,
        () => active,
        client,
        pause ??
          (async () => {
            time += 1000;
          }),
        () => time
      ),
  };
}

test('manual refresh schedules provider checks once and waits for every enabled account', async () => {
  const h = harness([
    { accounts: [account(), account('b'), { ...account('disabled'), disabled: true }] },
    { accounts: [{ ...account(), last_observed_at: fresh }, account('b', fresh)] },
    { accounts: [account('a', fresh), account('b', fresh)] },
  ]);
  await h.run();
  expect(h.posts).toEqual([
    { url: 'https://proxy.test/v0/management/plugins/kpatdev-quota-router/refresh', data: {} },
  ]);
  expect(h.reads()).toBe(3); // Passive response headers did not satisfy a requested provider poll.
});

test('completed poll errors and provider cooldowns are reported rather than stale success', async () => {
  const h = harness([
    { accounts: [account()] },
    { accounts: [account('a', fresh, 'quota_http_429')] },
  ]);
  await expect(h.run()).rejects.toMatchObject({ reason: 'incomplete' });
  const limited = harness([{ accounts: [account()] }], new Error('429 Rate limited'));
  await expect(limited.run()).rejects.toThrow('429');
  expect(limited.posts).toHaveLength(1);
  expect(limited.reads()).toBe(1);
});

test('a scheduled response is not completion; timeout never schedules another provider check', async () => {
  const h = harness([{ accounts: [account()] }]);
  await expect(h.run()).rejects.toMatchObject({ reason: 'timeout' });
  expect(h.posts).toHaveLength(1);
  expect(h.reads()).toBe(61);
});

test('connection changes stop polling and removed accounts do not keep the button waiting', async () => {
  const h = harness([{ accounts: [account()] }]);
  await h.run(async () => h.stop());
  expect(h.reads()).toBe(1);
  const removed = harness([{ accounts: [account()] }, { accounts: [] }]);
  await removed.run();
  expect(removed.reads()).toBe(2);
});

test('Overview timers and visibility callbacks use cached reads; only manual refresh forces quota', () => {
  const source = readFileSync('src/features/overview/useOverview.ts', 'utf8');
  expect(source).toContain('const refresh = (forceQuota = false)');
  expect(source).toContain('await refresh(true)');
  expect(source).toContain("if (document.visibilityState === 'visible') void refresh();");
  const direct = readFileSync('src/features/overview/useOverviewClaudeQuota.ts', 'utf8');
  expect(direct).not.toContain('setInterval');
  expect(direct).not.toContain('useEffect');
});
