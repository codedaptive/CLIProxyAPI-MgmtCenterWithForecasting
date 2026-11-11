import { createHash } from 'node:crypto';

const digest = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  ? createHash('sha256').update('minillm-cache-session-v1\0').update(value).digest('hex') : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const oneOf = (value, choices) => choices.includes(value) ? value : null;

// Allowlisted metadata only. Never retain raw user agents, session identifiers,
// client addresses, API keys, request/response headers or prompt/response bodies.
export function diagnosticMetadata(row) {
  const ua = typeof row.user_agent === 'string' ? row.user_agent.toLowerCase() : '';
  const client = /claude-cli|claude-code|claude_code/.test(ua) ? 'claude-code'
    : /codex/.test(ua) ? 'codex'
    : /claude/.test(ua) ? 'claude'
    : /anthropic/.test(ua) ? 'anthropic-sdk'
    : /opencode/.test(ua) ? 'opencode'
    : /openai/.test(ua) ? 'openai-sdk'
    : ua ? 'other' : 'unknown';
  const endpointPath = typeof row.endpoint === 'string' ? row.endpoint.replace(/^(?:POST|GET) /, '') : null;
  const endpoint = oneOf(endpointPath, ['/v1/messages', '/v1/responses', '/v1/responses/compact', '/v1/chat/completions', '/v1/completions']);
  return {
    version: 1,
    session: digest(row.session_id), parent: digest(row.parent_session_id),
    trace: typeof row.trace_id === 'string' && /^[a-f0-9]{8,32}$/i.test(row.trace_id) ? row.trace_id : null,
    endpoint, client,
    tokenVersion: typeof row.access_token_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(row.access_token_sha256) ? row.access_token_sha256 : null,
    effort: oneOf(row.reasoning_effort, ['none','minimal','low','medium','high','xhigh','max','auto']),
    node: oneOf(row.node_kind, ['session','subagent','fork','compaction','root','agent']),
    fork: row.is_fork === true, compaction: row.is_compaction === true,
    latency: count(row.latency_ms), ttft: count(row.ttft_ms),
  };
}

export function validDiagnostics(d) {
  const hash = value => value === null || typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  return d?.version === 1 && hash(d.session) && hash(d.parent) && hash(d.tokenVersion) &&
    (d.trace === null || typeof d.trace === 'string' && /^[a-f0-9]{8,32}$/i.test(d.trace)) &&
    [null,'/v1/messages','/v1/responses','/v1/responses/compact','/v1/chat/completions','/v1/completions'].includes(d.endpoint) &&
    ['claude-code','codex','claude','anthropic-sdk','opencode','openai-sdk','other','unknown'].includes(d.client) &&
    [null,'none','minimal','low','medium','high','xhigh','max','auto'].includes(d.effort) &&
    [null,'session','subagent','fork','compaction','root','agent'].includes(d.node) &&
    typeof d.fork === 'boolean' && typeof d.compaction === 'boolean' &&
    (d.latency === null || count(d.latency) !== null) && (d.ttft === null || count(d.ttft) !== null);
}
