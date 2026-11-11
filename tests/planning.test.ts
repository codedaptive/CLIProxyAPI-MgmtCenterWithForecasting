import { test, expect, spyOn } from 'bun:test';
import {
  planningRanges,
  planOptions,
  recordedDemand,
  optimizePlans,
  type PlanningAccount,
  type PlanOption,
} from '../src/features/planning/model';
import {
  calibrate,
  planKey,
  fitQuotaCosts,
  type Calibration,
} from '../src/features/planning/calibration';
import type { PlanningData } from '../src/features/planning/types';
import type { SpendReport, UsageRow } from '../src/features/spend/types';
import { planRecordedUsage, forecastMonth } from '../src/features/planning/reconciliation';
const now = new Date(2026, 10, 5, 15, 30).getTime(),
  day = 86400000;
const account: PlanningAccount = {
  id: 'a',
  label: 'Fixture',
  provider: 'claude',
  terms: { planType: 'Ultra', cadence: 'monthly', renewalDate: null },
  fee: 200,
  active: true,
};
const row = (model: string, tokens: number): UsageRow => ({
  account: 'a',
  provider: 'claude',
  model,
  input: tokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  prompt: tokens,
  incomplete: 0,
  failed: 0,
  requests: 1,
});
const report = (rows: UsageRow[]): SpendReport => ({
  version: 1,
  month: '2026-11',
  createdAt: now - 40 * day,
  lastPoll: now,
  enabled: true,
  error: null,
  rejected: 0,
  gaps: 0,
  plans: { a: 200 },
  terms: { a: account.terms },
  rows,
});
const data = (): PlanningData => ({
  version: 1,
  now,
  quotaSince: now - day,
  mixedIntervals: 0,
  invalidIntervals: 0,
  cycles: [],
  terms: {},
});
function capacity(tier: string, model: string, hourly: number): Calibration[] {
  return (['seven_day', 'five_hour'] as const).map((window) => ({
    key: planKey('claude', tier),
    provider: 'claude',
    planType: tier,
    model,
    window,
    tokensPerQuota: hourly * (window === 'seven_day' ? 168 : 5),
    tokens: 100,
    quotaPoints: 10,
    observations: 4,
    method: 'direct',
    error: null,
  }));
}
function option(tier: string, price: number, fixed = 0): PlanOption {
  return {
    id: tier,
    key: planKey('claude', tier),
    provider: 'claude',
    planType: tier,
    cadence: 'monthly',
    price,
    fixed,
    availableFixed: fixed,
    current: fixed,
    committedCost: fixed * price,
    unknownCost: false,
  };
}
const demand = (model: string, perHour: number) => ({
  model,
  perHour,
  tokens: perHour * 5,
  requests: 5,
});

