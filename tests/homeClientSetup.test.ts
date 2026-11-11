import { describe, expect, test } from 'bun:test';
import { clientCommand, clientEndpoints } from '../src/features/dashboard/clientSetup';

describe('home client setup', () => {
  test('uses the server origin for Claude and v1 for Codex, preserving a proxy prefix', () => {
    expect(clientEndpoints('https://mini.local/proxy/v8/management/?ignored=1#tab')).toEqual({
      root: 'https://mini.local/proxy',
      responses: 'https://mini.local/proxy/v1',
      localOnly: false,
    });
    expect(clientEndpoints('http://localhost:8317/v1')?.responses).toBe('http://localhost:8317/v1');
    expect(clientEndpoints('http://[::1]:8317')?.localOnly).toBe(true);
  });
  test('rejects invalid, credential-bearing, and non-HTTP addresses', () => {
    for (const base of [
      '',
      'mini.local',
      'javascript:alert(1)',
      'https://user:secret@mini.local',
    ]) {
      expect(clientEndpoints(base)).toBeNull();
      expect(clientCommand('claude', base)).toBe('');
    }
  });
  test('uses a runtime client key and never a management key or persisted auth change', () => {
    const claude = clientCommand('claude', 'http://mini.local:8317');
    const codex = clientCommand('codex', 'http://mini.local:8317');
    expect(claude).toContain('CLI_PROXY_API_KEY:?');
    expect(claude).toContain("ANTHROPIC_API_KEY=''");
    expect(codex).toContain('wire_api="responses"');
    expect(codex).toContain('env_key="CLI_PROXY_API_KEY"');
    expect(codex).toContain('requires_openai_auth=false');
    for (const command of [claude, codex]) {
      expect(command).not.toContain('management_key');
      expect(command).not.toContain('auth.json');
      expect(command).not.toContain('bypassPermissions');
    }
  });
  test('quotes shell metacharacters in configured server paths', () => {
    const command = clientCommand('claude', "https://mini.local/a'$(id)");
    expect(command).toContain("'\"'\"'");
    expect(command).toStartWith("ANTHROPIC_BASE_URL='");
  });
});

describe('LAN client portability', () => {
  test('desktop setup uses the selected LAN address without any server-local helper', () => {
    const config = clientCommand('codex-desktop', 'http://192.168.50.155:8317');
    expect(config).toContain('base_url = "http://192.168.50.155:8317/v1"');
    expect(config).toContain('"X-Api-Key" = "PASTE_CLIENT_KEY_HERE"');
    expect(config).not.toContain('activate-codex');
    expect(config).not.toContain('/Users/');
    expect(config).not.toContain('127.0.0.1');
  });
  test('desktop setup is valid TOML with a placeholder key', async () => {
    const { TOML } = await import('bun');
    const config = TOML.parse(clientCommand('codex-desktop', 'http://mini.local:8317'));
    expect(config.model_provider).toBe('cliproxy_lan');
  });
  test('PowerShell uses its own environment syntax and line continuations', () => {
    const claude = clientCommand('claude', 'http://192.168.50.155:8317', 'powershell');
    expect(claude).toContain('$env:ANTHROPIC_AUTH_TOKEN = $env:CLI_PROXY_API_KEY');
    expect(claude).not.toContain('${');
    const codex = clientCommand('codex', 'http://192.168.50.155:8317', 'powershell');
    expect(codex).toContain('codex `\n');
    expect(codex).not.toContain(' \\\n');
  });
});
