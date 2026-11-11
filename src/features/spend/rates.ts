import type { TokenRate } from './types';

// Published standard USD / million token benchmark, verified 2026-10-19.
// Exact IDs only: arbitrary aliases and unknown models must never receive a guessed rate.
export const TERRA_RATE_DATE = '2026-11-04';
export const RATE_DATE = '2026-10-19';
export const IMAGE_RATE_DATE = '2026-10-21';
export const DEEPSEEK_RATE_DATE = '2026-10-28';
export const GLM_RATE_DATE = '2026-10-28';
export const QWEN_RATE_DATE = '2026-10-28';
export const RATE_SOURCES = {
  claude: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  xai: 'https://docs.x.ai/developers/pricing',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  glm: 'https://docs.z.ai/guides/overview/pricing',
  qwen: 'https://www.qwencloud.com/models',
};
const claude = (input: number, output: number, cacheRead: number): TokenRate => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
  source: RATE_SOURCES.claude,
});
const openai = (input: number, output: number, cacheRead: number): TokenRate => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
  source: RATE_SOURCES.openai,
  long: {
    above: 272000,
    input: input * 2,
    output: output * 1.5,
    cacheRead: cacheRead * 2,
    cacheWrite: input * 2.5,
  },
});
const grok = (input: number, output: number, cacheRead: number): TokenRate => ({
  input,
  output,
  cacheRead,
  cacheWrite: null,
  source: RATE_SOURCES.xai,
  long: {
    above: 199999,
    input: input * 2,
    output: output * 2,
    cacheRead: cacheRead * 2,
    cacheWrite: null,
  },
});
const gptImage = (): TokenRate => ({
  input: 5,
  cacheRead: 1.25,
  image: { input: 8, cacheRead: 2 },
  output: 30,
  cacheWrite: null,
  source: RATE_SOURCES.openai,
});
export const TOKEN_RATES: Record<string, TokenRate> = {
  // Singapore list prices; cache reads use the implicit-cache benchmark.
  // Max explicit-cache reads are cheaper ($0.17), but the recorder combines them.
  'qwen3.8-max': {
    input: 2,
    output: 6,
    cacheRead: 0.25,
    cacheWrite: 2.5,
    source: 'https://www.qwencloud.com/models/qwen3.8-max',
  },
  'qwen3.8-flash': {
    input: 0.15,
    output: 0.47,
    cacheRead: 0.016,
    cacheWrite: 0.2,
    source: 'https://www.qwencloud.com/models/qwen3.8-flash',
  },
  'glm-5.3': {
    input: 1.4,
    output: 4.4,
    cacheRead: 0.26,
    cacheWrite: null,
    source: RATE_SOURCES.glm,
  },
  'glm-5.3-flash': {
    input: 0.15,
    output: 0.5,
    cacheRead: 0.03,
    cacheWrite: null,
    source: RATE_SOURCES.glm,
  },
  // Peak-rate benchmark: off-peak costs half as much. The current recorder
  // aggregates requests without retaining a peak/off-peak pricing bucket.
  'deepseek-flash': {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheWrite: null,
    source: RATE_SOURCES.deepseek,
  },
  'deepseek-v4-pro': {
    input: 1.32,
    output: 3.96,
    cacheRead: 0.044,
    cacheWrite: null,
    source: RATE_SOURCES.deepseek,
  },
  'claude-fable-5-1': claude(10, 50, 0.25),
  'claude-opus-5-5': claude(4, 20, 0.2),
  'claude-sonnet-5-5': claude(2, 10, 0.1),
  'claude-haiku-5-5': {
    ...claude(0.1, 0.5, 0.01),
    long: {
      above: 100000,
      input: 0.5,
      output: 2.5,
      cacheRead: 0.05,
      cacheWrite: 0.625,
    },
  },
  'claude-opus-4-6': claude(5, 25, 0.5),
  'claude-sonnet-4-6': claude(3, 15, 0.3),
  'claude-haiku-4-5': claude(1, 5, 0.1),
  'gpt-6.1-terra': openai(1, 5, 0.05),
  'gpt-6.1-sol': openai(2, 10, 0.1),
  'gpt-6-astra': openai(10, 50, 1),
  'gpt-6-luna': openai(0.1, 0.5, 0.01),
  'gpt-5.6-sol': openai(4, 20, 0.4),
  'gpt-5.6-terra': {
    ...openai(2, 12, 0.2),
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
  },
  'gpt-image-2': gptImage(),
  'gpt-image-2-2026-04-21': gptImage(),
  'gpt-image-2.5-sunburst': gptImage(),
  'gpt-image-2.5-sunburst-2026-09-08': gptImage(),
  'gpt-image-2.5-flare': gptImage(),
  'gpt-image-2.5-flare-2026-09-08': gptImage(),
  'gemini-3.8-flash': {
    input: 0.75,
    output: 3.75,
    cacheRead: 0.075,
    cacheWrite: null,
    source: RATE_SOURCES.google,
  },
  'gemini-3.5-flash-lite': {
    input: 0.3,
    output: 2.5,
    cacheRead: 0.03,
    cacheWrite: null,
    source: RATE_SOURCES.google,
  },
  'grok-4.7': grok(2, 6, 0.5),
  'grok-4.6': grok(2, 6, 0.5),
  'grok-build-0.1': grok(1, 2, 0.2),
};
