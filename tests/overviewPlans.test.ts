import { expect, test } from 'bun:test';
import i18next from 'i18next';
import en from '../src/i18n/locales/en.json';
import { overviewPlanLabel } from '../src/features/overview/plans';
import { normalizeResetRouterStatus } from '../src/services/api/overview';
import { resolveClaudePlanType } from '../src/features/quota/providers/claude/data';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const t = i18n.t.bind(i18n);
test.each([
  ['pro', 'Pro 200'],
  ['prolite', 'Pro 100'],
  ['pro-lite', 'Pro 100'],
  ['promax', 'Pro 500'],
  ['pro_max', 'Pro 500'],
  ['self_serve_business_prolite', 'Business Premium'],
])('labels the upstream Codex plan %s', (plan, label) => {
  const snapshot = normalizeResetRouterStatus({
    accounts: { one: { provider: 'codex', quota: { plan_type: plan } } },
  });
  expect(overviewPlanLabel({ name: 'one', type: 'codex' }, snapshot.accounts[0], null, t)).toBe(
    label
  );
});
test('preserves Codex plan from plugin snapshot and labels Plus', () => {
  const snapshot = normalizeResetRouterStatus({
    accounts: { one: { provider: 'codex', quota: { plan_type: 'plus' } } },
  });
  expect(overviewPlanLabel({ name: 'one', type: 'codex' }, snapshot.accounts[0], null, t)).toBe(
    'Plus'
  );
});
test('Claude Team token takes precedence over personal Max flags', () => {
  const plan = resolveClaudePlanType({
    account: { has_claude_max: true },
    organization: { organization_type: 'claude_team', subscription_status: 'active' },
  });
  expect(overviewPlanLabel({ name: 'one', type: 'claude' }, undefined, plan, t)).toBe('Team');
  expect(overviewPlanLabel({ name: 'one', type: 'claude' }, undefined, 'plan_max', t)).toBe('Max');
});
test('does not guess a tier from the account name or quota utilization', () => {
  expect(
    overviewPlanLabel({ name: 'max-team-plus.json', type: 'claude' }, undefined, null, t)
  ).toBeNull();
  expect(overviewPlanLabel({ name: 'plus.json', type: 'codex' }, undefined, null, t)).toBeNull();
});
