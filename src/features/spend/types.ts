import type { SubscriptionTerms } from '@/features/planning/types';
export interface UsageRow {
  account: string;
  provider: string;
  model: string;
  prompt: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  // Subset of cacheWrite moved from reported input by the recorder's estimate.
  estimatedCacheWrite?: number;
  output: number;
  incomplete: number;
  failed: number;
  requests: number;
}
export interface SpendReport {
  version: 1;
  cacheWriteEstimateVersion?: 'sol-implicit-v1';
  month: string;
  createdAt: number;
  lastPoll: number | null;
  enabled: boolean;
  error: string | null;
  rejected: number;
  gaps: number;
  rows: UsageRow[];
  plans: Record<string, number>;
  terms?: Record<string, SubscriptionTerms>;
  accountLabels?: Record<string, string>;
  providerLabels?: Record<string, string>;
}
export interface SpendTimelineData {
  version: 1;
  cacheWriteEstimateVersion?: 'sol-implicit-v1';
  month: string;
  now: number;
  start: number;
  end: number;
  bucketMs: number;
  createdAt: number;
  lastPoll: number | null;
  error: string | null;
  enabled: boolean;
  rows: (UsageRow & { at: number })[];
  recent: UsageRow[];
}
export interface TokenRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number | null;
  source: string;
  // GPT Image accepts text/image input but only produces image output.
  // Flat input/cacheRead rates describe text; image input has separate rates.
  image?: { input: number; cacheRead: number };
  long?: {
    above: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number | null;
  };
}
