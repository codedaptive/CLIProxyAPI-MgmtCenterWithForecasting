import { describe, expect, it } from 'bun:test';
import {
  analyzeSpend,
  apiContributions,
  apiEquivalent,
  rollup,
  monthRange,
} from '../src/features/spend/model';
import { TOKEN_RATES } from '../src/features/spend/rates';
import type { UsageRow } from '../src/features/spend/types';
const row = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  account: 'max',
  provider: 'claude',
  model: 'claude-opus-5-5',
  input: 1_000_000,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  prompt: 10000,
  incomplete: 0,
  failed: 0,
  requests: 1,
  ...overrides,
});
describe('subscription allocation', () => {
  it('estimates compatible-provider cache hits and misses separately without an unrelated long-context tier', () => {
    for (const [model, expected] of [
      ['deepseek-flash', 1.506],
      ['deepseek-v4-pro', 5.324],
      ['glm-5.3', 6.06],
      ['glm-5.3-flash', 0.68],
      ['qwen3.8-max', 8.25],
      ['qwen3.8-flash', 0.636],
    ] as const) {
      expect(
        apiEquivalent(
          row({ model, input: 1_000_000, cacheRead: 1_000_000, output: 1_000_000, prompt: 900000 })
        )
      ).toBeCloseTo(expected);
    }
  });
  it('allocates $200 by API cost, not raw token or request share', () => {
    const [a] = analyzeSpend(
      [row({ input: 15_000_000 }), row({ model: 'claude-haiku-5-5', input: 400_000_000 })],
      { max: 200 }
    );
    expect(a.api).toBe(100);
    expect(a.models.find((m) => m.model === 'claude-opus-5-5')?.share).toBeCloseTo(0.6);
    expect(a.models.find((m) => m.model === 'claude-opus-5-5')?.allocated).toBeCloseTo(120);
    expect(a.allocated).toBeCloseTo(200);
  });
  it('prices cache buckets separately and output only once', () => {
    expect(
      apiEquivalent(
        row({ input: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, output: 1_000_000 })
      )
    ).toBeCloseTo(29.2);
  });
  it('rolls up per-account dollars rather than using a global denominator', () => {
    const a = analyzeSpend(
      [row(), row({ account: 'team', model: 'claude-haiku-5-5', input: 1_000_000 })],
      { max: 200, team: 30 }
    );
    const sum = rollup(a);
    expect(sum.allocated).toBe(230);
    expect(sum.models.find((m) => m.model === 'claude-opus-5-5')?.allocated).toBe(200);
  });
  it('withholds allocation if any model has an unknown price', () => {
    const [a] = analyzeSpend([row(), row({ model: 'custom-alias' })], { max: 200 });
    expect(a.api).toBe(4);
    expect(a.missing).toBe(1);
    expect(a.allocated).toBe(0);
    expect(a.models[0].share).toBeNull();
  });
  it('keeps incomplete usage and free/no-usage plans distinct', () => {
    expect(analyzeSpend([row({ incomplete: 1 })], { max: 200 })[0].allocated).toBe(0);
    expect(analyzeSpend([row({ input: 0 })], { max: 200 })[0].models[0].share).toBeNull();
    expect(analyzeSpend([row()], { max: 0 })[0].models[0].allocatedAccounts).toBe(1);
    expect(analyzeSpend([row()], {})[0].models[0].allocatedAccounts).toBe(0);
  });
  it('applies long prompt pricing per request, with exact threshold boundaries', () => {
    expect(apiEquivalent(row({ model: 'claude-haiku-5-5', prompt: 100000 }))).toBe(0.1);
    expect(apiEquivalent(row({ model: 'claude-haiku-5-5', prompt: 100001 }))).toBe(0.5);
    expect(apiEquivalent(row({ model: 'gpt-6.1-sol', prompt: 272000 }))).toBe(2);
    expect(apiEquivalent(row({ model: 'gpt-6.1-sol', prompt: 272001 }))).toBe(4);
    expect(apiEquivalent(row({ model: 'grok-4.7', prompt: 199999 }))).toBe(2);
    expect(apiEquivalent(row({ model: 'grok-4.7', prompt: 200000 }))).toBe(4);
  });
  it('does not treat missing cache-write prices or object keys as free models', () => {
    expect(apiEquivalent(row({ model: 'grok-4.7', cacheWrite: 1 }))).toBeNull();
    expect(apiEquivalent(row({ model: 'constructor' }))).toBeNull();
  });
  it('computes half-open calendar months in local time, including leap years', () => {
    const r = monthRange('2024-02');
    expect(new Date(r.start).getDate()).toBe(1);
    expect(new Date(r.end).getMonth()).toBe(2);
    expect((r.end - r.start) / 86400000).toBe(29);
  });
});