test('5-hour range ends at Calculate; 7/30-day ranges end at local midnight', () => {
  const ranges = planningRanges(now);
  const midnight = new Date(2026, 10, 5).getTime();
  expect(ranges.map((r) => r.id)).toEqual(['days30', 'days7', 'hours5']);
  expect(ranges[2]).toEqual({ id: 'hours5', start: now - 5 * 3600000, end: now });
  expect(ranges[1].end).toBe(midnight);
  expect(new Date(ranges[1].start).getDate()).toBe(29);
  expect(new Date(ranges[0].start).getDate()).toBe(6);
});
test('recorded consumption is never extrapolated and short coverage is explicit', () => {
  const usage = report([{ ...row('haiku', 100), cacheRead: 900 }]);
  usage.createdAt = now - 2 * day;
  const r = recordedDemand(usage, now - 7 * day, now);
  expect(r.demand[0].tokens).toBe(1000);
  expect(r.hours).toBe(48);
  expect(r.partial).toBe(true);
  expect(r.demand[0].perHour).toBeCloseTo(1000 / 48);
});
test('annual subscriptions are fixed until expiry; disabled annual plans keep cost but no capacity', () => {
  const annual = {
    ...account,
    terms: { ...account.terms, cadence: 'annual' as const, renewalDate: '2027-02-28' },
  };
  const options = planOptions(
    [annual, { ...annual, id: 'b', active: false }, { ...account, id: 'c' }],
    now
  );
  const fixed = options.find((o) => o.cadence === 'annual')!;
  expect(fixed.fixed).toBe(2);
  expect(fixed.availableFixed).toBe(1);
  expect(fixed.committedCost).toBe(400);
  expect(
    planOptions([{ ...annual, terms: { ...annual.terms, renewalDate: '2026-01-01' } }], now)[0]
      .fixed
  ).toBe(0);
});
test('optimizer uses committed capacity before buying and chooses cheaper tier rather than preserving mix', () => {
  const opts = [option('Team', 100, 1), option('Ultra', 200), option('Small', 50)];
  const caps = [
    ...capacity('Team', 'opus', 100),
    ...capacity('Ultra', 'opus', 500),
    ...capacity('Small', 'opus', 150),
  ];
  const r = optimizePlans(opts, caps, [demand('opus', 200)]);
  expect(r.status).toBe('optimal');
  expect(r.additionalCost).toBe(50);
  expect(r.committedCost).toBe(100);
  expect(r.lines.find((p) => p.id === 'Small')?.buy).toBe(1);
  expect(r.lines.find((p) => p.id === 'Team')?.total).toBe(1);
});
test('shared weekly quota sums model loads and integer plans round up', () => {
  const r = optimizePlans(
    [option('Ultra', 200)],
    [...capacity('Ultra', 'opus', 100), ...capacity('Ultra', 'sonnet', 100)],
    [demand('opus', 60), demand('sonnet', 60)]
  );
  expect(r.additionalCost).toBe(400);
  expect(r.lines[0].flexible).toBe(2);
});
test('five-hour capacity remains a binding constraint', () => {
  const caps = capacity('Ultra', 'opus', 100);
  caps[1].tokensPerQuota = 100;
  const r = optimizePlans([option('Ultra', 200)], caps, [demand('opus', 60)]);
  expect(r.lines[0].flexible).toBe(3);
});
test('no purchase recommendation when one required model/window is unknown', () => {
  const r = optimizePlans([option('Ultra', 200)], capacity('Ultra', 'opus', 100).slice(0, 1), [
    demand('opus', 10),
  ]);
  expect(r.status).toBe('insufficient');
  expect(r.additionalCost).toBeNull();
  expect(r.missing).toEqual(['opus']);
});
test('direct capacity uses measured quota rather than published API prices', () => {
  const d = data();
  d.cycles = [
    {
      account: 'a',
      provider: 'claude',
      model: 'unpriced',
      window: 'seven_day',
      tokens: 1000,
      used: 10,
      intervals: 2,
      resetAt: now + day,
      start: now - day,
      end: now,
    },
  ];
  const c = calibrate([account], d)[0];
  expect(c.tokensPerQuota).toBe(10000);
  expect(c.method).toBe('direct');
});

test('independent mixed observations recover known per-model quota costs', () => {
  const d = data();
  d.mixed = [
    [1, 1],
    [1, 3],
    [4, 1],
    [3, 2],
  ].map(([o, h]) => ({
    account: 'a',
    provider: 'claude',
    window: 'seven_day',
    resetAt: now + day,
    start: now - day,
    end: now,
    used: o * 5 + h,
    intervals: 2,
    rows: [row('opus', o * 1e6), row('haiku', h * 1e6)],
  }));
  const c = calibrate([account], d);
  expect(c.find((c) => c.model === 'opus')!.tokensPerQuota! / 20e6).toBeCloseTo(1, 1);
  expect(c.find((c) => c.model === 'haiku')!.tokensPerQuota! / 100e6).toBeCloseTo(1, 1);
});
test('explicit Calculate loads all three ranges without live quota refresh or repeated timers', async () => {
  const { spendApi } = await import('../src/services/api/spend');
  const { authFilesApi, configApi } = await import('../src/services/api');
  const { loadPlanning } = await import('../src/features/planning/loadPlanning');
  const d = data();
  const planning = spyOn(spendApi, 'planning').mockResolvedValue(d);
  const monthly = spyOn(spendApi, 'report').mockResolvedValue(report([]));
  const usage = spyOn(spendApi, 'demand').mockResolvedValue(report([row('opus', 100)]));
  const config = spyOn(configApi, 'getConfig').mockResolvedValue({});
  const files = spyOn(authFilesApi, 'list').mockResolvedValue({
    files: [{ name: 'fixture.json', auth_index: 'a', type: 'claude', disabled: false }],
  });
  try {
    const r = await loadPlanning('http://fixture.test', now);
    expect(planning).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledTimes(3);
    expect(r.scenarios).toHaveLength(3);
    expect(r.scenarios[2].demand[0].tokens).toBe(100);
    expect(r.accounts[0].terms).toEqual(account.terms);
  } finally {
    planning.mockRestore();
    monthly.mockRestore();
    usage.mockRestore();
    files.mockRestore();
    config.mockRestore();
  }
});

