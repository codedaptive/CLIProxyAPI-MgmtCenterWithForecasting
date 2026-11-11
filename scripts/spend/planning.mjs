// Metadata-only planning; no inference, credentials, prompts, or quota refreshes.
const DAY = 86400000;
export function validateTerms(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.planType !== 'string' ||
    !value.planType.trim() ||
    value.planType.length > 100 ||
    !['monthly', 'annual'].includes(value.cadence) ||
    !(
      value.renewalDate === null ||
      (typeof value.renewalDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.renewalDate) &&
        Number.isFinite(Date.parse(value.renewalDate)) &&
        new Date(value.renewalDate).toISOString().slice(0, 10) === value.renewalDate)
    )
  )
    throw new Error('Invalid subscription terms');
  if (
    value.planId !== undefined &&
    (typeof value.planId !== 'string' || !value.planId.trim() || value.planId.length > 200)
  )
    throw new Error('Invalid published plan ID');
  return {
    planType: value.planType.trim(),
    cadence: value.cadence,
    renewalDate: value.renewalDate,
    ...(value.planId ? { planId: value.planId } : {}),
  };
}
export function openPlanningStore(store) {
  const db = store.db;
  db.exec(
    'CREATE TABLE IF NOT EXISTS subscription_terms (account TEXT PRIMARY KEY, data TEXT NOT NULL)'
  );
  let cached;
  const terms = () =>
    Object.fromEntries(
      db
        .prepare('SELECT account,data FROM subscription_terms')
        .all()
        .map((r) => [r.account, JSON.parse(r.data)])
    );
  return {
    terms,
    save(account, value) {
      if (typeof account !== 'string' || !account || account.length > 256)
        throw new Error('Invalid account');
      const clean = validateTerms(value);
      db.prepare('INSERT OR REPLACE INTO subscription_terms VALUES (?,?)').run(
        account,
        JSON.stringify(clean)
      );
    },
    evidence(now = Date.now()) {
      if (cached && now - cached.now < 60000) return cached;
      const samples = db
        .prepare('SELECT data FROM quota_samples WHERE at>=? AND at<=? ORDER BY at')
        .all(now - 30 * DAY, now)
        .map((r) => JSON.parse(r.data));
      const byAccount = new Map();
      for (const sample of samples)
        for (const a of sample.accounts) {
          let reads = byAccount.get(a.id);
          if (!reads) {
            reads = [];
            byAccount.set(a.id, reads);
          }
          if (!reads.length || a.readAt > reads.at(-1).readAt) reads.push(a);
        }
      const quotaRuns = [];
      let invalid = 0;
      for (const [account, reads] of byAccount) {
        if (reads.length < 2) continue;
        const events = db
          .prepare(
            'SELECT at,model,prompt,input,output,cacheRead,cacheWrite,input+output+cacheRead+cacheWrite AS tokens,incomplete,failed FROM spend_accounting_v1 WHERE account=? AND at>? AND at<=? ORDER BY at'
          )
          .all(account, reads[0].readAt, reads.at(-1).readAt);
        let cursor = 0;
        const pending = new Map();
        const finish = (id) => {
          const run = pending.get(id);
          pending.delete(id);
          if (!run) return;
          const used = run.startRemaining - run.endRemaining;
          const rows = [...run.rows.values()];
          if (used <= 0 || used > 100 || !rows.length) return;
          quotaRuns.push({ ...run, rows, used, exhausted: run.endRemaining === 0 });
        };
        for (let i = 1; i < reads.length; i++) {
          const previous = reads[i - 1],
            next = reads[i],
            batch = [];
          let bad = false;
          while (cursor < events.length && events[cursor].at <= previous.readAt) cursor++;
          while (cursor < events.length && events[cursor].at <= next.readAt) {
            const e = events[cursor++];
            if (e.incomplete) {
              bad = true;
              continue;
            }
            if (e.tokens > 0) batch.push(e);
          }
          for (const id of [...pending.keys()])
            if (!next.windows.some((w) => w.id === id)) finish(id);
          for (const w of next.windows) {
            if (
              ![
                'seven_day',
                'five_hour',
                'seven_day_fable',
                'seven_day_sonnet',
                'seven_day_opus',
                'seven_day_haiku',
              ].includes(w.id)
            )
              continue;
            const p = previous.windows.find((x) => x.id === w.id);
            // A reset or a refill (even with the same reset timestamp) starts a
            // new run. Never charge tokens spanning an unknown reset to either.
            if (
              bad ||
              !p ||
              !Number.isFinite(p.resetAt) ||
              !Number.isFinite(w.resetAt) ||
              Math.abs(p.resetAt - w.resetAt) > 5000 ||
              next.readAt >= p.resetAt ||
              w.remaining > p.remaining ||
              p.remaining === 0
            ) {
              finish(w.id);
              if (bad) invalid++;
              continue;
            }
            let run = pending.get(w.id);
            if (!run)
              run = {
                account,
                provider: next.provider,
                window: w.id,
                resetAt: w.resetAt,
                start: previous.readAt,
                end: next.readAt,
                startRemaining: p.remaining,
                endRemaining: w.remaining,
                rows: new Map(),
                intervals: 0,
              };
            run.intervals++;
            run.end = next.readAt;
            run.endRemaining = w.remaining;
            for (const e of batch) {
              if (w.id.startsWith('seven_day_') && !e.model.toLowerCase().includes(w.id.slice(10)))
                continue;
              const r = run.rows.get(e.model) || {
                account,
                provider: next.provider,
                model: e.model,
                prompt: 0,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                incomplete: 0,
                failed: 0,
                requests: 0,
              };
              for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) r[k] += e[k];
              r.prompt = Math.max(r.prompt, e.prompt);
              r.requests++;
              r.failed += e.failed;
              run.rows.set(e.model, r);
            }
            pending.set(w.id, run);
            if (w.remaining === 0) finish(w.id);
          }
        }
        for (const id of [...pending.keys()]) finish(id);
      }
      const mixed = quotaRuns.filter((r) => r.rows.length > 1);
      const cycles = quotaRuns
        .filter((r) => r.rows.length === 1)
        .map((r) => ({
          ...r,
          model: r.rows[0].model,
          tokens: r.rows.reduce((n, t) => n + t.input + t.output + t.cacheRead + t.cacheWrite, 0),
        }));
      cached = {
        now,
        quotaSince: samples[0]?.at ?? null,
        mixedIntervals: mixed.length,
        invalidIntervals: invalid,
        windows: [...byAccount].flatMap(([account, reads]) =>
          [...new Set(reads.flatMap((r) => r.windows.map((w) => w.id)))]
            .filter((window) =>
              [
                'seven_day',
                'five_hour',
                'seven_day_fable',
                'seven_day_sonnet',
                'seven_day_opus',
                'seven_day_haiku',
              ].includes(window)
            )
            .map((window) => ({ account, window }))
        ),
        quotaRuns,
        mixed,
        cycles,
      };
      return cached;
    },
  };
}
