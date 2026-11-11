// Public pricing only. Fixed official URLs; no keys, account data, or user-supplied URLs.
export const priceSources = [
  { provider: 'claude', url: 'https://claude.com/pricing' },
  { provider: 'codex', url: 'https://learn.chatgpt.com/docs/pricing.md' },
  { provider: 'xai', url: 'https://docs.x.ai/x-subscription/pricing' },
  { provider: 'glm', url: 'https://zcode.z.ai/pricing.html' },
  { provider: 'qwencloud', url: 'https://www.qwencloud.com/pricing/coding-plan' },
  { provider: 'antigravity', url: 'https://gemini.google/us/subscriptions/?hl=en' },
  { provider: 'antigravity', parser: 'google-workspace', url: 'https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans?hl=en' },
];
export function priceText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim();
}
export function parsePlanPrices(provider, html) {
  const text = priceText(html), plans = [];
  const add = (name, cadence, amount, extra = {}) => {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Invalid published price');
    const targetProvider=provider==='google-workspace'?'antigravity':provider;
    plans.push({ id: `${targetProvider}:${name}:${cadence}`, provider:targetProvider, name, cadence, amount, ...extra });
  };
  if (provider === 'claude') {
    const headings=[...html.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>|^#{2,4}\s+([^\n]+)$/gm)];
    const card=(name)=>{
      const i=headings.findIndex(h=>priceText(h[1]??h[2])===name);
      return i<0?'':priceText(html.slice(headings[i].index,headings[i+1]?.index??headings[i].index+10000));
    };
    const proCard=card('Pro');

    const pro = text.match(/Pro For everyday work \$[\d.]+ Per month with annual subscription discount \(\s*\$([\d.]+) billed up front\)\. \$([\d.]+) if billed monthly/i);
    if (pro) { add('Pro','annual',Number(pro[1])/12); add('Pro','monthly',Number(pro[2])); }
    else {
      const annual=proCard.match(/\$([\d.]+) billed (?:up front|annually)/i);
      const monthly=proCard.match(/\$([\d.]+) (?:if )?billed monthly/i);
      if(annual)add('Pro','annual',Number(annual[1])/12);
      if(monthly)add('Pro','monthly',Number(monthly[1]));
    }
    for (const name of ['Max','Ultra']) {
      const match=text.match(new RegExp(`${name} For [^$]{1,80}\\$([\\d.]+) Per month`));
      const amount=match?.[1]??card(name).match(/\$([\d.]+)\s*(?:Per|\/)\s*month/i)?.[1];
      if(amount)add(name,'monthly',Number(amount));
    }
    for (const name of ['Standard','Premium']) {
      const match=text.match(new RegExp(`${name} seat [^$]{0,160}\\$([\\d.]+) Per seat / month if billed annually\\. \\$([\\d.]+) if billed monthly`));
      if(match){add(`Team ${name}`,'annual',Number(match[1]),{minimumSeats:2});add(`Team ${name}`,'monthly',Number(match[2]),{minimumSeats:2});}
    }
  } else if (provider === 'codex') {
    // Parse official documentation cards, never API model price tables.
    for (const match of html.matchAll(/<PricingCard\s+([\s\S]*?)>([\s\S]*?)<\/PricingCard>/g)) {
      const name=match[1].match(/name="([^"]+)"/)?.[1];
      const price=match[1].match(/price="\$([\d.]+)"/)?.[1];
      if(name==='Plus' && price)add(name,'monthly',Number(price));
      if(name==='Pro') {
        const amounts=match[2].match(/Plans at ([^\n]+?) USD per month/);
        if(amounts)for(const amount of amounts[1].matchAll(/\$([\d.]+)/g))add(`Pro ${amount[1]}`,'monthly',Number(amount[1]));
      }
    }
  } else if(provider==='xai') {
    for(const name of ['Plus','Premium','Super','Ultra']){
      const match=text.replace(/\s*\|\s*/g,' ').replace(/\s+/g,' ').match(new RegExp(`\\b${name} \\$([\\d.]+)\\s*/mo \\$([\\d.]+)\\s*/yr`));
      if(match){add(name,'monthly',Number(match[1]));add(name,'annual',Number(match[2])/12);}
    }
  } else if(provider==='antigravity') {
    for(const name of ['Plus','Pro']) {
      const match=text.match(new RegExp(`Google AI ${name}\\s+(?:1\\s+)?(?:Get|Unlock)[^$]{0,250}\\$([\\d.]+)\\s*/\\s*month`));
      if(match)add(`Google AI ${name}`,'monthly',Number(match[1]));
    }
    const ultra=text.match(/Google AI Ultra\s+(?:1\s+)?Unlock[^$]{0,250}([\s\S]{0,300})/);
    if(ultra)for(const match of ultra[1].matchAll(/\$([\d.]+)\s*\/\s*month:\s*(\d+)x higher usage limits vs\. AI\s*Pro/g))
      add(`Google AI Ultra ${match[2]}x`,'monthly',Number(match[1]));
  } else if(provider==='google-workspace') {
    const payment=text.match(/Monthly payment ([\s\S]+?) Yearly payment/)?.[1] ?? '';
    for(const name of ['Starter','Standard','Plus']) {
      const prices=[...payment.matchAll(new RegExp(`Business ${name}: \\$([\\d.]+) USD per user`,'g'))];
      if(prices.length===2)for(const [i,cadence] of ['monthly','annual'].entries()) {
        const amount=Number(prices[i][1]);
        add(`Google Workspace Business ${name}`,cadence,amount);
      }
    }
  } else if(provider==='glm') {
    // The crossed-out price is the undiscounted monthly price. Do not turn an
    // introductory or annual discount into a recurring monthly offer.
    for(const name of ['Lite','Pro','Max']){
      const match=text.match(new RegExp(`GLM Coding ${name}[^$]{0,200}\\$([\\d.]+) / month \\$([\\d.]+)`));
      if(match && /line-through/.test(html))add(name,'monthly',Number(match[2]));
    }
  }
  if(!plans.length)throw new Error('Published plan prices could not be verified from this page');
  return plans;
}
async function fetchSource(source, fetcher) {
  const response=await fetcher(source.url,{headers:{'User-Agent':'MiniLLM-Plan-Pricing/1.0','Accept':'text/html,text/markdown'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok)throw new Error(`Publisher returned HTTP ${response.status}`);
  const reader=response.body.getReader();let size=0;const chunks=[];
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>3000000)throw new Error('Pricing page exceeds size limit');chunks.push(value);}} finally {await reader.cancel();}
  const html=Buffer.concat(chunks).toString('utf8');
  return parsePlanPrices(source.parser ?? source.provider,html);
}
export function createPriceCatalog(fetcher=fetch, initial=null, persist=()=>{}) {
  let previous=initial?.version===1 && Array.isArray(initial.sources) ? initial : {version:1,checkedAt:null,sources:[]};let inFlight;
  return {
    read:()=>previous,
    refresh() {
      if(inFlight)return inFlight;
      if(previous.checkedAt && Date.now()-previous.checkedAt<60000)return Promise.resolve(previous);
      inFlight=Promise.all(priceSources.map(async source=>{
        try {return {...source,checkedAt:Date.now(),status:'ok',plans:await fetchSource(source,fetcher)};}
        catch(error){return {...source,checkedAt:Date.now(),status:'unavailable',error:error instanceof Error?error.message:'Pricing unavailable',plans:[]};}
      })).then(sources=>{previous={version:1,checkedAt:Date.now(),sources};persist(previous);return previous;}).finally(()=>{inFlight=undefined;});
      return inFlight;
    },
  };
}