test('known model-specific weekly quota also constrains the allocation', () => {
  const caps = [
    ...capacity('Ultra', 'fable', 100),
    {
      ...capacity('Ultra', 'fable', 100)[0],
      window: 'seven_day_fable' as const,
      tokensPerQuota: 1680,
    },
  ];
  expect(optimizePlans([option('Ultra', 200)], caps, [demand('fable', 25)]).lines[0].total).toBe(3);
});
test('published prices apply tax exactly once and old contracts cannot create unlimited purchase options', async () => {
  const { purchaseOptions, validTax } = await import('../src/features/planning/prices');
  const existing = { ...option('Ultra', 212), current: 2 };
  const published = {
    version: 1 as const,
    checkedAt: now,
    sources: [
      {
        provider: 'claude',
        url: 'https://claude.com/pricing',
        checkedAt: now,
        status: 'ok' as const,
        plans: [
          {
            id: 'ultra',
            provider: 'claude',
            name: 'Ultra',
            cadence: 'monthly' as const,
            amount: 200,
          },
        ],
      },
    ],
  };
  const choices = purchaseOptions([existing], {
    taxRate: 8.25,
    catalog: published,
  });
  expect(choices[0].price).toBe(212);
  expect(choices[0].limit).toBe(2);
  expect(choices[1].price).toBeCloseTo(216.5);
  expect(purchaseOptions([existing], { taxRate: 0, catalog: published })).toHaveLength(2);
  expect(validTax('')).toBe(false);
  expect(validTax('-1')).toBe(false);
  expect(validTax('8.25')).toBe(true);
  const result = optimizePlans(choices, capacity('Ultra', 'opus', 100), [demand('opus', 300)]);
  expect(result.lines).toHaveLength(1);
  expect(result.lines[0].buy).toBe(1);
  expect(result.lines[0].total).toBe(3);
  expect(result.additionalCost).toBeCloseTo(640.5);
});
test('published minimum seats are enforced when buying a team plan', () => {
  const plan = { ...option('Team', 50), minimum: 2 };
  const result = optimizePlans([plan], capacity('Team', 'opus', 100), [demand('opus', 10)]);
  expect(result.lines[0].total).toBe(2);
});
test('calendar ranges use local dates across daylight saving changes', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      "import {planningRanges} from './src/features/planning/model'; const r=planningRanges(new Date(2026,10,5,12).getTime())[1]; console.log(r.end-r.start)",
    ],
    { env: { ...process.env, TZ: 'America/Chicago' }, encoding: 'utf8' }
  );
  expect(result.status).toBe(0);
  expect(Number(result.stdout.trim())).toBe(169 * 3600000);
});

test('one uncalibrated model does not suppress covered demand or suggest cancellations', () => {
  const existing = { ...option('Ultra', 200), current: 4 };
  const r = optimizePlans([existing], capacity('Ultra', 'opus', 100), [
    demand('opus', 150),
    demand('unknown', 50),
  ]);
  expect(r.status).toBe('partial');
  expect(r.missing).toEqual(['unknown']);
  expect(r.additionalCost).toBe(400);
  expect(r.lines[0].release).toBeNull();
  expect(r.lines[0].allocation).toEqual([{ model: 'opus', perHour: 150 }]);
});

