import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore,sanitizeRecord} from '../../scripts/spend/store.mjs';
const record=(overrides={})=>({execution_id:'execution-1',timestamp:'2026-10-19T12:00:00Z',auth_index:'account-1',provider:'claude',model:'claude-opus-5-5',api_key:'DO-NOT-STORE',source:'DO-NOT-STORE',response_headers:{secret:'DO-NOT-STORE'},fail:{body:'DO-NOT-STORE'},token_breakdown:{schema_version:2,quality:'complete',total_tokens:145,unclassified_tokens:0,input:{total_tokens:125,uncached_tokens:100,cache_read_tokens:20,cache_write_tokens:5},output:{total_tokens:20,non_reasoning_tokens:12,reasoning_tokens:8}},...overrides});
test('canonical accounting avoids reasoning/cache double-counting and strips sensitive fields',()=>{
 const r=sanitizeRecord(record());assert.equal(r.input,100);assert.equal(r.output,20);assert.equal(r.cacheRead,20);assert.equal(r.cacheWrite,5);assert.equal(r.incomplete,0);
 assert(!JSON.stringify(r).includes('DO-NOT-STORE'));
 const bad=record();bad.token_breakdown.input.total_tokens=100;assert.equal(sanitizeRecord(bad).incomplete,1);
 assert.equal(sanitizeRecord({}),null);
});
test('durable, idempotent, month-scoped storage and plan fees',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spend-test-'));
 try {
  const file=path.join(dir,'usage.sqlite');let s=openStore(file);
  const now=Date.parse('2026-10-19T12:00:00Z');s.record([record(),record(),record({execution_id:'dry-run',generate:false})]);s.setPlan('2026-10','account-1',200);
  const r=s.report('2026-10',now,now+1);assert.equal(r.rows.length,1);assert.equal(r.rows[0].requests,1);assert.equal(r.plans['account-1'],200);
  assert.equal(s.report('2026-11',now+1,now+86400).rows.length,0);assert.deepEqual(s.report('2026-11',now,now+1).plans,{});
  assert.throws(()=>s.setPlan('2026-10','account-1',-1));assert.throws(()=>s.setPlan('2026-10','account-1','200'));
  s.db.close();s=openStore(file);assert.equal(s.report('2026-10',now,now+1).rows[0].requests,1);s.db.close();
  assert(!fs.readFileSync(file).includes(Buffer.from('DO-NOT-STORE')));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('protocol migration combines account spend without duplicating its plan price', async () => {
 const {validateAccountAliases,aliasSpendReport}=await import('../../scripts/spend/account-aliases.mjs');
 const aliases=validateAccountAliases({version:1,accounts:{native:{account:'original',provider:'glm',label:'GLM'}}});
 const original={plans:{original:80},rows:[{account:'original',provider:'glm',input:5},{account:'native',provider:'claude',input:7}]};
 const report=aliasSpendReport(original,aliases);
 assert.deepEqual(report.rows.map(r=>r.account),['original','original']);
 assert.deepEqual(report.rows.map(r=>r.provider),['glm','glm']);
 assert.equal(report.rows.reduce((n,r)=>n+r.input,0),12);
 assert.equal(Object.values(report.plans).reduce((a,b)=>a+b,0),80);
 assert.equal(report.accountLabels.original,'GLM');
 assert.equal(original.rows[1].account,'native');
 assert.throws(()=>aliasSpendReport({...original,plans:{original:80,native:90}},aliases));
 assert.throws(()=>validateAccountAliases({version:1,accounts:{a:{account:'b',provider:'x',label:'X'},b:{account:'c',provider:'x',label:'X'}}}));
});

test('report compacts prompt lengths but preserves every pricing boundary and incomplete bucket',()=>{
 const s=openStore(':memory:');
 const insert=s.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
 for (const [i,prompt] of [1,50,100000,100001,199999,200000,272000,272001,500000].entries()) insert.run(String(i),1,'a','codex','gpt-6.1-terra',prompt,0,0,10,prompt,0,0);
 insert.run('bad',1,'a','codex','gpt-6.1-terra',0,0,0,0,0,1,1);
 const rows=s.report('2026-11',0,2).rows;
 assert.equal(rows.length,5);
 assert.deepEqual(rows.filter(r=>!r.incomplete).map(r=>r.prompt).sort((a,b)=>a-b),[100000,199999,272000,500000]);
 assert.equal(rows.reduce((sum,r)=>sum+r.requests,0),10);
 assert.equal(rows.filter(r=>r.incomplete).length,1);
 assert.equal(rows.reduce((sum,r)=>sum+r.output,0),90);
 s.db.close();
});

test('timeline aggregates timestamps and pricing bands without losing category totals', async()=>{
 const s=openStore(':memory:');
 const at=Date.parse('2026-10-19T12:00:00Z');
 s.record([record(),record({execution_id:'later',timestamp:new Date(at+1800000).toISOString()}),record({execution_id:'boundary',timestamp:new Date(at+3600000).toISOString()})]);
 const result=s.timeline('2026-10',at,at+3600000,at+3600000);
 assert.equal(result.rows.length,2);
 assert.deepEqual(result.rows.map(r=>r.at),[at,at+1800000]);
 assert.equal(result.rows.reduce((n,r)=>n+r.cacheRead,0),40);
 assert.equal(result.rows.reduce((n,r)=>n+r.cacheWrite,0),10);
 assert.equal(result.recent.reduce((n,r)=>n+r.requests,0),2);
 const {aliasSpendTimeline,validateAccountAliases}=await import('../../scripts/spend/account-aliases.mjs');
 const mapped=aliasSpendTimeline(result,validateAccountAliases({version:1,accounts:{'account-1':{account:'old',provider:'glm',label:'GLM'}}}));
 assert.equal(mapped.rows[0].provider,'glm');assert.equal(mapped.recent[0].account,'old');
 assert(!JSON.stringify(mapped).includes('DO-NOT-STORE'));
 s.db.close();
});

test('cache diagnostics retain correlation metadata without raw identifiers or secrets',async()=>{
 const {diagnosticMetadata}=await import('../../scripts/spend/diagnostics.mjs');
 const s=openStore(':memory:');
 const diagnostics=diagnosticMetadata({session_id:'PRIVATE-SESSION',parent_session_id:'PRIVATE-PARENT',user_agent:'claude-cli/2.1.307 PRIVATE-UA',trace_id:'abc12345',endpoint:'POST /v1/messages',reasoning_effort:'high',is_compaction:true,latency_ms:200,ttft_ms:10,access_token_sha256:'a'.repeat(64)});
 s.record([record({diagnostics}),record({diagnostics})]);
 const d=s.db.prepare('SELECT * FROM cache_diagnostics').all();
 assert.equal(d.length,1);assert.equal(d[0].client,'claude-code');assert.equal(d[0].compaction,1);
 assert.equal(d[0].session.length,64);assert.equal(d[0].trace,'abc12345');
 assert(!JSON.stringify(d).includes('PRIVATE'));assert(!JSON.stringify(d).includes('DO-NOT-STORE'));
 assert.equal(s.report('2026-10',0,Date.now()).rows[0].requests,1);
 s.record([record({execution_id:'invalid-diag',diagnostics:{...diagnostics,session:'DO-NOT-STORE'}})]);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM cache_diagnostics').get().n,1);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n,2);
 const hostile=diagnosticMetadata({session_id:{token:'DO-NOT-STORE'},endpoint:'https://secret.example/DO-NOT-STORE',access_token_sha256:'DO-NOT-STORE',reasoning_effort:'DO-NOT-STORE',latency_ms:-1});
 assert.equal(hostile.session,null);assert.equal(hostile.endpoint,null);assert.equal(hostile.tokenVersion,null);assert.equal(hostile.effort,null);assert.equal(hostile.latency,null);
 s.db.close();
});

test('cache report distinguishes observed correlations without labeling first observations as new sessions',async()=>{
 const {analyzeCache}=await import('../../scripts/spend/cache-report.mjs');
 const base={id:'a',at:1000,model:'gpt-6.1-sol',account:'one',session:'hash',effort:'high',client:'claude-code',endpoint:'/v1/messages',input:60000,cacheRead:40000,prompt:100000,failed:0,incomplete:0,latency:100};
 const report=analyzeCache([base,{...base,id:'b',at:1100,input:70000,cacheRead:30000},{...base,id:'c',at:1150,account:'two',effort:'low'}]);
 assert.equal(report.requests,3);assert.equal(report.outlierRequests,3);
 assert.equal(report.correlations['first observed in diagnostic window'].requests,1);
 assert.equal(report.correlations['same account/model/effort'].requests,1);
 assert.equal(report.correlations['account changed'].requests,1);
 assert.equal(report.correlations['effort changed'].requests,1);
 assert.equal(report.correlations['overlapping requests'].requests,1);
 const absent=analyzeCache([{...base,session:null}]);assert.equal(absent.missingSession,1);
 assert.equal(absent.correlations['session unavailable'].requests,1);
});

test('Sol estimate splits each eligible execution before aggregation and keeps the raw ledger intact',()=>{
 const s=openStore(':memory:');
 const insert=s.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
 const at=Date.parse('2026-11-03T12:00:00Z');
 const add=(id,{provider='codex',model='gpt-6.1-sol',input=1000,read=100,write=0,prompt=input+read+write,incomplete=0,failed=0}={})=>insert.run(id,at,'a',provider,model,input,read,write,10,prompt,incomplete,failed);
 add('short',{input:1023,read:0});
 add('boundary',{input:1024,read:0});
 add('cached');
 add('reported',{input:25,read:900,write:175});
 add('long',{input:100000,read:200000});
 add('failed',{failed:1});
 add('incomplete',{incomplete:1});
 add('claude',{provider:'claude',model:'claude-opus-5-5'});
 add('api',{provider:'openai-compatibility'});
 add('terra',{model:'gpt-6.1-terra'});
 add('bad-sum',{prompt:5000});
 const before=s.db.prepare('SELECT * FROM events ORDER BY id').all();
 const view=s.db.prepare('SELECT * FROM spend_accounting_v1 ORDER BY id').all();
 const estimated=view.filter(r=>r.estimatedCacheWrite>0);
 assert.deepEqual(estimated.map(r=>r.id),['boundary','cached','long']);
 assert.equal(estimated.reduce((n,r)=>n+r.estimatedCacheWrite,0),102024);
 for(let i=0;i<view.length;i++){
  const v=view[i],r=before[i];
  assert.equal(v.input+v.cacheRead+v.cacheWrite+v.output,r.input+r.cacheRead+r.cacheWrite+r.output);
  assert.equal(v.input+v.estimatedCacheWrite,r.input);
  assert.equal(v.cacheWrite-v.estimatedCacheWrite,r.cacheWrite);
 }
 const report=s.report('2026-11',at,at+1);
 const timeline=s.timeline('2026-11',at,at+3600000,at+3600000);
 assert.equal(report.cacheWriteEstimateVersion,'sol-implicit-v1');
 for(const key of ['input','cacheRead','cacheWrite','output','estimatedCacheWrite','requests']){
  const sum=rows=>rows.reduce((n,r)=>n+r[key],0);
  assert.equal(sum(report.rows),sum(timeline.rows));
  assert.equal(sum(report.rows),sum(timeline.recent));
 }
 const sol=report.rows.filter(r=>r.provider==='codex'&&r.model==='gpt-6.1-sol');
 assert.equal(sol.reduce((n,r)=>n+r.estimatedCacheWrite,0),102024);
 const short=sol.find(r=>r.incomplete===0&&r.prompt<=100000);
 // The same price band contains a 1,023-token request and larger prompts.
 assert.equal(short.input,3048); // short 1023 + reported 25 + failed 1000 + bad-sum 1000
 assert.equal(short.cacheWrite,2199); // measured 175 + estimated 2024
 assert.deepEqual(s.db.prepare('SELECT * FROM events ORDER BY id').all(),before);
 assert.deepEqual(s.report('2026-11',at,at+1).rows,report.rows); // no double conversion
 s.db.close();
});

test('account activity spans months and survives reopening, without quota or plan changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'activity-test-'));
 try {
  const file=path.join(dir,'usage.sqlite');let s=openStore(file);
  s.record([record(),record({execution_id:'latest',timestamp:'2026-11-04T12:00:00Z',failed:true}),
   record({execution_id:'other',auth_index:'account-2'}),
   record({execution_id:'dry',timestamp:'2026-12-01T00:00:00Z',generate:false})]);
  s.setPlan('2026-11','account-2',200);
  const expected={'account-1':Date.parse('2026-11-04T12:00:00Z'),'account-2':Date.parse('2026-10-19T12:00:00Z')};
  assert.deepEqual(s.activity().lastUsed,expected);
  s.db.close();s=openStore(file);assert.deepEqual(s.activity().lastUsed,expected);s.db.close();
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
