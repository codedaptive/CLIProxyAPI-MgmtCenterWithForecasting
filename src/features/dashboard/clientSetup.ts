export type HomeClient = 'claude' | 'codex' | 'codex-desktop';
export type ClientShell = 'posix' | 'powershell';

const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
const powershellQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function clientEndpoints(base: string) {
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/(?:v8\/management|v1)\/?$/, '').replace(/\/+$/, '');
    const root = url.toString().replace(/\/+$/, '');
    return {
      root,
      responses: `${root}/v1`,
      localOnly: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    };
  } catch {
    return null;
  }
}

// Commands and configuration never embed actual client or management keys.
export function clientCommand(
  client: HomeClient,
  base: string,
  shell: ClientShell = 'posix'
): string {
  const endpoints = clientEndpoints(base);
  if (!endpoints) return '';
  if (client === 'codex-desktop') {
    return `model_provider = "cliproxy_lan"

[model_providers.cliproxy_lan]
name = "Home network"
base_url = ${JSON.stringify(endpoints.responses)}
wire_api = "responses"
requires_openai_auth = false
http_headers = { "X-Api-Key" = "PASTE_CLIENT_KEY_HERE" }`;
  }
  if (client === 'claude') {
    if (shell === 'powershell') {
      return `if (-not $env:CLI_PROXY_API_KEY) { throw 'Set CLI_PROXY_API_KEY first' }
$env:ANTHROPIC_BASE_URL = ${powershellQuote(endpoints.root)}
$env:ANTHROPIC_AUTH_TOKEN = $env:CLI_PROXY_API_KEY
$env:ANTHROPIC_API_KEY = ''
claude`;
    }
    return `ANTHROPIC_BASE_URL=${shellQuote(endpoints.root)} \\\nANTHROPIC_AUTH_TOKEN="\${CLI_PROXY_API_KEY:?Set CLI_PROXY_API_KEY first}" \\\nANTHROPIC_API_KEY='' \\\nclaude`;
  }
  const overrides = [
    'model_provider="cliproxy_session"',
    'model_providers.cliproxy_session.name="Home server"',
    `model_providers.cliproxy_session.base_url=${JSON.stringify(endpoints.responses)}`,
    'model_providers.cliproxy_session.env_key="CLI_PROXY_API_KEY"',
    'model_providers.cliproxy_session.wire_api="responses"',
    'model_providers.cliproxy_session.requires_openai_auth=false',
  ];
  const quote = shell === 'powershell' ? powershellQuote : shellQuote;
  const continuation = shell === 'powershell' ? ' `\n' : ' \\\n';
  return ['codex', ...overrides.map((value) => `  -c ${quote(value)}`)].join(continuation);
}
