import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createPriceCatalog } from './plan-prices.mjs';
import { openPlanningStore } from './planning.mjs';
import { openStore } from './store.mjs';
import { diagnosticMetadata } from './diagnostics.mjs';
import { openQuotaStore, quotaSnapshot, kpatdevQuotaStatus } from './quota.mjs';
import { validateAccountAliases, aliasSpendReport, aliasSpendTimeline } from './account-aliases.mjs';

process.umask(0o077);
const state = process.env.MINILLM_SPEND_STATE || path.join(os.homedir(), '.config/cliproxy-home/spend');
const access = process.env.MINILLM_ACCESS_FILE || path.join(os.homedir(), '.config/cliproxy-home/access.json');
const upstream = process.env.MINILLM_SPEND_UPSTREAM || 'http://127.0.0.1:8317';
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
const store = openStore(path.join(state, 'usage.sqlite'));
const quotaStore = openQuotaStore(store.db);
const planningStore = openPlanningStore(store);
const catalogPath = path.join(state, 'plan-catalog.json');
let savedCatalog = null;
try { savedCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); } catch {}
const priceCatalog = createPriceCatalog(fetch, savedCatalog, catalog => {
  fs.writeFileSync(catalogPath + '.new', JSON.stringify(catalog));
  fs.renameSync(catalogPath + '.new', catalogPath);
});
const aliases = () => {
  const file = path.join(state, 'account-aliases.json');
  return fs.existsSync(file) ? validateAccountAliases(JSON.parse(fs.readFileSync(file, 'utf8'))) : Object.create(null);
};
const key = () => JSON.parse(fs.readFileSync(access, 'utf8')).management_key;
const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(body));
};
const authorized = (req) => {
  const a = Buffer.from(req.headers.authorization || '');
  const b = Buffer.from(`Bearer ${key()}`);
  return a.length === b.length && timingSafeEqual(a,b);
};
const server = createServer(async (req, res) => {
  try {
    if (!authorized(req)) return reply(res, 401, { error:'Unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/minillm/spend') return reply(res,404,{error:'Not found'});
    if (url.searchParams.get('view') === 'plan-prices') {
      if (req.method === 'POST') return reply(res,200,await priceCatalog.refresh());
      if (req.method === 'GET') return reply(res,200,priceCatalog.read());
      return reply(res,405,{error:'Method not allowed'});
    }
    if (req.method === 'GET') {
      if (url.searchParams.get('view') === 'planning') return reply(res,200,{version:1,...planningStore.evidence(),terms:planningStore.terms()});
      if (url.searchParams.get('view') === 'activity') return reply(res,200,store.activity());
      if (url.searchParams.get('view') === 'quota') return reply(res,200,{...quotaStore.history(), error:store.getMeta('quotaError') || null});
      const month = url.searchParams.get('month') || '';
      const start = Number(url.searchParams.get('start'));
      const end = Number(url.searchParams.get('end'));
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) || end <= start || end-start > 32*86400000) return reply(res,400,{error:'Invalid month'});
      if (url.searchParams.get('view') === 'timeline') return reply(res,200,aliasSpendTimeline(store.timeline(month,start,end), aliases()));
      return reply(res,200,aliasSpendReport({...store.report(month,start,end),terms:planningStore.terms()}, aliases()));
    }
    if (req.method === 'PUT') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return reply(res,415,{error:'JSON required'});
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) return reply(res,413,{error:'Too large'}); }
      try {
        const {month,account,amount,terms} = JSON.parse(body);
        const canonical=aliases()[account]?.account ?? account;
        // Price and contract metadata commit together or not at all.
        store.db.exec('BEGIN IMMEDIATE');
        try {
          store.setPlan(month,canonical,amount);
          if(terms!==undefined)planningStore.save(canonical,terms);
          store.db.exec('COMMIT');
        } catch(error) {store.db.exec('ROLLBACK');throw error;}
      } catch { return reply(res,400,{error:'Invalid plan'}); }
      return reply(res,200,{ok:true});
    }
    return reply(res,405,{error:'Method not allowed'});
  } catch { reply(res,503,{error:'Recorder unavailable'}); }
});

