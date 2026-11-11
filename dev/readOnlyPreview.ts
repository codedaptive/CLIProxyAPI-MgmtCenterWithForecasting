import type { Plugin } from 'vite';

const API_PATHS = [
  '/v8/management',
  // Declared plugin extension, not a fallback for the core Management API.
  '/v0/management/plugins/quota-reset-router/status',
  '/v0/management/plugins/kpatdev-quota-router/status',
  '/v0/management/plugins/kpatdev-quota-router/accounts',
  '/v1/models',
];

export function isPreviewApiPath(url: string): boolean {
  const path = url.split('?')[0];
  return API_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const CLAUDE_READ_URLS = [
  'https://api.anthropic.com/api/oauth/profile',
  'https://api.anthropic.com/api/oauth/usage',
];
export function isClaudeOverviewRead(value: unknown): value is { authIndex: string; url: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    body.method === 'GET' &&
    typeof body.url === 'string' &&
    CLAUDE_READ_URLS.includes(body.url) &&
    typeof body.authIndex === 'string' &&
    body.authIndex.length > 0 &&
    !('data' in body) &&
    !('proxy_url' in body)
  );
}

/** Same-origin development reads; credentials still come from the normal login. */
export function readOnlyPreview(): Plugin {
  return {
    name: 'minillm-read-only-preview',
    apply: 'serve',
    config: () => ({
      server: {
        host: '127.0.0.1',
        proxy: {
          '/minillm/spend': {
            target: process.env.MINILLM_PREVIEW_SPEND || 'http://127.0.0.1:8318',
            changeOrigin: true,
          },
          ...Object.fromEntries(
            API_PATHS.map((prefix) => [
              prefix,
              {
                target: process.env.MINILLM_PREVIEW_API || 'http://127.0.0.1:8317',
                changeOrigin: true,
              },
            ])
          ),
        },
      },
    }),
    configureServer(server) {
      // Runs before Vite's proxy. Never send a mutation to the production backend.
      server.middlewares.use(async (req, res, next) => {
        if (!isPreviewApiPath(req.url || '') || ['GET', 'OPTIONS'].includes(req.method || '')) {
          next();
          return;
        }
        // The core API transports a provider quota/profile GET in a POST envelope.
        // Rebuild these allowlisted reads; never forward an arbitrary request body.
        if (req.method === 'POST' && req.url === '/v8/management/requests/api-call') {
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              const buffer = Buffer.from(chunk);
              size += buffer.length;
              if (size > 8192) throw new Error('Request too large');
              chunks.push(buffer);
            }
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (isClaudeOverviewRead(body)) {
              const response = await fetch(
                `${process.env.MINILLM_PREVIEW_API || 'http://127.0.0.1:8317'}/v8/management/requests/api-call`,
                {
                  method: 'POST',
                  redirect: 'error',
                  signal: AbortSignal.timeout(10000),
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: req.headers.authorization || '',
                  },
                  body: JSON.stringify({
                    authIndex: body.authIndex,
                    method: 'GET',
                    url: body.url,
                    header: {
                      'User-Agent': 'claude-cli/2.1.280 (external, cli)',
                      Authorization: 'Bearer $TOKEN$',
                      'Content-Type': 'application/json',
                      'anthropic-beta': 'oauth-2025-04-20',
                    },
                  }),
                }
              );
              res.statusCode = response.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(await response.text());
              return;
            }
          } catch {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Quota/profile read unavailable.' }));
            return;
          }
        }
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, OPTIONS');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'This development preview is read-only.' }));
      });
    },
  };
}
