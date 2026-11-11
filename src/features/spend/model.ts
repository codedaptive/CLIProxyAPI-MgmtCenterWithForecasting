import { TOKEN_RATES } from './rates';
import type { TokenRate, UsageRow } from './types';

export const TOKEN_CATEGORIES = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];
export interface CategorySpend {
  tokens: number;
  api: number;
  allocated: number;
  missing: number;
}
export function apiContributions(
  row: UsageRow,
  rates = TOKEN_RATES
): Record<TokenCategory, number | null> | null {
  const published: TokenRate | undefined = Object.prototype.hasOwnProperty.call(rates, row.model)
    ? rates[row.model]
    : undefined;
  if (!published || row.incomplete > 0) return null;
  if (published.image) {
    // CPA combines input modalities. Use the published image rate as a
    // conservative benchmark for that input; output is image-only.
    return {
      input: (row.input * published.image.input) / 1_000_000,
      cacheRead: (row.cacheRead * published.image.cacheRead) / 1_000_000,
      cacheWrite: row.cacheWrite === 0 ? 0 : null,
      output: (row.output * published.output) / 1_000_000,
    };
  }
  const rate = published.long && row.prompt > published.long.above ? published.long : published;
  if (row.cacheWrite > 0 && rate.cacheWrite === null) return null;
  return {
    input: (row.input * rate.input) / 1_000_000,
    output: (row.output * rate.output) / 1_000_000,
    cacheRead: (row.cacheRead * rate.cacheRead) / 1_000_000,
    cacheWrite: (row.cacheWrite * (rate.cacheWrite ?? 0)) / 1_000_000,
  };
}
export function apiEquivalent(row: UsageRow, rates = TOKEN_RATES): number | null {
  const costs = apiContributions(row, rates);
  return costs && TOKEN_CATEGORIES.every((key) => costs[key] !== null)
    ? TOKEN_CATEGORIES.reduce((sum, key) => sum + (costs[key] ?? 0), 0)
    : null;
}

export interface ModelSpend {
  model: string;
  estimatedCacheWrite: number;
  categories: Record<TokenCategory, CategorySpend>;
  api: number;
  missing: number;
  requests: number;
  tokens: number;
  allocated: number;
  allocatedAccounts: number;
  share: number | null;
}
export interface AccountSpend {
  id: string;
  provider: string;
  api: number;
  missing: number;
  fee: number | null;
  allocated: number;
  models: ModelSpend[];
}
const emptyModel = (model: string): ModelSpend => ({
  model,
  estimatedCacheWrite: 0,
  categories: {
    input: { tokens: 0, api: 0, allocated: 0, missing: 0 },
    output: { tokens: 0, api: 0, allocated: 0, missing: 0 },
    cacheRead: { tokens: 0, api: 0, allocated: 0, missing: 0 },
    cacheWrite: { tokens: 0, api: 0, allocated: 0, missing: 0 },
  },
  api: 0,
  missing: 0,
  requests: 0,
  tokens: 0,
  allocated: 0,
  allocatedAccounts: 0,
  share: null,
});
export function analyzeSpend(rows: UsageRow[], fees: Record<string, number>, rates = TOKEN_RATES) {
  const accounts = new Map<string, AccountSpend>();
  for (const row of rows) {
    const id = row.account;
    let a = accounts.get(id);
    if (!a) {
      const fee =
        Object.prototype.hasOwnProperty.call(fees, id) && Number.isFinite(fees[id]) && fees[id] >= 0
          ? fees[id]
          : null;
      a = {
        id,
        provider: row.provider,
        api: 0,
        missing: 0,
        fee,
        allocated: 0,
        models: [],
      };
      accounts.set(id, a);
    }
    let m = a.models.find((m) => m.model === row.model);
    if (!m) {
      m = emptyModel(row.model);
      a.models.push(m);
    }
    const contributions = apiContributions(row, rates);
    const cost = contributions
      ? TOKEN_CATEGORIES.reduce((sum, key) => sum + (contributions[key] ?? 0), 0)
      : 0;
    const missing =
      (!contributions || TOKEN_CATEGORIES.some((key) => contributions[key] === null)) &&
      (row.incomplete > 0 || row.input + row.output + row.cacheRead + row.cacheWrite > 0);
    if (missing) {
      a.missing += row.requests;
      m.missing += row.requests;
    }
    a.api += cost;
    m.api += cost;
    for (const key of TOKEN_CATEGORIES) {
      m.categories[key].tokens += row[key];
      m.categories[key].api += contributions?.[key] ?? 0;
      if (missing && contributions?.[key] == null && (row[key] > 0 || row.incomplete > 0))
        m.categories[key].missing += row.requests;
    }
    m.requests += row.requests;
    m.estimatedCacheWrite += row.estimatedCacheWrite ?? 0;
    m.tokens += row.input + row.output + row.cacheRead + row.cacheWrite;
  }
  for (const a of accounts.values()) {
    for (const m of a.models) {
      if (!a.missing && a.api > 0) {
        m.share = m.api / a.api;
        if (a.fee !== null) {
          m.allocated = a.fee * m.share;
          m.allocatedAccounts = 1;
          for (const key of TOKEN_CATEGORIES)
            m.categories[key].allocated = (a.fee * m.categories[key].api) / a.api;
          a.allocated += m.allocated;
        }
      }
    }
    a.models.sort((a, b) => b.api - a.api || a.model.localeCompare(b.model));
  }
  return [...accounts.values()].sort((a, b) => b.api - a.api);
}
export function rollup(accounts: AccountSpend[]) {
  const models = new Map<string, ModelSpend>();
  let api = 0,
    allocated = 0,
    missing = 0;
  for (const a of accounts) {
    api += a.api;
    allocated += a.allocated;
    missing += a.missing;
    for (const model of a.models) {
      let m = models.get(model.model);
      if (!m) {
        m = emptyModel(model.model);
        models.set(model.model, m);
      }
      for (const key of TOKEN_CATEGORIES) {
        const target = m.categories[key];
        const source = model.categories[key];
        target.tokens += source.tokens;
        target.api += source.api;
        target.allocated += source.allocated;
        target.missing += source.missing;
      }
      m.api += model.api;
      m.estimatedCacheWrite += model.estimatedCacheWrite;
      m.allocated += model.allocated;
      m.missing += model.missing;
      m.requests += model.requests;
      m.tokens += model.tokens;
      m.allocatedAccounts += model.allocatedAccounts;
    }
  }
  for (const m of models.values()) m.share = allocated > 0 ? m.allocated / allocated : null;
  return {
    api,
    allocated,
    missing,
    models: [...models.values()].sort((a, b) => b.allocated - a.allocated || b.api - a.api),
  };
}
export function monthRange(month: string) {
  const [year, m] = month.split('-').map(Number);
  return { start: new Date(year, m - 1, 1).getTime(), end: new Date(year, m, 1).getTime() };
}
export function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