test('catalog selection supplies canonical identity and taxed monthly equivalent for annual billing', async () => {
  const { selectedContract, purchaseOptions, providerPlans } =
    await import('../src/features/planning/prices');
  const plan = {
    id: 'claude:Team Standard:annual',
    provider: 'claude',
    name: 'Team Standard',
    cadence: 'annual' as const,
    amount: 20,
  };
  const contract = selectedContract(plan, 8.25, '2027-02-28');
  expect(contract.amount).toBe(21.65);
  expect(contract.terms).toEqual({
    planId: plan.id,
    planType: plan.name,
    cadence: 'annual',
    renewalDate: '2027-02-28',
  });
  const catalog = {
    version: 1 as const,
    checkedAt: now,
    sources: [
      {
        provider: 'claude',
        status: 'ok' as const,
        checkedAt: now,
        url: 'https://claude.com/pricing',
        plans: [
          plan,
          { ...plan, id: 'claude:Team Standard:monthly', cadence: 'monthly' as const, amount: 25 },
        ],
      },
    ],
  };
  const existing = planOptions([{ ...account, terms: contract.terms, fee: contract.amount }], now);
  const choices = purchaseOptions(existing, { taxRate: 8.25, catalog });
  expect(choices).toHaveLength(3);
  expect(choices.slice(1).every((c) => c.key === existing[0].key)).toBe(true);
  expect(providerPlans(catalog, 'codex')).toEqual([]);
  expect(
    purchaseOptions([{ ...existing[0], provider: 'codex' }], { taxRate: 8.25, catalog })
  ).toHaveLength(1);
  expect(() => selectedContract(plan, NaN, '')).toThrow();
});

test('published plan IDs survive label changes without ambiguous cross-tier matching', async () => {
  const { purchaseOptions } = await import('../src/features/planning/prices');
  const catalog = {
    version: 1 as const,
    checkedAt: now,
    sources: [
      {
        provider: 'claude',
        status: 'ok' as const,
        checkedAt: now,
        url: 'https://claude.com/pricing',
        plans: [
          {
            id: 'ultra-id',
            provider: 'claude',
            name: 'New label',
            cadence: 'monthly' as const,
            amount: 200,
          },
        ],
      },
    ],
  };
  const existing = { ...option('Old label', 200), planIds: ['ultra-id'] };
  expect(purchaseOptions([existing], { taxRate: 0, catalog })).toHaveLength(2);
  expect(purchaseOptions([{ ...existing, planIds: [] }], { taxRate: 0, catalog })).toHaveLength(1);
});

test('planning account entry has no free-text tier, price, or separate capacity mapping', async () => {
  const { readFileSync } = await import('node:fs');
  const selector = readFileSync(
    new URL('../src/features/planning/PlanSelection.tsx', import.meta.url),
    'utf8'
  );
  const page = readFileSync(
    new URL('../src/features/planning/PlanningPage.tsx', import.meta.url),
    'utf8'
  );
  expect(selector).toContain('<select');
  expect(selector).not.toContain('current_contract');
  expect(selector).not.toContain('preserve_contract');
  expect(selector).toContain('choose_published_plan');
  expect(page).not.toContain('<PlanSelection');
  expect(selector).not.toContain('type="number"');
  expect(selector).not.toContain('type="text"');
  expect(page).not.toContain('capacity_match');
  expect(page).not.toContain('setMatches');
});

test('recorded weekly-only plans do not require a fabricated five-hour quota', () => {
  const plan = { ...option('Ultra', 200), quotaWindows: ['seven_day'] as const };
  const r = optimizePlans(
    [{ ...plan, quotaWindows: [...plan.quotaWindows] }],
    capacity('Ultra', 'opus', 100).slice(0, 1),
    [demand('opus', 120)]
  );
  expect(r.status).toBe('optimal');
  expect(r.additionalCost).toBe(400);
  expect(r.missing).toEqual([]);
});

