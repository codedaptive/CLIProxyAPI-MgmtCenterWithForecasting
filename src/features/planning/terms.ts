import type { SubscriptionTerms } from './types';
export function defaultTerms(
  provider: string,
  detected: string | null | undefined
): SubscriptionTerms {
  const team = /team|business/i.test(detected ?? '');
  const planType =
    provider === 'claude'
      ? /max|ultra/.test(detected ?? '')
        ? 'Ultra'
        : team
          ? 'Team (tier unconfirmed)'
          : /pro/.test(detected ?? '')
            ? 'Pro'
            : 'Unclassified'
      : detected?.replace(/^plan_/, '').replace(/_/g, ' ') || 'Unclassified';
  return {
    planType,
    cadence: team ? 'annual' : 'monthly',
    renewalDate: team ? '2027-02-28' : null,
  };
}
