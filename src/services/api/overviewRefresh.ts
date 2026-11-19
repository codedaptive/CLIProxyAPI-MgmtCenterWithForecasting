import { apiClient } from './client';
import { quotaRouterId } from './overview';
import { isRecord } from '@/utils/helpers';
import type { Config } from '@/types';

export class OverviewQuotaRefreshError extends Error {
  constructor(public readonly reason: 'incomplete' | 'timeout' | 'unsupported') {
    super(reason);
  }
}

type RefreshClient = Pick<typeof apiClient, 'get' | 'post'>;
const pollTimes = (raw: unknown) => {
  if (!isRecord(raw) || !Array.isArray(raw.accounts)) throw new Error('Invalid quota accounts');
  return raw.accounts
    .filter(isRecord)
    .filter((a) => typeof a.id === 'string' && a.present === true && !a.disabled);
};

/** POST once; subsequent reads only wait for the central poller, never recheck providers. */
export async function refreshOverviewQuota(
  apiBase: string,
  config: Config | null,
  current: () => boolean,
  client: RefreshClient = apiClient.captureConnection(current),
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 1000)),
  now: () => number = Date.now
) {
  if (!current()) return;
  const id = quotaRouterId(config);
  if (!id) return;
  if (id !== 'kpatdev-quota-router') throw new OverviewQuotaRefreshError('unsupported');
  const base = apiBase.replace(/\/+$/, '').replace(/\/v8\/management$/, '');
  const path = `${base}/v0/management/plugins/${id}`;
  const before = pollTimes(await client.get<unknown>(`${path}/accounts`, { timeout: 10000 }));
  if (!current() || !before.length) return;
  const pending = new Map(before.map((a) => [String(a.id), String(a.last_poll_at ?? '')]));
  await client.post(`${path}/refresh`, {}, { timeout: 10000 });
  const deadline = now() + 60000;
  let failed = false;
  while (current() && now() < deadline) {
    await pause();
    if (!current()) return;
    const accounts = pollTimes(await client.get<unknown>(`${path}/accounts`, { timeout: 10000 }));
    if (!current()) return;
    for (const [id, previous] of pending) {
      const account = accounts.find((a) => a.id === id);
      if (!account) {
        pending.delete(id); // Removed or disabled while checking.
      } else if (
        typeof account.last_poll_at === 'string' &&
        Number.isFinite(Date.parse(account.last_poll_at)) &&
        Date.parse(account.last_poll_at) > (Date.parse(previous) || 0)
      ) {
        failed ||= Boolean(account.poll_error);
        pending.delete(id);
      }
    }
    if (!pending.size) {
      if (failed) throw new OverviewQuotaRefreshError('incomplete');
      return;
    }
  }
  if (current()) throw new OverviewQuotaRefreshError('timeout');
}