test('an observed but uncalibrated quota remains mandatory', () => {
  const plan = { ...option('Ultra', 200), quotaWindows: ['seven_day', 'five_hour'] as const };
  expect(
    optimizePlans(
      [{ ...plan, quotaWindows: [...plan.quotaWindows] }],
      capacity('Ultra', 'opus', 100).slice(0, 1),
      [demand('opus', 120)]
    ).status
  ).toBe('insufficient');
});

test('model-specific window alone cannot create unconstrained capacity for another model', () => {
  const plan = { ...option('Ultra', 200), quotaWindows: ['seven_day_fable'] as const };
  expect(
    optimizePlans([{ ...plan, quotaWindows: [...plan.quotaWindows] }], [], [demand('opus', 120)])
      .status
  ).toBe('insufficient');
});

test('Plans is the only editor for subscription terms and catalog choices', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const read = (p: string) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
  expect(read('features/planning/PlansPage.tsx')).toContain('<PlanSelection');
  expect(read('features/planning/PlanningPage.tsx')).not.toContain('<PlanSelection');
  expect(read('features/spend/SpendPage.tsx')).not.toContain('<PlanPrice');
  expect(read('features/spend/SpendPage.tsx')).toContain('/plans?month=');
  expect(read('features/planning/PlanningPage.tsx')).toContain('to="/plans"');
  expect(existsSync(new URL('../src/features/planning/PlanPrice.tsx', import.meta.url))).toBe(
    false
  );
});

test('Claude baseline uses account kind and observed quota windows, not email or price', async () => {
  const { baselinePlanName, catalogTerms } = await import('../src/features/planning/accountPlans');
  const terms = { ...account.terms, planType: 'Team 5×' };
  expect(baselinePlanName('claude', terms, ['seven_day', 'seven_day_fable', 'five_hour'])).toBe(
    'Team Premium'
  );
  expect(baselinePlanName('claude', terms, ['seven_day', 'five_hour'])).toBe('Team Standard');
  expect(baselinePlanName('claude', account.terms, ['seven_day', 'seven_day_fable'])).toBe('Ultra');
  expect(baselinePlanName('claude', account.terms, ['seven_day', 'five_hour'])).toBe('Pro');
  expect(baselinePlanName('claude', terms, [])).toBe('Team 5×');
  expect(baselinePlanName('claude', { ...terms, planType: 'Unclassified' }, ['seven_day'])).toBe(
    'Unclassified'
  );
  expect(baselinePlanName('antigravity', { ...terms, planType: 'Business Plus' }, [])).toBe(
    'Google Workspace Business Plus'
  );
  expect(catalogTerms({ ...account, terms: { ...terms, planId: 'selected' } }, null).planId).toBe(
    'selected'
  );
});

test('fewest-account preference chooses one larger personal plan before cheaper smaller accounts', () => {
  const options = [option('Pro', 30), option('Ultra', 200)];
  const caps = [...capacity('Pro', 'opus', 100), ...capacity('Ultra', 'opus', 250)];
  const costFirst = optimizePlans(options, caps, [demand('opus', 200)]);
  expect(costFirst.lines.find((p) => p.planType === 'Pro')?.total).toBe(2);
  const countFirst = optimizePlans(options, caps, [demand('opus', 200)], true);
  expect(countFirst.lines).toHaveLength(1);
  expect(countFirst.lines[0].planType).toBe('Ultra');
  expect(countFirst.lines[0].total).toBe(1);
  expect(countFirst.additionalCost).toBe(200);
});

test('fewest-account preference uses price only after fixing account count', () => {
  const options = [option('Expensive', 300), option('Affordable', 200)];
  const caps = [...capacity('Expensive', 'opus', 250), ...capacity('Affordable', 'opus', 200)];
  const result = optimizePlans(options, caps, [demand('opus', 200)], true);
  expect(result.lines[0].planType).toBe('Affordable');
  expect(result.lines[0].total).toBe(1);
  expect(result.additionalCost).toBe(200);
});

