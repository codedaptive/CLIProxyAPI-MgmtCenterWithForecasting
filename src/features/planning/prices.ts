import { isTeamPlan, type PlanOption } from './model';
export interface PublishedPlan {
  id: string;
  provider: string;
  name: string;
  cadence: 'monthly' | 'annual';
  amount: number;
  minimumSeats?: number;
}
export interface PlanCatalog {
  version: 1;
  checkedAt: number | null;
  sources: {
    provider: string;
    url: string;
    checkedAt: number;
    status: 'ok' | 'unavailable';
    plans: PublishedPlan[];
  }[];
}
export interface PlanningSettings {
  taxRate: number;
  catalog: PlanCatalog | null;
  individualPlansOnly?: boolean;
  preferFewestAccounts?: boolean;
}
export const DEFAULT_PURCHASE_POLICY = { individualPlansOnly: true, preferFewestAccounts: true };
export const pricingProvider = (provider: string) => provider.replace(/^openai-compatible-/, '');
export const DEFAULT_TAX_RATE = 8.25;
export function validTax(value: string | number) {
  return (
    String(value).trim() !== '' &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= 100
  );
}
export function purchaseOptions(existing: PlanOption[], settings: PlanningSettings): PlanOption[] {
  if (!validTax(settings.taxRate)) throw new Error('Invalid tax rate');
  const retained = existing.map((p) => ({
    ...p,
    limit:
      settings.individualPlansOnly && isTeamPlan(p.planType)
        ? 0
        : p.cadence === 'monthly'
          ? p.current - p.fixed
          : 0,
  }));
  const fresh =
    settings.catalog?.sources.filter((s) => s.status === 'ok').flatMap((s) => s.plans) ?? [];
  return [
    ...retained,
    ...fresh.flatMap((p): PlanOption[] => {
      if (settings.individualPlansOnly && isTeamPlan(p.name)) return [];
      const match = existing.find(
        (e) =>
          pricingProvider(e.provider) === p.provider &&
          (e.planIds?.includes(p.id) || e.planType === p.name)
      );
      if (!match) return [];
      // Minimum team seat rules are satisfied by already committed seats only.
      // Without them, a newly selected team option must purchase its minimum.
      const teamFixed = existing
        .filter((e) => pricingProvider(e.provider) === p.provider && /team/i.test(e.planType))
        .reduce((n, e) => n + e.fixed, 0);
      return [
        {
          id: p.id,
          key: match.key,
          quotaWindows: match.quotaWindows,
          provider: p.provider,
          planType: p.name,
          cadence: p.cadence,
          price: p.amount * (1 + settings.taxRate / 100),
          fixed: 0,
          availableFixed: 0,
          current: 0,
          committedCost: 0,
          unknownCost: false,
          minimum: Math.max(1, (p.minimumSeats ?? 1) - teamFixed),
        },
      ];
    }),
  ];
}

export function providerPlans(catalog: PlanCatalog | null, provider: string): PublishedPlan[] {
  return (
    catalog?.sources
      .filter((s) => s.status === 'ok')
      .flatMap((s) => s.plans)
      .filter((p) => p.provider === pricingProvider(provider)) ?? []
  );
}

export function selectedContract(plan: PublishedPlan, taxRate: number, renewalDate: string) {
  if (!validTax(taxRate)) throw new Error('Invalid tax rate');
  return {
    amount: Number((plan.amount * (1 + taxRate / 100)).toFixed(4)),
    terms: {
      planId: plan.id,
      planType: plan.name,
      cadence: plan.cadence,
      renewalDate: renewalDate || null,
    },
  };
}