// Bind before polling: a second collector must not drain the same queue.
server.listen(Number(process.env.MINILLM_SPEND_PORT || 8318), '127.0.0.1', () => { void poll(); void pollQuota(); });
let stopping = false;
let timer;
let quotaTimer;
async function pollQuota() {
  try {
    const config = await request('/config');
    const pluginId = config.plugins?.enabled === true && ['kpatdev-quota-router', 'quota-reset-router'].find(id => config.plugins?.configs?.[id]?.enabled === true);
    if (!pluginId) throw new Error('Quota router is disabled');
    const [status, credentials] = await Promise.all([
      fetch(`${upstream}/v0/management/plugins/${pluginId}/status`, {headers:{Authorization:`Bearer ${key()}`}, signal:AbortSignal.timeout(8000), redirect:'error'}).then(r => {if (!r.ok) throw new Error('Quota unavailable'); return r.json();}),
      request('/credentials'),
    ]);
    let quotaStatus = status;
    if (pluginId === 'kpatdev-quota-router') {
      const r = await fetch(`${upstream}/v0/management/plugins/${pluginId}/accounts`, {headers:{Authorization:`Bearer ${key()}`}, signal:AbortSignal.timeout(8000), redirect:'error'});
      if (!r.ok) throw new Error('Quota accounts unavailable');
      quotaStatus = kpatdevQuotaStatus(status, await r.json(), credentials);
    }
    quotaStore.record(quotaSnapshot(quotaStatus, credentials));
    store.setMeta('quotaError', '');
  } catch { store.setMeta('quotaError', 'Quota collection unavailable'); }
  finally { if (!stopping) quotaTimer=setTimeout(pollQuota,60000); }
}
async function request(route) {
  const response = await fetch(`${upstream}/v8/management${route}`, {
    headers: { Authorization:`Bearer ${key()}` }, signal:AbortSignal.timeout(8000), redirect:'error',
  });
  if (!response.ok) throw new Error('Upstream unavailable');
  return response.json();
}
async function poll() {
  try {
    // A small metadata-only spool makes a failed SQLite commit retryable without storing keys.
    const pendingPath = path.join(state,'pending.json');
    if (fs.existsSync(pendingPath)) {
      const pending = JSON.parse(fs.readFileSync(pendingPath,'utf8'));
      store.record(pending);
      fs.unlinkSync(pendingPath);
    }
    const enabled = await request('/config/observability/usage/usage-statistics-enabled');
    store.setMeta('enabled', enabled === true);
    if (enabled === true) {
      for (let batch = 0; batch < 10; batch++) {
        const rows = await request('/observability/usage/queue?count=500');
        if (!Array.isArray(rows)) throw new Error('Invalid queue');
        // Explicit allowlist; never write api_key, source, headers, or failure bodies.
        const safe = rows.map(r => ({execution_id:r.execution_id,timestamp:r.timestamp,auth_index:r.auth_index,
          provider:r.provider,model:r.model,failed:r.failed,generate:r.generate,diagnostics:diagnosticMetadata(r),token_breakdown:r.token_breakdown && {
            schema_version:r.token_breakdown.schema_version,quality:r.token_breakdown.quality,
            total_tokens:r.token_breakdown.total_tokens,unclassified_tokens:r.token_breakdown.unclassified_tokens,
            input: r.token_breakdown.input && {
              total_tokens:r.token_breakdown.input.total_tokens,uncached_tokens:r.token_breakdown.input.uncached_tokens,
              cache_read_tokens:r.token_breakdown.input.cache_read_tokens,cache_write_tokens:r.token_breakdown.input.cache_write_tokens},
            output:r.token_breakdown.output && {total_tokens:r.token_breakdown.output.total_tokens,
              non_reasoning_tokens:r.token_breakdown.output.non_reasoning_tokens,reasoning_tokens:r.token_breakdown.output.reasoning_tokens},
          }}));
        if (safe.length) {
          fs.writeFileSync(pendingPath+'.tmp', JSON.stringify(safe),{mode:0o600});
          fs.renameSync(pendingPath+'.tmp',pendingPath);
          store.record(safe);
          fs.unlinkSync(pendingPath);
        }
        if (rows.length < 500) break;
      }
    }
    const previous = Number(store.getMeta('lastPoll'));
    if (previous && Date.now()-previous > 60000) store.setMeta('gaps',Number(store.getMeta('gaps') || 0)+1);
    store.setMeta('lastPoll',Date.now());
    store.setMeta('error','');
  } catch {
    // Never log raw responses or request headers.
    store.setMeta('error','Collection interrupted; totals may be incomplete.');
  } finally { if (!stopping) timer=setTimeout(poll,5000); }
}
process.on('SIGTERM', () => { stopping=true; clearTimeout(timer); clearTimeout(quotaTimer); server.close(); });