test('personal-only purchasing keeps committed Team capacity but never buys or renews Team seats', async () => {
  const { purchaseOptions } = await import('../src/features/planning/prices');
  const team = {
    ...account,
    terms: { planType: 'Team Premium', cadence: 'annual' as const, renewalDate: '2027-02-28' },
    fee: 100,
  };
  const ultra = { ...account, id: 'ultra' };
  const catalog = {
    version: 1 as const,
    checkedAt: now,
    sources: [
      {
        provider: 'claude',
        url: 'https://claude.com/pricing',
        checkedAt: now,
        status: 'ok' as const,
        plans: [
          {
            id: 'team',
            provider: 'claude',
            name: 'Team Premium',
            cadence: 'annual' as const,
            amount: 100,
          },
          {
            id: 'ultra',
            provider: 'claude',
            name: 'Ultra',
            cadence: 'monthly' as const,
            amount: 200,
          },
        ],
      },
    ],
  };
  const settings = { taxRate: 0, catalog, individualPlansOnly: true };
  const existing = planOptions([team, ultra], now, true);
  const before = purchaseOptions(existing, settings);
  expect(before.filter((p) => p.planType === 'Team Premium')).toHaveLength(1);
  expect(before.find((p) => p.planType === 'Team Premium')?.availableFixed).toBe(1);
  expect(before.find((p) => p.planType === 'Team Premium')?.limit).toBe(0);
  const caps = [...capacity('Team Premium', 'opus', 100), ...capacity('Ultra', 'opus', 250)];
  const retained = optimizePlans(before, caps, [demand('opus', 100)], true);
  expect(retained.additionalCost).toBe(0);
  expect(retained.lines.find((p) => p.planType === 'Team Premium')?.total).toBe(1);
  const after = purchaseOptions(
    planOptions([team, ultra], new Date(2027, 2, 1).getTime(), true),
    settings
  );
  const replaced = optimizePlans(after, caps, [demand('opus', 100)], true);
  expect(replaced.lines.find((p) => p.planType === 'Team Premium')?.total).toBe(0);
  expect(replaced.lines.find((p) => p.planType === 'Ultra' && p.total)?.total).toBe(1);
  expect(
    replaced.lines.filter((p) => p.planType === 'Team Premium').every((p) => p.buy === 0)
  ).toBe(true);
});

test('a blocked expired Team option cannot claim demand coverage or supply free capacity', () => {
  const expired = { ...option('Team Standard', 20), limit: 0 };
  const result = optimizePlans(
    [expired],
    capacity('Team Standard', 'opus', 100),
    [demand('opus', 50)],
    true
  );
  expect(result.status).toBe('insufficient');
  expect(result.missing).toEqual(['opus']);
});

test('monthly Team accounts remain committed through their paid expiry only', () => {
  const team = {
    ...account,
    terms: { planType: 'Team Standard', cadence: 'monthly' as const, renewalDate: '2026-11-30' },
  };
  expect(planOptions([team], now, true)[0].availableFixed).toBe(1);
  expect(planOptions([team], new Date(2026, 11, 1).getTime(), true)[0].availableFixed).toBe(0);
});

test('a five-hour burst is not multiplied into a week of continuous demand', () => {
  const opts = [{ ...option('Ultra', 200), quotaWindows: ['seven_day' as const] }];
  const caps = capacity('Ultra', 'opus', 100).slice(0, 1);
  const result = optimizePlans(opts, caps, [demand('opus', 1000)], false, 5);
  expect(result.lines[0].total).toBe(1); // 5,000 tokens against 16,800/week, not 168,000.
  expect(optimizePlans(opts, caps, [demand('opus', 1000)], false, 168).lines[0].total).toBe(10);
});

