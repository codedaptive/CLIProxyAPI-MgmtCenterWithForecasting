import { DatabaseSync } from 'node:sqlite';
import { validDiagnostics } from './diagnostics.mjs';

const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max;

// CPA v8.0.30 canonical accounting v2. Never persist raw queue records: they contain keys.
export function sanitizeRecord(value) {
  if (!value || !text(value.execution_id) || !text(value.model) || !text(value.provider)) return null;
  const at = Date.parse(value.timestamp);
  if (!Number.isFinite(at)) return null;
  const b = value.token_breakdown;
  const i = b?.input;
  const o = b?.output;
  const complete = b?.schema_version === 2 && b.quality === 'complete' &&
    [b.total_tokens, b.unclassified_tokens, i?.total_tokens, i?.uncached_tokens,
      i?.cache_read_tokens, i?.cache_write_tokens, o?.total_tokens,
      o?.non_reasoning_tokens, o?.reasoning_tokens].every(integer) &&
    b.unclassified_tokens === 0 &&
    i.total_tokens === i.uncached_tokens + i.cache_read_tokens + i.cache_write_tokens &&
    o.total_tokens === o.non_reasoning_tokens + o.reasoning_tokens &&
    b.total_tokens === i.total_tokens + o.total_tokens;
  return {
    id: value.execution_id, at,
    account: text(value.auth_index) ? value.auth_index : 'unattributed',
    provider: value.provider, model: value.model,
    input: complete ? i.uncached_tokens : 0,
    cacheRead: complete ? i.cache_read_tokens : 0,
    cacheWrite: complete ? i.cache_write_tokens : 0,
    output: complete ? o.total_tokens : 0,
    prompt: complete ? i.total_tokens : 0,
    incomplete: complete ? 0 : 1,
    failed: value.failed === true ? 1 : 0,
  };
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, at INTEGER, account TEXT, provider TEXT, model TEXT,
      input INTEGER, cacheRead INTEGER, cacheWrite INTEGER, output INTEGER,
      prompt INTEGER, incomplete INTEGER, failed INTEGER);
    CREATE INDEX IF NOT EXISTS events_at ON events(at);
    CREATE INDEX IF NOT EXISTS events_account_at ON events(account, at);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS plans (
      month TEXT, account TEXT, amount REAL, PRIMARY KEY(month, account));
    CREATE TABLE IF NOT EXISTS cache_diagnostics (
      id TEXT PRIMARY KEY, session TEXT, parent TEXT, trace TEXT, endpoint TEXT,
      client TEXT, tokenVersion TEXT, effort TEXT, node TEXT, fork INTEGER,
      compaction INTEGER, latency INTEGER, ttft INTEGER);
    CREATE INDEX IF NOT EXISTS cache_diagnostics_session ON cache_diagnostics(session);`);
  // User-approved API-equivalent estimate, not a measured upstream write count.
  // Apply per execution BEFORE grouping: a short request must not inherit a
  // larger request's cache eligibility. Preserve events as the original ledger.
  // Version the view so a future method can coexist with this audit trail.
  db.exec(`CREATE VIEW IF NOT EXISTS spend_accounting_v1 AS
    SELECT id, at, account, provider, model,
      input - estimatedCacheWrite AS input, cacheRead,
      cacheWrite + estimatedCacheWrite AS cacheWrite,
      output, prompt, incomplete, failed, estimatedCacheWrite
    FROM (SELECT events.*,
      CASE WHEN provider = 'codex' AND model = 'gpt-6.1-sol'
        AND incomplete = 0 AND failed = 0 AND cacheWrite = 0
        AND prompt >= 1024 AND input >= 0
        AND prompt = input + cacheRead + cacheWrite
        THEN input ELSE 0 END AS estimatedCacheWrite
      FROM events);`);
  const putMeta = db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)');
  const getMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  if (!getMeta('createdAt')) putMeta.run('createdAt', String(Date.now()));
  const insert = db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertDiagnostics = db.prepare('INSERT OR IGNORE INTO cache_diagnostics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  return {
    db, getMeta,
    setMeta(key, value) { putMeta.run(key, String(value)); },
    record(raw) {
      let rejected = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of raw) {
          if (item?.generate === false) continue; // Token-count / dry-run requests are not spend.
          const r = sanitizeRecord(item);
          if (!r) { rejected++; continue; }
          insert.run(r.id,r.at,r.account,r.provider,r.model,r.input,r.cacheRead,r.cacheWrite,r.output,r.prompt,r.incomplete,r.failed);
          const d = item.diagnostics;
          if (validDiagnostics(d)) insertDiagnostics.run(r.id,d.session,d.parent,d.trace,d.endpoint,d.client,d.tokenVersion,d.effort,d.node,Number(d.fork),Number(d.compaction),d.latency,d.ttft);
        }
        putMeta.run('rejected', String(Number(getMeta('rejected') || 0) + rejected));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    setPlan(month, account, amount) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !text(account) ||
          (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 100000))) {
        throw new Error('Invalid plan');
      }
      if (amount === null) db.prepare('DELETE FROM plans WHERE month = ? AND account = ?').run(month, account);
      else db.prepare('INSERT OR REPLACE INTO plans VALUES (?, ?, ?)').run(month, account, amount);
    },
    activity() {
      // Raw credential IDs match Overview, independently of spend-plan aliases.
      // Include failed attempts; exclude dry runs (which are never recorded).
      return {
        version: 1, lastPoll: Number(getMeta('lastPoll')) || null,
        error: getMeta('error'), enabled: getMeta('enabled') === 'true',
        lastUsed: Object.fromEntries(db.prepare(
          'SELECT account, MAX(at) AS at FROM events GROUP BY account'
        ).all().map(r => [r.account, r.at])),
      };
    },
    timeline(month, start, end, now = Date.now()) {
      // Preserve price bands within each half-hour bucket for exact API-rate allocation.
      const columns = `account, provider, model, MAX(prompt) AS prompt,
        SUM(input) AS input, SUM(cacheRead) AS cacheRead, SUM(cacheWrite) AS cacheWrite,
        SUM(estimatedCacheWrite) AS estimatedCacheWrite,
        SUM(output) AS output, SUM(incomplete) AS incomplete, SUM(failed) AS failed,
        COUNT(*) AS requests`;
      const groups = `account, provider, model, incomplete,
        CASE WHEN prompt <= 100000 THEN 0 WHEN prompt <= 199999 THEN 1
             WHEN prompt <= 272000 THEN 2 ELSE 3 END`;
      return {
        version: 1, cacheWriteEstimateVersion: 'sol-implicit-v1', month, now, start, end, bucketMs: 1800000,
        createdAt: Number(getMeta('createdAt')), lastPoll: Number(getMeta('lastPoll')) || null,
        error: getMeta('error'), enabled: getMeta('enabled') === 'true',
        rows: db.prepare(`SELECT CAST(at/1800000 AS INTEGER)*1800000 AS at, ${columns}
          FROM spend_accounting_v1 WHERE at >= ? AND at < ?
          GROUP BY CAST(at/1800000 AS INTEGER), ${groups} ORDER BY at`).all(start, Math.min(end, now)),
        recent: db.prepare(`SELECT ${columns} FROM spend_accounting_v1 WHERE at >= ? AND at < ?
          GROUP BY ${groups}`).all(now - 3*3600000, now),
      };
    },
    report(month, start, end) {
      return {
        version: 1, cacheWriteEstimateVersion: 'sol-implicit-v1', month,
        createdAt: Number(getMeta('createdAt')), lastPoll: Number(getMeta('lastPoll')) || null,
        enabled: getMeta('enabled') === 'true',
        error: getMeta('error'),
        rejected: Number(getMeta('rejected')) || 0,
        // Polling is best effort. Surface long gaps rather than claiming complete history.
        gaps: Number(getMeta('gaps')) || 0,
        // Price-band aggregation keeps large months small without changing costs.
        // Boundaries mirror rates.ts (Haiku, Grok, OpenAI); raw events stay intact.
        rows: db.prepare(`SELECT account, provider, model, MAX(prompt) AS prompt,
          SUM(input) AS input, SUM(cacheRead) AS cacheRead, SUM(cacheWrite) AS cacheWrite,
          SUM(estimatedCacheWrite) AS estimatedCacheWrite,
          SUM(output) AS output, SUM(incomplete) AS incomplete, SUM(failed) AS failed,
          COUNT(*) AS requests FROM spend_accounting_v1 WHERE at >= ? AND at < ?
          GROUP BY account, provider, model, incomplete,
            CASE WHEN prompt <= 100000 THEN 0 WHEN prompt <= 199999 THEN 1
                 WHEN prompt <= 272000 THEN 2 ELSE 3 END`).all(start, end),
        plans: Object.fromEntries(db.prepare('SELECT account, amount FROM plans WHERE month = ?').all(month).map(r => [r.account, r.amount])),
      };
    },
  };
}
