// Normalize the authenticated custom router's account view to the recorder contract.
// Match exact credential IDs, never redacted display names (which can collide).
export function kpatdevQuotaStatus(status, detail, credentials) {
  if (!Array.isArray(detail?.accounts) || !Array.isArray(credentials?.files)) throw new Error('Invalid quota accounts');
  const accounts = {};
  for (const a of detail.accounts) {
    const credential = credentials.files.find(f => f.id === a.id || f.name === a.id);
    if (!credential || !Array.isArray(a.windows)) continue;
    const observations = a.windows.map(w => Date.parse(w.observed_at));
    const readAt = observations.length && observations.every(Number.isFinite) ? Math.min(...observations) : NaN;
    const quota = {read_at: Number.isFinite(readAt) ? new Date(readAt).toISOString() : null};
    for (const w of a.windows) {
      const id = w.kind === 'weekly' ? 'seven_day' : w.kind === 'model_weekly' ? `seven_day_${w.family}` : w.key;
      quota[id] = {utilization:w.used_percent, resets_at:w.resets_at};
    }
    accounts[a.id] = {auth_index:credential.auth_index, provider:a.provider, quota, consecutive_failures:a.poll_error || a.windows.some(w => w.stale) ? 1 : 0};
  }
  return {...status, accounts};
}
// Read cached quota only; never call inference or store credentials/prompt data.
export function quotaSnapshot(status, credentials, at = Date.now()) {
  if (!status?.accounts || !Array.isArray(credentials?.files) || status.worker_failed) throw new Error('Quota unavailable');
  const active = new Set(credentials.files.filter(f => !f.disabled).map(f => String(f.auth_index)));
  const accounts = Object.values(status.accounts).flatMap(a => {
    const readAt = Date.parse(a.quota?.read_at);
    if (!active.has(a.auth_index) || a.consecutive_failures > 0 || !Number.isFinite(readAt) || at - readAt > 20 * 60000 || readAt > at + 60000) return [];
    // Don't drop a limiting window just because its cached reset has elapsed.
    if (Object.values(a.quota ?? {}).some(w => w && typeof w === 'object' && Number.isFinite(w.utilization) && Number.isFinite(Date.parse(w.resets_at)) && Date.parse(w.resets_at) <= at)) return [];
    const windows = Object.entries(a.quota ?? {}).flatMap(([id, w]) => {
      if (!w || typeof w !== 'object' || !Number.isFinite(w.utilization)) return [];
      const resetAt = Date.parse(w.resets_at);
      // An elapsed reset is not proof that quota has replenished.
      if (Number.isFinite(resetAt) && resetAt <= at) return [];
      return [{id, remaining: Math.max(0, Math.min(100, 100 - w.utilization)), resetAt: Number.isFinite(resetAt) ? resetAt : null}];
    });
    return windows.length ? [{id: String(a.auth_index), provider: String(a.provider), readAt, windows}] : [];
  });
  return {at, accounts};
}
export function openQuotaStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS quota_samples (at INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  return {
    record(snapshot) {
      db.prepare('INSERT OR REPLACE INTO quota_samples VALUES (?, ?)').run(snapshot.at, JSON.stringify(snapshot));
      db.prepare('DELETE FROM quota_samples WHERE at < ?').run(snapshot.at - 32 * 86400000);
    },
    history(now = Date.now()) {
      // Bounded two-week chart; preserve the newest observation in each five-minute bucket.
      const rows = db.prepare(`SELECT data FROM quota_samples WHERE at IN
        (SELECT MAX(at) FROM quota_samples WHERE at >= ? AND at <= ? GROUP BY CAST(at / 300000 AS INTEGER)) ORDER BY at`).all(now - 14 * 86400000, now);
      // Include a seven-day lead-in for the earliest visible weekly cycle.
      // Recorded token activity supplies the shape of reconstructed history. No
      // prompt content, credential secrets or inferred quota is written to events.
      const activity = db.prepare(`SELECT account, CAST(at / 1800000 AS INTEGER) * 1800000 AS at,
        SUM(input + cacheRead + cacheWrite + output) AS tokens FROM events
        WHERE at >= ? AND at <= ? AND incomplete = 0 GROUP BY account, CAST(at / 1800000 AS INTEGER)
        ORDER BY at`).all(now - 21 * 86400000, now);
      return {version: 1, now, samples: rows.map(r => JSON.parse(r.data)), activity};
    },
  };
}
