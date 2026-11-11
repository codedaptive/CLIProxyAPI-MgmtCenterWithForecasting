import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openQuotaStore, quotaSnapshot, kpatdevQuotaStatus } from '../../scripts/spend/quota.mjs';
test('quota sampler allowlists data, rejects stale/disabled accounts, and persists bounded history',()=>{
 const now=Date.now();
 const account={auth_index:'a',provider:'claude',api_key:'SECRET',quota:{read_at:new Date(now).toISOString(),five_hour:{utilization:30,resets_at:new Date(now+3600000).toISOString()}}};
 const snap=quotaSnapshot({accounts:{a:account,b:{...account,auth_index:'b'}}},{files:[{auth_index:'a',disabled:false},{auth_index:'b',disabled:true}]},now);
 assert.equal(snap.accounts.length,1);assert.equal(snap.accounts[0].windows[0].remaining,70);
 assert(!JSON.stringify(snap).includes('SECRET'));
 assert.equal(quotaSnapshot({accounts:{a:account}},{files:[{auth_index:'a'}]},now+30*60000).accounts.length,0);
 const elapsed={...account,quota:{...account.quota,weekly:{utilization:100,resets_at:new Date(now-1).toISOString()}}};
 assert.equal(quotaSnapshot({accounts:{a:elapsed}},{files:[{auth_index:'a'}]},now).accounts.length,0);
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE events (account TEXT, at INTEGER, input INTEGER, cacheRead INTEGER, cacheWrite INTEGER, output INTEGER, incomplete INTEGER)');const store=openQuotaStore(db);
 db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)').run('a',now-86400000,10,5,2,3,0);
 store.record(snap);store.record({...snap,at:now+1});
 const history=store.history(now+2);assert.equal(history.activity[0].tokens,20);assert.equal(history.samples.length,1);assert.equal(history.samples[0].at,now+1);
 assert.equal(store.history(now+15*86400000).samples.length,0);db.close();
});

test('custom quota reader preserves credential identity and rejects stale observations',()=>{
 const at=Date.now();
 const window={key:'weekly',kind:'weekly',used_percent:90,observed_at:new Date(at).toISOString(),resets_at:new Date(at+2*86400000).toISOString()};
 const credentials={files:[{name:'first.json',auth_index:'a'},{name:'second.json',auth_index:'b'}]};
 const detail={accounts:[{id:'first.json',display:'same',provider:'claude',windows:[window]},{id:'second.json',display:'same',provider:'claude',windows:[{...window,used_percent:20}]}]};
 let snap=quotaSnapshot(kpatdevQuotaStatus({accounts:{same:{}}},detail,credentials),credentials,at);
 assert.deepEqual(snap.accounts.map(a=>[a.id,a.windows[0].remaining]),[['a',10],['b',80]]);
 assert.equal(snap.accounts[0].windows[0].id,'seven_day');
 detail.accounts[0].windows[0]={...window,stale:true};
 snap=quotaSnapshot(kpatdevQuotaStatus({},detail,credentials),credentials,at);
 assert.deepEqual(snap.accounts.map(a=>a.id),['b']);
});
