import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePlanPrices,createPriceCatalog} from '../../scripts/spend/plan-prices.mjs';
test('published Claude annual billing uses billed total instead of rounded promotional monthly label',()=>{
 const plans=parsePlanPrices('claude','Pro For everyday work $17 Per month with annual subscription discount ($200 billed up front). $20 if billed monthly. Ultra For your longest tasks $200 Per month');
 assert.equal(plans.find(p=>p.cadence==='annual').amount,200/12);assert.equal(plans.find(p=>p.name==='Ultra').amount,200);
});
test('API pricing and promotional values do not become subscription prices',()=>{
 assert.throws(()=>parsePlanPrices('claude','Opus $5 input $25 output per million tokens'));
 const glm=parsePlanPrices('glm','<h3>GLM Coding Pro</h3> $56 / month <span class="line-through">$80</span>');assert.equal(glm[0].amount,80);
 assert.throws(()=>parsePlanPrices('glm','GLM Coding Pro $56 / month $80'));
});
test('X annual price uses exact annual amount; Codex Pro variants remain distinct',()=>{
 const x=parsePlanPrices('xai','Plus $8/mo $80/yr ($7/mo)');assert.equal(x.find(p=>p.cadence==='annual').amount,80/12);
 const codex=parsePlanPrices('codex','<PricingCard name="Pro" price="$100">Plans at $100, $200, or $500 USD per month</PricingCard>');assert.deepEqual(codex.map(p=>p.amount),[100,200,500]);
});
test('catalog refresh is explicit, coalesced, bounded to official URLs, and keeps source failures visible',async()=>{
 let calls=0;
 const store=createPriceCatalog(async(url,options)=>{calls++;assert(url.startsWith('https://'));assert.equal(options.redirect,'error');assert(!options.headers.Authorization);return new Response('unreadable',{status:403});});
 assert.equal(calls,0);const [one,two]=await Promise.all([store.refresh(),store.refresh()]);assert.equal(one,two);assert.equal(calls,7);assert(one.sources.every(s=>s.status==='unavailable'&&s.plans.length===0));await store.refresh();assert.equal(calls,7);
});
test('markdown content negotiation preserves the same subscription cards',()=>{
 const p=parsePlanPrices('claude','### Pro\nFor everyday work\n**$17**\nPer month with annual subscription discount ($200 billed up front). $20 if billed monthly.\n### Ultra\nFor your longest tasks\n**$200**\nPer month');
 assert.equal(p.length,3);assert.equal(p.find(x=>x.name==='Ultra').amount,200);
});
test('Claude pricing card headings remain readable when marketing descriptions change',()=>{
 const p=parsePlanPrices('claude','<h3>Pro</h3><p>$17</p><p>$200 billed up front. $20 billed monthly.</p><h3>Max</h3><p>Work longer</p><p>$100 / month</p><h3>Ultra</h3><p>Most usage</p><p>$200 Per month</p>');assert.equal(p.length,4);assert.equal(p.find(x=>x.name==='Ultra').amount,200);
});

test('Google Gemini plans use published recurring prices and separate Ultra tiers',()=>{
 const html='Google AI Plus 1 Get more access $4.99 / month Google AI Pro 1 Get higher access $19.99 / month Google AI Ultra 1 Unlock the highest level Starting at: $99.99 / month $99.99 / month: 5x higher usage limits vs. AI Pro $199.99 / month: 20x higher usage limits vs. AI Pro';
 const p=parsePlanPrices('antigravity',html);assert.deepEqual(p.map(p=>p.amount),[4.99,19.99,99.99,199.99]);assert.equal(p[3].name,'Google AI Ultra 20x');
 assert.throws(()=>parsePlanPrices('antigravity','Google AI Pro $0 introductory offer'));
});
test('Workspace Gemini plans distinguish flexible and annual commitments',()=>{
 const p=parsePlanPrices('google-workspace','Monthly payment Business Starter: $8.40 USD per user Business Standard: $16.80 USD per user Business Plus: $26.40 USD per user Business Starter: $7 USD per user Business Standard: $14 USD per user Business Plus: $22 USD per user Yearly payment');
 assert.equal(p.length,6);assert(p.every(p=>p.provider==='antigravity'));assert.equal(p.find(p=>p.name==='Google Workspace Business Plus'&&p.cadence==='annual').amount,22);
});
test('published catalog survives reload without a second provider fetch',async()=>{
 let saved;const a=createPriceCatalog(async()=>new Response('Ultra For your longest tasks $200 Per month'),null,value=>{saved=value;});await a.refresh();
 const b=createPriceCatalog(async()=>{throw new Error('should not fetch');},saved);assert.deepEqual(b.read(),saved);assert.deepEqual(await b.refresh(),saved);
});
