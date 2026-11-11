import { describe, expect, test } from 'bun:test';
import { overviewTopology, overviewUsage } from '../src/features/overview/topology';
import { normalizeConfigResponse } from '../src/services/api/transformers';
import { summarizeTraffic } from '../src/features/overview/model';

const config = (extra = {}) =>
  normalizeConfigResponse({
    'api-keys': {
      'openai-compatibility': [
        {
          name: 'QwenCloud',
          'base-url': 'https://example.test/v1',
          keys: [{ 'api-key': 'SECRET' }],
          models: [{ name: 'upstream', alias: 'designer' }],
          ...extra,
        },
      ],
    },
  });

describe('overview compatible provider topology', () => {
  test('includes providers without OAuth files or traffic and never exposes their keys', () => {
    const result = overviewTopology([], {}, config());
    expect(result.files).toHaveLength(1);
    expect(result.files[0].note).toBe('QwenCloud');
    expect(result.files[0].type).toBe('openai-compatible-qwencloud');
    expect(result.models[result.files[0].name]).toEqual(['designer']);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.providerNames['openai-compatible-qwencloud']).toBe('QwenCloud');
  });
  test('preserves OAuth destinations and counts API traffic once', () => {
    const file = { name: 'claude.json', type: 'claude' };
    const result = overviewTopology([file], { 'claude.json': ['opus'] }, config());
    expect(result.models['claude.json']).toEqual(['opus']);
    const usage = {
      qwencloud: {
        'https://example.test/v1|SECRET': {
          recent_requests: [{ time: '12:00-12:10', success: 4, failed: 1 }],
        },
      },
    };
    expect(
      summarizeTraffic(result.files, overviewUsage(usage, config()), 'openai-compatible-qwencloud')
        .total
    ).toBe(5);
  });
  test('handles disabled groups, multiple keys, aliases and forced prefixes', () => {
    const cfg = config({
      disabled: true,
      prefix: 'home',
      keys: [{ 'api-key': 'SECRET' }, { 'api-key': 'SECRET2' }],
    });
    cfg.forceModelPrefix = true;
    const result = overviewTopology([], {}, cfg);
    expect(result.files.map((f) => f.note)).toEqual(['QwenCloud #1', 'QwenCloud #2']);
    expect(result.files.every((f) => f.disabled)).toBe(true);
    expect(new Set(result.files.map((f) => f.name)).size).toBe(2);
    expect(Object.values(result.models)).toEqual([['home/designer'], ['home/designer']]);
    cfg.forceModelPrefix = false;
    expect(Object.values(overviewTopology([], {}, cfg).models)[0]).toEqual([
      'designer',
      'home/designer',
    ]);
  });
  test('supports keyless local providers and empty configuration', () => {
    expect(overviewTopology([], {}, config({ keys: [] })).files).toHaveLength(1);
    expect(overviewTopology([], {}, null).files).toEqual([]);
  });
  test('does not duplicate a runtime credential when the server supplies its auth index', () => {
    const cfg = config();
    cfg.openaiCompatibility![0].apiKeyEntries[0].authIndex = 'index-1';
    const file = { name: 'runtime', type: 'openai-compatible-qwencloud', authIndex: 'index-1' };
    const result = overviewTopology([file], { runtime: ['designer'] }, cfg);
    expect(result.files).toEqual([file]);
    expect(Object.keys(result.models)).toEqual(['runtime']);
  });
});

test('Anthropic-compatible routes keep provider identity, traffic and v8 auth indices', () => {
  const cfg = normalizeConfigResponse({
    'api-keys': {
      claude: [
        {
          name: 'GLM',
          'base-url': 'https://example.test/anthropic',
          models: [{ name: 'glm-model' }],
          keys: [{ 'api-key': 'PRIVATE', auth_index: 'native-index' }],
        },
      ],
    },
  });
  expect(cfg.claudeApiKeys?.[0].authIndex).toBe('native-index');
  const topology = overviewTopology([], {}, cfg);
  expect(topology.files[0].type).toBe('openai-compatible-glm');
  expect(topology.files[0].note).toBe('GLM');
  expect(topology.files[0].authIndex).toBe('native-index');
  expect(Object.values(topology.models)).toEqual([['glm-model']]);
  expect(JSON.stringify(topology)).not.toContain('PRIVATE');
  const usage = overviewUsage(
    {
      claude: {
        'https://example.test/anthropic|PRIVATE': {
          recent_requests: [{ time: '12:00-12:10', success: 2, failed: 1 }],
        },
        'official|another': { recent_requests: [{ time: '12:00-12:10', success: 5, failed: 0 }] },
      },
    },
    cfg
  );
  expect(summarizeTraffic([], usage, 'openai-compatible-glm').total).toBe(3);
  expect(summarizeTraffic([], usage, 'claude').total).toBe(5);
  expect(summarizeTraffic([], usage, '').total).toBe(8);
});
