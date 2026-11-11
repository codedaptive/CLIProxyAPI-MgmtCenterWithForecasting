// Presentation aliases preserve subscription identity when an upstream protocol changes.
// Original events remain untouched so the mapping is reversible and auditable.
export function validateAccountAliases(value) {
  if (!value || value.version !== 1 || !value.accounts || typeof value.accounts !== 'object' || Array.isArray(value.accounts)) throw new Error('Invalid account aliases');
  const result = Object.create(null);
  const text = v => typeof v === 'string' && v.length > 0 && v.length <= 256;
  for (const [id, entry] of Object.entries(value.accounts)) {
    if (!text(id) || !entry || !text(entry.account) || !text(entry.provider) || !text(entry.label)) throw new Error('Invalid account alias');
    result[id] = { account: entry.account, provider: entry.provider, label: entry.label };
  }
  for (const [id, entry] of Object.entries(result)) {
    if (entry.account !== id && Object.hasOwn(result, entry.account) && result[entry.account].account !== entry.account) throw new Error('Chained account aliases are not supported');
  }
  return result;
}
export function aliasSpendReport(report, aliases) {
  const plans = Object.create(null);
  for (const [id, amount] of Object.entries(report.plans)) {
    const account = aliases[id]?.account ?? id;
    if (Object.hasOwn(plans, account) && plans[account] !== amount) throw new Error('Conflicting plan prices');
    plans[account] = amount;
  }
  const accountLabels = Object.create(null);
  const providerLabels = Object.create(null);
  for (const entry of Object.values(aliases)) {
    accountLabels[entry.account] = entry.label;
    providerLabels[entry.provider] = entry.label;
  }
  return { ...report, plans, accountLabels, providerLabels, rows: report.rows.map(row => {
    const alias = aliases[row.account];
    return alias ? { ...row, account: alias.account, provider: alias.provider } : row;
  }) };
}

export function aliasSpendTimeline(timeline, aliases) {
  const apply = row => {
    const alias = aliases[row.account];
    return alias ? { ...row, account: alias.account, provider: alias.provider } : row;
  };
  return {...timeline, rows: timeline.rows.map(apply), recent: timeline.recent.map(apply)};
}