describe('token contribution details', () => {
  it('reconciles category counts and costs with model totals', () => {
    const [account] = analyzeSpend(
      [row({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 })],
      { max: 200 }
    );
    const m = account.models[0];
    expect(m.categories.input.api).toBe(4);
    expect(m.categories.output.api).toBe(20);
    expect(m.categories.cacheRead.api).toBe(0.2);
    expect(m.categories.cacheWrite.api).toBe(5);
    expect(Object.values(m.categories).reduce((s, c) => s + c.api, 0)).toBeCloseTo(m.api);
    expect(Object.values(m.categories).reduce((s, c) => s + c.tokens, 0)).toBe(m.tokens);
    expect(Object.values(m.categories).reduce((s, c) => s + c.allocated, 0)).toBeCloseTo(200);
  });
  it('rolls up category allocations from each account rather than reweighting pooled costs', () => {
    const accounts = analyzeSpend([row(), row({ account: 'other', input: 0, output: 1_000_000 })], {
      max: 200,
      other: 20,
    });
    const m = rollup(accounts).models[0];
    expect(m.categories.input.allocated).toBe(200);
    expect(m.categories.output.allocated).toBe(20);
    expect(m.allocated).toBe(220);
  });
  it('retains counts and marks unknown contributions instead of inventing a cost', () => {
    const [account] = analyzeSpend([row({ model: 'custom', cacheRead: 500 })], { max: 200 });
    const m = account.models[0];
    expect(m.categories.input.tokens).toBe(1_000_000);
    expect(m.categories.cacheRead.tokens).toBe(500);
    expect(m.categories.input.missing).toBe(1);
    expect(m.categories.input.allocated).toBe(0);
  });
  it('sums short and long context costs separately before displaying category totals', () => {
    const [account] = analyzeSpend(
      [
        row({ model: 'gpt-6.1-sol', prompt: 200000 }),
        row({ model: 'gpt-6.1-sol', prompt: 300000 }),
      ],
      { max: 200 }
    );
    expect(account.models[0].categories.input.api).toBe(6);
    expect(account.models[0].categories.input.tokens).toBe(2_000_000);
  });
});

describe('GPT Image pricing', () => {
  it('registers standard text/image rates without text-model long-context multipliers', () => {
    for (const model of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
      const rate = TOKEN_RATES[model];
      expect(rate.input).toBe(5);
      expect(rate.cacheRead).toBe(1.25);
      expect(rate.image).toEqual({ input: 8, cacheRead: 2 });
      expect(rate.output).toBe(30);
      expect(rate.cacheWrite).toBeNull();
      expect(rate.long).toBeUndefined();
      expect(apiEquivalent(row({ model, input: 0, output: 1_000_000, prompt: 300000 }))).toBe(30);
    }
  });
  it('uses the image-input benchmark for combined input and includes subscription allocation', () => {
    const image = row({
      model: 'gpt-image-2.5-flare',
      input: 100,
      cacheRead: 50,
      output: 1_000_000,
    });
    expect(apiContributions(image)).toEqual({
      input: 0.0008,
      output: 30,
      cacheRead: 0.0001,
      cacheWrite: 0,
    });
    expect(apiEquivalent(image)).toBeCloseTo(30.0009, 8);
    const [account] = analyzeSpend([image], { max: 200 });
    expect(account.api).toBeCloseTo(30.0009, 8);
    expect(account.missing).toBe(0);
    expect(account.allocated).toBeCloseTo(200);
    expect(account.models[0].categories.input.missing).toBe(0);
    expect(account.models[0].categories.cacheRead.missing).toBe(0);
    expect(account.models[0].categories.output.missing).toBe(0);
    expect(account.models[0].categories.output.api).toBe(30);
    expect(rollup([account]).api).toBeCloseTo(30.0009, 8);
  });
  it('includes full estimated image cost in account/model totals and allocations', () => {
    const [account] = analyzeSpend([row(), row({ model: 'gpt-image-2', input: 14, output: 343 })], {
      max: 200,
    });
    expect(account.api).toBeCloseTo(4.010402, 8);
    expect(account.models.reduce((n, m) => n + m.api, 0)).toBeCloseTo(account.api);
    expect(account.models.every((m) => m.share !== null && m.allocatedAccounts === 1)).toBe(true);
    expect(account.allocated).toBeCloseTo(200);
    const image = account.models.find((m) => m.model === 'gpt-image-2')!;
    expect(image.tokens).toBe(357);
    expect(image.categories.output.api).toBeCloseTo(0.01029);
  });
  it('handles pinned models, missing accounting, and zero-token failures without guessing aliases', () => {
    expect(
      apiEquivalent(row({ model: 'gpt-image-2.5-sunburst-2026-09-08', input: 0, output: 1000 }))
    ).toBe(0.03);
    expect(apiEquivalent(row({ model: 'gpt-image-2.5', input: 0, output: 1000 }))).toBeNull();
    expect(apiContributions(row({ model: 'gpt-image-2', incomplete: 1 }))).toBeNull();
    const [failed] = analyzeSpend([row({ model: 'gpt-image-2', input: 0, failed: 1 })], {});
    expect(failed.api).toBe(0);
    expect(failed.missing).toBe(0);
  });
});

