import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

test('collector authenticates reads/writes, persists usage, never mutates the proxy',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'spend-http-'));
 const access=path.join(root,'access.json');fs.writeFileSync(access,JSON.stringify({management_key:'fixture-only'}));
 const methods=[];let sent=false;
 const upstream=createServer((req,res)=>{
  methods.push(req.method);assert.equal(req.headers.authorization,'Bearer fixture-only');
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/config')) return res.end(JSON.stringify({plugins:{enabled:true,configs:{'kpatdev-quota-router':{enabled:true},'quota-reset-router':{enabled:false}}}}));
  if(req.url.includes('kpatdev-quota-router/status')) return res.end(JSON.stringify({accounts:{a:{auth_index:'one',provider:'claude',quota:{read_at:new Date().toISOString(),five_hour:{utilization:25}}}}}));
  if(req.url.includes('kpatdev-quota-router/accounts')) return res.end(JSON.stringify({accounts:[{id:'fixture.json',provider:'claude',windows:[{key:'five_hour',kind:'five_hour',used_percent:25,observed_at:new Date().toISOString()}]}]}));
  if(req.url.endsWith('/credentials')) return res.end(JSON.stringify({files:[{name:'fixture.json',auth_index:'one',disabled:false}]}));
  if(req.url.endsWith('usage-statistics-enabled'))return res.end('true');
  if(req.url.includes('/usage/queue')) {
   const rows=sent?[]:[{execution_id:'test-id',session_id:'PRIVATE-SESSION',user_agent:'claude-cli/2.1.307 PRIVATE-UA',trace_id:'abc12345',endpoint:'POST /v1/messages',reasoning_effort:'high',timestamp:'2026-10-19T12:00:00Z',auth_index:'one',provider:'claude',model:'claude-opus-5-5',api_key:'SECRET-NOT-PERSISTED',token_breakdown:{schema_version:2,quality:'complete',total_tokens:12,unclassified_tokens:0,input:{total_tokens:10,uncached_tokens:10,cache_read_tokens:0,cache_write_tokens:0},output:{total_tokens:2,non_reasoning_tokens:2,reasoning_tokens:0}}}];
   sent=true;return res.end(JSON.stringify(rows));
  }
  res.statusCode=404;res.end('{}');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[new URL('../../scripts/spend/server.mjs',import.meta.url).pathname],{env:{...process.env,MINILLM_SPEND_PORT:String(port),MINILLM_ACCESS_FILE:access,MINILLM_SPEND_STATE:path.join(root,'data'),MINILLM_SPEND_UPSTREAM:`http://127.0.0.1:${upstream.address().port}`},stdio:'ignore'});
 const endpoint=`http://127.0.0.1:${port}/minillm/spend`;
 const query='?month=2026-10&start=1790812800000&end=1793491200000';
 const headers={Authorization:'Bearer fixture-only','Content-Type':'application/json'};
 try {
  let report;
  for(let i=0;i<100;i++) {try{const r=await fetch(endpoint+query,{headers});report=await r.json();if(report.rows?.length)break;}catch{}await delay(30);}
  const activity=await(await fetch(endpoint+'?view=activity',{headers})).json();
  assert.deepEqual(activity.lastUsed,{one:Date.parse('2026-10-19T12:00:00Z')});
  assert.equal((await fetch(endpoint+'?view=activity')).status,401);
  const quota=await(await fetch(endpoint+'?view=quota',{headers})).json();
  assert.equal(quota.samples.length,1);assert.equal(quota.samples[0].accounts[0].windows[0].remaining,75);
  assert.equal((await fetch(endpoint+'?view=quota')).status,401);
  const db=new DatabaseSync(path.join(root,'data','usage.sqlite'),{readOnly:true});
  const diag=db.prepare('SELECT * FROM cache_diagnostics').get();db.close();
  assert.equal(diag.client,'claude-code');assert.equal(diag.endpoint,'/v1/messages');assert.equal(diag.session.length,64);
  assert(!JSON.stringify(diag).includes('PRIVATE'));
  const timeline=await(await fetch(endpoint+query+'&view=timeline',{headers})).json();
  assert.equal(timeline.rows[0].input,10);assert.equal(timeline.bucketMs,1800000);
  assert.equal((await fetch(endpoint+query+'&view=timeline')).status,401);
  assert.equal((await fetch(endpoint+'?view=timeline&month=bad',{headers})).status,400);
  assert.equal(report.rows.length,1);assert.equal(report.rows[0].input,10);
  assert.equal((await fetch(endpoint+query)).status,401);
  assert.equal((await fetch(endpoint+query,{headers:{Authorization:'Bearer bad'}})).status,401);
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({month:'2026-10',account:'one',amount:200})})).status,200);
  assert.equal((await(await fetch(endpoint+query,{headers})).json()).plans.one,200);
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:'{"month":"bad"}'})).status,400);
  assert.equal((await fetch(endpoint,{method:'DELETE',headers})).status,405);
  const terms={planType:'Team Pro',cadence:'annual',renewalDate:'2027-02-28'};
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({month:'2026-10',account:'one',amount:200,terms})})).status,200);
  assert.deepEqual((await(await fetch(endpoint+query,{headers})).json()).terms.one,terms);
  assert.equal((await fetch(endpoint+'?view=planning')).status,401);
  const planning=await(await fetch(endpoint+'?view=planning',{headers})).json();assert.deepEqual(planning.terms.one,terms);assert(Array.isArray(planning.cycles));
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({month:'2026-10',account:'one',amount:999,terms:{...terms,renewalDate:'2027-02-30'}})})).status,400);
  assert.equal((await(await fetch(endpoint+query,{headers})).json()).plans.one,200);

  fs.writeFileSync(path.join(root,'data','account-aliases.json'),JSON.stringify({version:1,accounts:{next:{account:'one',provider:'test-provider',label:'Test provider'}}}));
  assert.equal((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({month:'2026-10',account:'next',amount:80})})).status,200);
  const aliased=await(await fetch(endpoint+query,{headers})).json();
  assert.equal(aliased.plans.one,80);assert.equal(aliased.plans.next,undefined);
  assert.equal(aliased.accountLabels.one,'Test provider');
  assert(methods.length>0);assert(methods.every(m=>m==='GET'));
  for(const file of fs.readdirSync(path.join(root,'data'))) {const bytes=fs.readFileSync(path.join(root,'data',file));assert(!bytes.includes(Buffer.from('SECRET-NOT-PERSISTED')));assert(!bytes.includes(Buffer.from('PRIVATE-SESSION')));assert(!bytes.includes(Buffer.from('PRIVATE-UA')));}
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>upstream.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
