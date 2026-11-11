import type { UsageRow } from '@/features/spend/types';
export interface SubscriptionTerms {
  planType: string;
  planId?: string;
  cadence: 'monthly' | 'annual';
  renewalDate: string | null;
}
export interface CapacityCycle {
  account: string;
  provider: string;
  window: 'seven_day' | 'five_hour' | `seven_day_${string}`;
  model: string;
  resetAt: number;
  tokens: number;
  used: number;
  intervals: number;
  estimated?: boolean;
  start: number;
  end: number;
}
export interface PlanningData {
  version: 1;
  now: number;
  quotaSince: number | null;
  mixedIntervals: number;
  invalidIntervals: number;
  cycles: CapacityCycle[];
  quotaRuns?: QuotaRun[];
  windows?: { account: string; window: CapacityCycle['window'] }[];
  mixed?: {
    account: string;
    provider: string;
    window: CapacityCycle['window'];
    resetAt: number;
    start: number;
    end: number;
    used: number;
    intervals?: number;
    rows: UsageRow[];
  }[];
  terms: Record<string, SubscriptionTerms>;
}

export interface QuotaRun {
  account: string;
  provider: string;
  window: CapacityCycle['window'];
  resetAt: number;
  start: number;
  end: number;
  startRemaining: number;
  endRemaining: number;
  used: number;
  exhausted: boolean;
  intervals: number;
  rows: UsageRow[];
}