describe('Sol subscription cache-write estimate', () => {
  it('prices estimated writes and leaves Claude accounting unchanged', () => {
    const accounts = analyzeSpend(
      [
        row({
          provider: 'codex',
          model: 'gpt-6.1-sol',
          input: 0,
          cacheWrite: 400_000_000,
          estimatedCacheWrite: 400_000_000,
          cacheRead: 5_000_000_000,
        }),
        row({ provider: 'claude', account: 'claude', input: 280_000, cacheWrite: 50_000_000 }),
      ],
      {}
    );
    const total = rollup(accounts);
    const sol = total.models.find((m) => m.model === 'gpt-6.1-sol')!;
    const claude = total.models.find((m) => m.model === 'claude-opus-5-5')!;
    expect(sol.estimatedCacheWrite).toBe(400_000_000);
    expect(sol.categories.input.tokens).toBe(0);
    expect(sol.categories.cacheWrite.tokens).toBe(400_000_000);
    expect(sol.categories.cacheWrite.api).toBe(1000);
    expect(sol.api).toBe(1500);
    expect(sol.tokens).toBe(5_400_000_000);
    expect(claude.estimatedCacheWrite).toBe(0);
    expect(claude.categories.input.tokens).toBe(280_000);
    expect(claude.categories.cacheWrite.tokens).toBe(50_000_000);
  });
  it('never guesses from an aggregated row or marks upstream writes as estimated', () => {
    for (const changes of [{}, { cacheWrite: 500 }, { provider: 'openai-compatibility' }]) {
      const m = analyzeSpend([row({ provider: 'codex', model: 'gpt-6.1-sol', ...changes })], {})[0]
        .models[0];
      expect(m.estimatedCacheWrite).toBe(0);
      expect(m.categories.input.tokens).toBe(1_000_000);
    }
  });
  it('retains the estimated subset when measured and estimated writes share a rollup', () => {
    const m = rollup(
      analyzeSpend(
        [
          row({
            provider: 'codex',
            model: 'gpt-6.1-sol',
            input: 0,
            cacheWrite: 1000,
            estimatedCacheWrite: 1000,
          }),
          row({
            provider: 'codex',
            model: 'gpt-6.1-sol',
            account: 'other',
            input: 200,
            cacheWrite: 800,
          }),
        ],
        {}
      )
    ).models[0];
    expect(m.estimatedCacheWrite).toBe(1000);
    expect(m.categories.input.tokens).toBe(200);
    expect(m.categories.cacheWrite.tokens).toBe(1800);
    expect(m.tokens).toBe(2000);
  });
  it('includes the write premium in per-plan shares without changing the plan total', () => {
    const [a] = analyzeSpend(
      [
        row({
          provider: 'codex',
          model: 'gpt-6.1-sol',
          input: 0,
          cacheWrite: 1_000_000,
          estimatedCacheWrite: 1_000_000,
        }),
        row({ provider: 'codex', model: 'gpt-6.1-terra', input: 1_000_000 }),
      ],
      { max: 200 }
    );
    const sol = a.models.find((m) => m.model === 'gpt-6.1-sol')!;
    expect(a.api).toBeCloseTo(3.5);
    expect(sol.share).toBeCloseTo(2.5 / 3.5);
    expect(sol.allocated).toBeCloseTo((200 * 2.5) / 3.5);
    expect(a.allocated).toBeCloseTo(200);
    expect(Object.values(sol.categories).reduce((n, c) => n + c.allocated, 0)).toBeCloseTo(
      sol.allocated
    );
  });
});

it('prices the recorded GPT-5.6 Terra usage separately from GPT-6.1 Terra', () => {
  const recorded = row({
    provider: 'codex',
    model: 'gpt-5.6-terra',
    requests: 24,
    input: 126877,
    output: 24042,
    cacheRead: 1225984,
    cacheWrite: 0,
    prompt: 100000,
  });
  expect(apiEquivalent(recorded)).toBeCloseTo(0.7874548, 7);
  expect(apiEquivalent({ ...recorded, model: 'gpt-6.1-terra' })).toBeCloseTo(0.3083862, 7);
  const [account] = analyzeSpend([recorded], { max: 200 });
  expect(account.missing).toBe(0);
  expect(account.allocated).toBe(200);
  expect(
    apiEquivalent(
      row({
        model: 'gpt-5.6-terra',
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        prompt: 272001,
      })
    )
  ).toBeCloseTo(27.4);
});
