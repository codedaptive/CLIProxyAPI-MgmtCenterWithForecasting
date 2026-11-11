import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../../scripts/spend/store.mjs';
import {openQuotaStore} from '../../scripts/spend/quota.mjs';
import {openPlanningStore,validateTerms} from '../../scripts/spend/planning.mjs';
const base=Date.UTC(2026,10,5);
function fixture(){const store=openStore(':memory:');const quota=openQuotaStore(store.db);const planning=openPlanningStore(store);return {store,quota,planning};}
const sample=(i,remaining,resetAt=base+86400000)=>({at:base+i*300000,accounts:[{id:'a',provider:'claude',readAt:base+i*300000,windows:[{id:'seven_day',remaining,resetAt}]}]});
function event(store,id,minute,model='claude-opus-5-5',incomplete=0){store.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,base+minute*60000,'a','claude',model,100,0,0,10,100,incomplete,0);}
test('subscription terms validate real dates and survive store reads',()=>{
 const {store,planning}=fixture();
 const terms={planType:'Team Pro',cadence:'annual',renewalDate:'2027-02-28'};
 planning.save('a',terms);assert.deepEqual(planning.terms().a,terms);
 const selected={...terms,planId:'claude:Team Premium:annual'};
 planning.save('b',selected);assert.deepEqual(planning.terms().b,selected);
 for(const planId of ['',17,'x'.repeat(201)])assert.throws(()=>validateTerms({...terms,planId}));
 for(const change of [{renewalDate:'2027-02-30'},{cadence:'weekly'},{planType:''},{renewalDate:'bad'}])assert.throws(()=>validateTerms({...terms,...change}));
 store.db.close();
});
test('capacity pairs exact quota reads, ignores repeats, requires significant consumption',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,96));quota.record({...sample(1,96),at:base+330000});quota.record(sample(2,92));
 event(store,'one',2);event(store,'two',7);
 const e=planning.evidence(base+660000);assert.equal(e.cycles.length,1);assert.equal(e.cycles[0].tokens,220);assert.equal(e.cycles[0].used,8);assert.equal(e.cycles[0].intervals,2);
 store.db.close();
});
test('reset changes and incomplete usage are not calibration evidence',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,96,base+2*86400000));quota.record(sample(2,92,base+2*86400000));
 event(store,'one',2);event(store,'two',7,'claude-opus-5-5',1);
 assert.equal(planning.evidence(base+660000).cycles.length,0);store.db.close();
});
test('mixed model observations retain token price bands without claiming direct capacity',()=>{
 const {store,quota,planning}=fixture();
 for(let i=0;i<3;i++)quota.record(sample(i,100-i*5));
 event(store,'a',2);event(store,'b',3,'claude-haiku-5-5');event(store,'c',7);event(store,'d',8,'claude-haiku-5-5');
 const e=planning.evidence(base+660000);assert.equal(e.cycles.length,0);assert.equal(e.mixed.length,1);assert.equal(e.mixed[0].rows.length,2);assert.equal(e.mixed[0].used,10);
 assert(!JSON.stringify(e).includes('api_key'));store.db.close();
});

test('tokens from unchanged quota readings are carried into the next quota decline',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,100));quota.record(sample(2,95));
 event(store,'a',2);event(store,'b',7);
 const e=planning.evidence(base+660000);assert.equal(e.cycles[0].tokens,220);assert.equal(e.cycles[0].used,5);store.db.close();
});

test('model-specific weekly windows count only the matching model, not other shared-quota traffic',()=>{
 const {store,quota,planning}=fixture();
 for(let i=0;i<3;i++){
  const s=sample(i,100-i*5);s.accounts[0].windows.push({id:'seven_day_fable',remaining:100-i*5,resetAt:base+86400000});quota.record(s);
 }
 event(store,'o',2,'claude-opus-5-5');event(store,'f',3,'claude-fable-5-1');event(store,'f2',7,'claude-fable-5-1');
 const e=planning.evidence(base+660000);const f=e.cycles.find(c=>c.window==='seven_day_fable');
 assert.equal(f.tokens,220);assert.equal(f.model,'claude-fable-5-1');assert(e.windows.some(w=>w.window==='seven_day_fable'));
 store.db.close();
});

test('complete failed requests retain successful traffic and their metered tokens',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,98));quota.record(sample(2,95));
 event(store,'ok',2);event(store,'metered-failure',7);
 store.db.prepare('UPDATE events SET failed=1 WHERE id=?').run('metered-failure');
 store.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('zero-failure',base+8*60000,'a','claude','claude-opus-5-5',0,0,0,0,0,0,1);
 const e=planning.evidence(base+660000);
 assert.equal(e.cycles.length,1);assert.equal(e.cycles[0].tokens,220);assert.equal(e.cycles[0].used,5);
 store.db.close();
});

test('complete metered failures remain part of mixed quota evidence',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,98));quota.record(sample(2,95));
 event(store,'opus',2);event(store,'haiku',7,'claude-haiku-5-5');
 store.db.prepare('UPDATE events SET failed=1 WHERE id=?').run('haiku');
 const e=planning.evidence(base+660000);
 assert.equal(e.mixed.length,1);assert.equal(e.mixed[0].used,5);
 assert.equal(e.mixed[0].rows.reduce((sum,r)=>sum+r.input+r.output,0),220);
 assert.equal(e.mixed[0].rows.find(r=>r.model==='claude-haiku-5-5').failed,1);
 store.db.close();
});

test('full exhausted run includes unchanged reads and a polling gap within the same reset',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,100));quota.record(sample(12,0));
 event(store,'first',2);event(store,'second',25,'claude-sonnet-5-5');event(store,'third',55);
 const e=planning.evidence(base+61*60000);
 assert.equal(e.quotaRuns.length,1);
 assert.equal(e.quotaRuns[0].used,100);assert.equal(e.quotaRuns[0].exhausted,true);
 assert.equal(e.quotaRuns[0].rows.reduce((s,r)=>s+r.input+r.output,0),330);
 store.db.close();
});

test('refills with unchanged reset timestamp create independent quota runs',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,50));quota.record(sample(2,0));
 quota.record(sample(3,100));quota.record(sample(4,75));quota.record(sample(5,60));
 event(store,'first',2);event(store,'second',7);event(store,'third',17);event(store,'fourth',22);
 const e=planning.evidence(base+26*60000);
 assert.deepEqual(e.quotaRuns.map(r=>r.used),[100,40]);
 assert.deepEqual(e.quotaRuns.map(r=>r.exhausted),[true,false]);
 assert.equal(e.quotaRuns[1].rows[0].input,200);
 store.db.close();
});

test('an exhausted run first seen at 40 percent remains a 40-percent sample',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,40));quota.record(sample(1,0));event(store,'one',2);
 const e=planning.evidence(base+6*60000);
 assert.equal(e.quotaRuns[0].used,40);assert.equal(e.quotaRuns[0].exhausted,true);
 assert.equal(e.quotaRuns[0].startRemaining,40);assert.equal(e.quotaRuns[0].endRemaining,0);
 store.db.close();
});

test('partially consumed windows are retained below the former five-point threshold',()=>{
 const {store,quota,planning}=fixture();
 quota.record(sample(0,100));quota.record(sample(1,99));event(store,'one',2,'claude-fable-5-1');
 const e=planning.evidence(base+6*60000);
 assert.equal(e.quotaRuns[0].used,1);assert.equal(e.quotaRuns[0].rows[0].input,100);
 store.db.close();
});
