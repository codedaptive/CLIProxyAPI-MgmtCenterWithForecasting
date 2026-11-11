import type { TFunction } from 'i18next';
import type { AuthFileItem, ClaudeProfileResponse } from '@/types';
import { apiCallApi } from '@/services/api/apiCall';
import { CLAUDE_PROFILE_URL, CLAUDE_REQUEST_HEADERS } from '@/utils/quota/constants';
import { resolveClaudePlanType } from '@/features/quota/providers/claude/data';
import {
  normalizePlanType,
  resolveCodexPlanType,
  PRO_LITE_CODEX_PLAN_TYPES,
  PRO_MAX_CODEX_PLAN_TYPES,
} from '@/utils/quota';
import type { ResetQuotaAccount } from '@/services/api/overview';
import { isRecord } from '@/utils/helpers';
import { providerOf } from './model';

export async function readClaudePlan(file: AuthFileItem): Promise<string | null> {
  if (file.authIndex == null) return null;
  const result = await apiCallApi.request(
    {
      authIndex: String(file.authIndex),
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    },
    { timeout: 10000 }
  );
  if (result.statusCode < 200 || result.statusCode >= 300 || !isRecord(result.body)) return null;
  return resolveClaudePlanType(result.body as ClaudeProfileResponse);
}

export function overviewPlanLabel(
  file: AuthFileItem,
  quota: ResetQuotaAccount | undefined,
  claudePlan: string | null | undefined,
  t: TFunction
): string | null {
  if (providerOf(file) === 'claude') return claudePlan ? t(`claude_quota.${claudePlan}`) : null;
  if (providerOf(file) !== 'codex') return null;
  const plan = normalizePlanType(quota?.planType ?? resolveCodexPlanType(file));
  if (!plan) return null;
  if (plan === 'self_serve_business_prolite') return t('codex_quota.plan_business_premium');
  if (plan === 'pro') return t('codex_quota.plan_pro');
  if (PRO_MAX_CODEX_PLAN_TYPES.has(plan)) return t('codex_quota.plan_promax');
  if (PRO_LITE_CODEX_PLAN_TYPES.has(plan)) return t('codex_quota.plan_prolite');
  if (['plus', 'team', 'free'].includes(plan)) return t(`codex_quota.plan_${plan}`);
  return plan;
}
