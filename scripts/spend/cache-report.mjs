import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// These are correlations, not assertions about why an upstream cache missed.
export function analyzeCache(rows, model = 'gpt-6.1-sol') {
  const previous = new Map();
  const clients = new Map();
  const correlations = new Map();
  const outliers = [];
  let requests = 0, uncached = 0, cached = 0, missingSession = 0;
  for (const row of [...rows].sort((a,b) => a.at-b.at || a.id.localeCompare(b.id))) {
    const prev = row.session ? previous.get(row.session) : null;
    const usable = !row.failed && !row.incomplete && row.prompt > 0;
    if (row.session && usable) previous.set(row.session,row);
    if (row.model !== model || !usable) continue;
    requests++; uncached += row.input; cached += row.cacheRead;
    if (!row.session) missingSession++;
    const group = `${row.client || 'unknown'} ${row.endpoint || 'unknown'}`;
    const c = clients.get(group) || {requests:0,uncached:0,cached:0};
    c.requests++;c.uncached+=row.input;c.cached+=row.cacheRead;clients.set(group,c);
    if (row.input < 50000) continue;
    const flags = [];
    if (!row.session) flags.push('session unavailable');
    else if (!prev) flags.push('first observed in diagnostic window');
    else {
      if (row.at < prev.at + (prev.latency ?? 0)) flags.push('overlapping requests');
      if (row.account !== prev.account) flags.push('account changed');
      if (row.effort !== prev.effort) flags.push('effort changed');
      if (row.model !== prev.model) flags.push('model changed');
      if (row.tokenVersion && prev.tokenVersion && row.tokenVersion !== prev.tokenVersion) flags.push('OAuth token changed');
      if (prev.compaction || row.compaction) flags.push('compaction flagged');
      const delta = row.prompt-prev.prompt;
      const tolerance = Math.max(10000,prev.prompt*.1);
      flags.push(delta>tolerance?'prompt grew':delta < -tolerance?'prompt shrank':'similar prompt length');
      if (row.account===prev.account && row.effort===prev.effort && row.model===prev.model) flags.push('same account/model/effort');
    }
    for (const flag of flags) {
      const c=correlations.get(flag)||{requests:0,uncached:0};c.requests++;c.uncached+=row.input;correlations.set(flag,c);
    }
    outliers.push({at:new Date(row.at).toISOString(),trace:row.trace,session:row.session?.slice(0,12)??null,client:row.client,endpoint:row.endpoint,prompt:row.prompt,uncached:row.input,cached:row.cacheRead,previousPrompt:prev?.prompt??null,previousCached:prev?.cacheRead??null,gapSeconds:prev?(row.at-prev.at)/1000:null,flags});
  }
  return {model,requests,uncached,cached,cacheReadPercent:uncached+cached?100*cached/(uncached+cached):null,missingSession,outlierRequests:outliers.length,clients:Object.fromEntries(clients),correlations:Object.fromEntries(correlations),largestOutliers:outliers.sort((a,b)=>b.uncached-a.uncached).slice(0,12)};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [dbPath, since = '1970-01-01T00:00:00Z', model='gpt-6.1-sol'] = process.argv.slice(2);
  if (!dbPath || !Number.isFinite(Date.parse(since))) throw new Error('Usage: node cache-report.mjs <usage.sqlite> [since ISO timestamp] [model]');
  const db=new DatabaseSync(dbPath,{readOnly:true});
  const rows=db.prepare(`SELECT e.*, d.session,d.parent,d.trace,d.endpoint,d.client,d.tokenVersion,d.effort,d.node,d.fork,d.compaction,d.latency,d.ttft
    FROM events e JOIN cache_diagnostics d ON d.id=e.id WHERE e.at>=? ORDER BY e.at`).all(Date.parse(since));
  console.log(JSON.stringify(analyzeCache(rows,model),null,2));db.close();
}
