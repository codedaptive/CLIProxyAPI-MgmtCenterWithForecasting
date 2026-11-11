import type { AccountSpend } from './model';
import { TOKEN_CATEGORIES } from './model';

// Formula-safe RFC 4180 CSV. Exports the selected month/provider, including hidden costs.
const cell = (value: string | number | null) => {
  const s = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
};
export function spendCsv(month: string, accounts: AccountSpend[]) {
  const rows: (string | number | null)[][] = [
    [
      'month',
      'provider',
      'account',
      'model',
      'requests',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'api_estimate_usd',
      'input_cost_usd',
      'output_cost_usd',
      'cache_read_cost_usd',
      'cache_write_cost_usd',
      'plan_fee_usd',
      'plan_allocation_usd',
      'account_api_share_percent',
      'unpriced_requests',
      'estimated_cache_write_tokens',
      'cache_write_accounting',
      'reported_input_tokens',
      'reported_cache_write_tokens',
    ],
  ];
  for (const a of accounts) {
    if (!a.models.length)
      rows.push([
        month,
        a.provider,
        a.id,
        '',
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        a.fee,
        0,
        null,
        0,
        0,
        'no_usage',
        0,
        0,
      ]);
    for (const m of a.models)
      rows.push([
        month,
        a.provider,
        a.id,
        m.model,
        m.requests,
        ...TOKEN_CATEGORIES.map((k) => m.categories[k].tokens),
        m.api,
        ...TOKEN_CATEGORIES.map((k) => m.categories[k].api),
        a.fee,
        m.allocatedAccounts ? m.allocated : null,
        m.share === null ? null : m.share * 100,
        m.missing,
        m.estimatedCacheWrite,
        m.estimatedCacheWrite > 0 ? 'sol-implicit-v1' : 'reported',
        m.categories.input.tokens + m.estimatedCacheWrite,
        m.categories.cacheWrite.tokens - m.estimatedCacheWrite,
      ]);
  }
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