test('weekly renewals give equal counts for equal seven-day and thirty-day average rates', () => {
  const opts = [{ ...option('Ultra', 200), quotaWindows: ['seven_day' as const] }];
  const caps = capacity('Ultra', 'opus', 100).slice(0, 1);
  for (const hours of [168, 169, 720]) {
    const result = optimizePlans(
      opts,
      caps,
      [{ ...demand('opus', 200), tokens: hours * 200 }],
      false,
      hours
    );
    expect(result.lines[0].total).toBe(2);
  }
});

test('five-hour scenarios still respect a real five-hour quota', () => {
  const caps = capacity('Ultra', 'opus', 100);
  caps[1].tokensPerQuota = 100;
  expect(
    optimizePlans([option('Ultra', 200)], caps, [demand('opus', 60)], false, 5).lines[0].total
  ).toBe(3);
});

test('retained and new accounts have one plan row, net purchases and combined actual costs', () => {
  const retained = { ...option('Ultra', 212), current: 3, limit: 3 };
  const fresh = { ...option('Ultra', 216.5), id: 'published-ultra' };
  const r = optimizePlans([retained, fresh], capacity('Ultra', 'opus', 100), [
    demand('opus', 1200),
  ]);
  expect(r.lines).toHaveLength(1);
  expect(r.lines[0].current).toBe(3);
  expect(r.lines[0].flexible).toBe(12);
  expect(r.lines[0].buy).toBe(9);
  expect(r.lines[0].release).toBe(0);
  expect(r.lines[0].cost).toBeCloseTo(3 * 212 + 9 * 216.5);
  expect(r.additionalCost).toBeCloseTo(r.lines[0].cost);
});

test('same-tier repricing cannot appear as both cancellations and purchases', () => {
  const retained = { ...option('Ultra', 220), current: 3, limit: 3 };
  const cheaper = { ...option('Ultra', 200), id: 'new-price' };
  const r = optimizePlans([retained, cheaper], capacity('Ultra', 'opus', 100), [
    demand('opus', 300),
    demand('unknown', 1),
  ]);
  expect(r.lines).toHaveLength(1);
  expect(r.lines[0].current).toBe(3); // Retained option selected zero, but still contributes inventory.
  expect(r.lines[0].buy).toBe(0);
  expect(r.lines[0].release).toBeNull();
  expect(r.lines[0].cost).toBe(600);
});

test('a full window and a linearly scaled partial window imply the same quota cost', () => {
  const full = fitQuotaCosts([{ tokens: { opus: 1000000 }, used: 100 }]);
  const partial = fitQuotaCosts([{ tokens: { opus: 400000 }, used: 40 }]);
  expect(full.costs.opus).toBeCloseTo(partial.costs.opus, 12);
  expect(100 / full.costs.opus).toBeCloseTo(1000000);
});

test('different mixtures solve per-model quota costs and shared allowance adds once', () => {
  const rows = [
    { tokens: { opus: 1800000, sonnet: 1000000 }, used: 100 },
    { tokens: { opus: 1000000, sonnet: 5000000 }, used: 100 },
    { tokens: { opus: 400000, sonnet: 2000000 }, used: 40 },
    { tokens: { opus: 800000, sonnet: 1000000 }, used: 50 },
  ];
  const fit = fitQuotaCosts(rows);
  expect(fit.costs.opus / 0.00005).toBeCloseTo(1, 1);
  expect(fit.costs.sonnet / 0.00001).toBeCloseTo(1, 1);
  expect(fit.samples.reduce((s, r) => s + r.predicted, 0)).toBeCloseTo(290, 6);
});

test('one mixed run allocates quota by token share instead of treating every share as a ceiling', () => {
  const fit = fitQuotaCosts([{ tokens: { opus: 900000, sonnet: 100000 }, used: 100 }]);
  expect(fit.costs.opus).toBeCloseTo(fit.costs.sonnet, 12);
  expect(100 / fit.costs.sonnet).toBeCloseTo(1000000);
  expect(fit.costs.opus * 500000 + fit.costs.sonnet * 500000).toBeCloseTo(100);
});

