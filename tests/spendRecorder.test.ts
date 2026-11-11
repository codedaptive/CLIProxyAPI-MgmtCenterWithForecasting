import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
test('Node recorder storage, authentication and ingestion contracts', () => {
  const result = spawnSync(
    'node',
    [
      '--test',
      'tests/helpers/spend-store.check.mjs',
      'tests/helpers/spend-server.check.mjs',
      'tests/helpers/spend-quota.check.mjs',
      'tests/helpers/spend-planning.check.mjs',
      'tests/helpers/spend-prices.check.mjs',
    ],
    { encoding: 'utf8', timeout: 15000 }
  );
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  expect(result.status).toBe(0);
}, 20000);
