import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { configApi } from '../src/services/api/config';
import { isPreviewApiPath } from '../dev/readOnlyPreview';

let get: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  get?.mockRestore();
});

describe('development preview connection', () => {
  test('rejects a SPA HTML fallback instead of accepting a fake empty configuration', async () => {
    get = spyOn(apiClient, 'get').mockResolvedValue('<!doctype html><html>Vite preview</html>');
    await expect(configApi.getConfig()).rejects.toThrow('Check the connection address');
  });
  test('accepts the existing v8 configuration shape', async () => {
    get = spyOn(apiClient, 'get').mockResolvedValue({ routing: { strategy: 'round-robin' } });
    expect((await configApi.getConfig()).routingStrategy).toBe('round-robin');
  });
  test('protects nested and query-bearing API paths without capturing application assets', () => {
    expect(isPreviewApiPath('/v8/management/config')).toBe(true);
    expect(isPreviewApiPath('/v8/management/credentials?name=one')).toBe(true);
    expect(isPreviewApiPath('/v0/management/plugins/quota-reset-router/status')).toBe(true);
    expect(isPreviewApiPath('/v0/management/plugins/kpatdev-quota-router/status')).toBe(true);
    expect(isPreviewApiPath('/v0/management/plugins/kpatdev-quota-router/accounts')).toBe(true);
    expect(isPreviewApiPath('/v0/management/plugins/kpatdev-quota-router/refresh')).toBe(false);
    expect(isPreviewApiPath('/v1/models')).toBe(true);
    expect(isPreviewApiPath('/src/services/api/config.ts')).toBe(false);
  });
});

describe('preview Claude read allowlist', () => {
  test('only permits the fixed Claude profile/usage GETs, never a mutation or arbitrary URL', async () => {
    const { isClaudeOverviewRead } = await import('../dev/readOnlyPreview');
    const read = {
      method: 'GET',
      url: 'https://api.anthropic.com/api/oauth/profile',
      authIndex: '1',
    };
    expect(isClaudeOverviewRead(read)).toBe(true);
    expect(
      isClaudeOverviewRead({ ...read, url: 'https://api.anthropic.com/api/oauth/usage' })
    ).toBe(true);
    expect(
      isClaudeOverviewRead({ ...read, url: 'https://api.anthropic.com/api/oauth/usage/reset' })
    ).toBe(false);
    expect(isClaudeOverviewRead({ ...read, method: 'POST' })).toBe(false);
    expect(isClaudeOverviewRead({ ...read, url: 'https://example.com/' })).toBe(false);
    expect(isClaudeOverviewRead({ ...read, data: '{}' })).toBe(false);
    expect(isClaudeOverviewRead({ ...read, proxy_url: 'http://example.com' })).toBe(false);
  });
});