test('sparse and correlated models still have finite positive estimates', () => {
  const fit = fitQuotaCosts([
    { tokens: { opus: 1000000, haiku: 10000, fable: 1 }, used: 70 },
    { tokens: { opus: 500000, haiku: 5000, fable: 1 }, used: 35 },
  ]);
  expect(Object.values(fit.costs).every((c) => c > 0 && Number.isFinite(c))).toBe(true);
  expect(fit.samples.every((s) => Number.isFinite(s.predicted))).toBe(true);
});

test('new quota-run payload is used once without double counting compatibility fields', () => {
  const d = data();
  d.cycles = [
    {
      account: 'a',
      provider: 'claude',
      model: 'opus',
      window: 'seven_day',
      resetAt: now,
      start: now - day,
      end: now,
      tokens: 99999999,
      used: 100,
      intervals: 2,
    },
  ];
  d.quotaRuns = [
    {
      account: 'a',
      provider: 'claude',
      window: 'seven_day',
      resetAt: now,
      start: now - day,
      end: now,
      startRemaining: 100,
      endRemaining: 0,
      exhausted: true,
      used: 100,
      intervals: 2,
      rows: [row('opus', 900000), row('sonnet', 100000)],
    },
  ];
  const c = calibrate([account], d);
  expect(c.find((c) => c.model === 'opus')!.tokens).toBe(900000);
  expect(c.find((c) => c.model === 'opus')!.tokenShare).toBe(0.9);
  expect(c.every((c) => c.fullRuns === 1 && c.partialRuns === 0)).toBe(true);
  expect(c.every((c) => c.tokensPerQuota! > 900000)).toBe(true);
});

test('forecast uses daily average extended to weekly quota and next calendar month', () => {
  const opts = [{ ...option('Ultra', 200), current: 1, quotaWindows: ['seven_day' as const] }];
  const caps = capacity('Ultra', 'opus', 100).slice(0, 1);
  const r = planRecordedUsage(
    opts,
    caps,
    report([row('opus', 5000)]),
    now - 5 * 3600000,
    now,
    31,
    true
  );
  expect(r.demand[0].perDay).toBe(24000);
  expect(r.demand[0].perWeek).toBe(168000);
  expect(r.demand[0].nextMonth).toBe(744000);
  expect(r.result.lines[0].total).toBe(10);
  expect(r.result.lines[0].weeklyWindows).toBeCloseTo(10);
  expect(r.result.status).toBe('optimal'); // No historical-fleet veto.
  expect(forecastMonth(new Date(2026, 10, 7).getTime()).days).toBe(31);
  expect(new Date(forecastMonth(new Date(2026, 11, 7).getTime()).start).getMonth()).toBe(0);
});

test('calibration supplies sparse models from same-tier observed average without inventing Fable access', () => {
  const d = data();
  d.quotaRuns = [
    {
      account: 'a',
      provider: 'claude',
      window: 'seven_day',
      resetAt: now,
      start: now - day,
      end: now,
      startRemaining: 100,
      endRemaining: 50,
      exhausted: false,
      used: 50,
      intervals: 2,
      rows: [row('opus', 5000)],
    },
  ];
  const standard = {
    ...account,
    terms: { ...account.terms, planType: 'Team Standard' },
    quotaWindows: ['seven_day' as const],
  };
  const c = calibrate([standard], d, [row('haiku', 500), row('fable', 500)]);
  expect(c.find((c) => c.model === 'haiku')?.tokensPerQuota).toBeCloseTo(10000);
  expect(c.find((c) => c.model === 'haiku')?.method).toBe('pooled');
  expect(c.some((c) => c.model === 'fable')).toBe(false);
});

test('forecast page shows results and keeps calibration in collapsed details without warning panels', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(
    new URL('../src/features/planning/PlanningPage.tsx', import.meta.url),
    'utf8'
  );
  for (const obsolete of [
    'solve_unvalidated',
    'partial_history',
    'conservative_notice',
    'missing_calibration',
    'optimizer_scope',
  ])
    expect(page).not.toContain(obsolete);
  expect(page).toContain('<CalibrationDetails');
  expect(page).toContain('weekly_windows');
});
