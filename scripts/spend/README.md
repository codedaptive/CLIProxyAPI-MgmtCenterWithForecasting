# MiniLLM spend recorder

This companion service records token metadata from CLIProxyAPI v8.0.30's authenticated
`GET /v8/management/observability/usage/queue?count=500` endpoint. That endpoint **pops**
records: run one collector per proxy and do not attach another queue consumer. The
backend checkout used to verify the contract was tag `v8.0.30`, commit
`5be2cdab0869cbaa3d401891f740aebf7e15aa99` (`redisqueue/plugin.go`,
`usage/accounting.go`, `server_management_v8.go`, `server_reload.go`).

Node 24+ with built-in SQLite is required. No extra runtime dependencies. Run:

```sh
node scripts/spend/server.mjs
```

By default it reads the management key from `~/.config/cliproxy-home/access.json`,
connects to the proxy on `127.0.0.1:8317`, stores SQLite under
`~/.config/cliproxy-home/spend/`, and serves its authenticated extension on
`127.0.0.1:8318/minillm/spend`. Vite forwards `/minillm/spend` to this service.
The extension requires the existing management key for every read and write; it has
no public CORS policy. Port 8318 is loopback-only. The production dashboard at `https://minillm.local:8444/management.html` routes
this path to the recorder through a dedicated Caddy instance. The single HTML
bundle alone does not install the recorder. See `../dashboard/README.md`.

Overrides for isolated tests / installations: `MINILLM_ACCESS_FILE`,
`MINILLM_SPEND_STATE`, `MINILLM_SPEND_UPSTREAM`, `MINILLM_SPEND_PORT`.

## Data and accounting

- Polls every five seconds, independently of browser tabs. Never calls inference,
  changes routing, refreshes provider credentials, or edits proxy settings.
- Queue recording requires `observability.usage.usage-statistics-enabled: true`.
  This setting hot-reloads; no proxy restart is necessary.
- Only canonical v2 token buckets are priced. Input, cache read, cache write, and
  total output (including reasoning once) are non-overlapping. Inconsistent or
  unclassified records remain visibly unpriced. Failure attempts with reported
  tokens are included; retries have different execution IDs.
- Explicit field allowlist removes keys, prompt/response bodies, source strings,
  headers, IP addresses, and raw session IDs. Stored metadata includes execution ID,
  timestamp, auth index, provider, model, counts and failure/accounting status.
- SQLite WAL, full synchronization, deduplication by execution ID, and a private
  metadata-only pending batch permit retries after database failures. There is
  still a loss window between the destructive upstream read and disk persistence.
- The upstream queue expires records after 60 seconds on this server. Downtime,
  another queue consumer, or an upstream restart can lose records. Long polling
  gaps and errors are shown, but this is best-effort accounting, not an invoice.
- Reports use half-open calendar months in the viewer's local timezone. Plan fees
  are explicitly entered per account and month, shared through SQLite. They do
  not automatically carry over, and duplicate credentials for one paid subscription
  must not receive duplicate fees. Usage outside the proxy is unavailable.
- Each account's model API-cost fraction multiplies that account's full monthly
  fee. Provider and overall totals sum those allocated dollars. No quota percentage
  is used. An unpriced model blocks that account's allocation. Accounts without
  recorded usage retain their fee as unallocated, not “unused plan value”.
- Published rate snapshot and source links live in `src/features/spend/rates.ts`.
  Standard global token rates are a comparison benchmark; not actual API charges.
  Long-context thresholds are per request; cache writes assume Claude's five-minute
  tier. Tools, storage, non-token media costs, fast/batch/geographic adjustments,
  and tax are excluded. Unknown model IDs are not guessed.

## Installed Mac mini service

GPT Image prices include separate published text/image input and cached-input
rates. CPA v8.0.30 combines the input modalities, so the estimate uses the image
rate for combined input/cache reads and the image-output rate for output. These
estimates participate in the usual account/provider/total subscription allocation.
The original recorded token counts are unchanged.

Private runtime copy: `~/.config/cliproxy-home/spend-service/{server,store}.mjs`.
LaunchAgent: `~/Library/LaunchAgents/io.offaxislabs.minillm-spend.plist`.
Starts at user login and survives closing the UI. To stop just this recorder:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.offaxislabs.minillm-spend.plist"
```

This does not stop the production proxy. Keep the database to preserve history.
The proxy config was backed up privately before enabling the single usage flag;
restore only that flag if desired, rather than overwriting later config edits.

## Validation

`bun run verify` includes Node subprocess tests for durable storage, deduplication,
secret stripping, authenticated HTTP reads/writes, and a fake upstream that asserts
all collector requests are GETs. Browser fixture checks cover the sidebar order,
$120/60% account example, provider/overall rollups, price editing, filters, empty and
unavailable states, responsive layout and themes. No fake usage is inserted into
the live database.

## Sol cache diagnostics (2026-11-03)

`cache_diagnostics` now stores one optional, allowlisted record alongside each
usage execution. It uses the existing single queue consumer; never launch a second
consumer for diagnostics. This change does not alter token counts, API estimates,
plan allocations or the inference process.

Collected fields: hashed session/parent IDs, trace ID, normalized inbound endpoint,
client family, account (joined from `events`), an already-hashed OAuth token version,
reasoning effort, node/fork/compaction flags and latency/TTFT. The client family is
inferred from User-Agent and can be `unknown`/`other`; it is not authoritative proof
of which harness ran. Raw User-Agent, IPs, session IDs, prompts, tool content,
headers, API keys and OAuth tokens are never persisted. Session hashes use the same
domain-separated SHA-256 for parents and children so relationships remain joinable.
Older records have no diagnostic row and are not retroactively inferred.

Read-only analysis:

```sh
node scripts/spend/cache-report.mjs \
  "$HOME/.config/cliproxy-home/spend/usage.sqlite" \
  2026-11-03T19:35:00Z gpt-6.1-sol
```

The report treats >=50K uncached tokens as a large-miss outlier and compares each
execution with the preceding successful execution in the same observed session.
It reports overlapping requests, account/model/effort/token changes, compaction
flags, and prompt-length changes. Flags are correlations and may overlap; they are
not proven causes. The first observation is explicitly not called a new session.
The report excludes failed/incomplete/zero-prompt executions from this comparison.

The queue does not expose the actual prompt-cache key, prompt-prefix fingerprints,
or per-item cache attribution. Similar prompt length does not prove an identical
prefix. If misses persist on the same account/model/effort, a subsequent targeted
request-metadata instrumentation step will be needed to distinguish prompt changes
from cache expiry/eviction. Do not enable broad body logging to guess this.

### Sol subscription cache-write accounting (2026-11-03)

The Codex subscription route must not be treated as evidence that Sol has no
cache writes. Three identical synthetic Responses requests returned 4,414 input
tokens each. They reported 0, 0, and 4,224 cached tokens, respectively, while all
three explicitly reported `cache_write_tokens: 0`, including attribution items.
The Responses translator passes these counters through; the parser already
subtracts a positive write counter when one is supplied. A direct request to
`chatgpt.com/backend-api/codex/responses` with `prompt_cache_options` returned 400,
`invalid_parameter`: that option is unsupported on this route.

#### Approved estimate: `sol-implicit-v1`

On 2026-11-03 the user explicitly chose estimated cache-write counts, clearly
identified, for API-equivalent spend. The earlier disclosure-only display is
superseded by the following numerical estimate.

For each successful, complete `codex` / `gpt-6.1-sol` execution with at least
1,024 prompt tokens, zero reported cache writes, and a consistent input sum:

```text
estimatedCacheWrite = upstream inclusive input minus reported cache reads
                   = events.input (already excludes reads and writes)
report.input       = events.input - estimatedCacheWrite
report.cacheWrite  = events.cacheWrite + estimatedCacheWrite
```

The assumption is that all non-cached input in an eligible request is written to
the implicit cache. This is an upper-bound allocation of that unresolved input,
not evidence that every token was physically written. The request payload and
exact cacheable boundary were not retained; a non-cacheable suffix can make the
estimate too high. It does not reconstruct a measured historical split or infer
writes from a later request's cache reads. The 1,024-token threshold and default
30-minute pricing follow the public API's implicit-cache benchmark; the
subscription endpoint does not expose the same cache controls.

Short requests, failed/incomplete executions, explicit positive write counters,
other models, API-key routes, and Claude accounting keep their original split.
This method deliberately applies only to the observed Sol subscription route.
A future upstream change that supplies reliable zero/nonzero write counters
requires retiring this fallback, not treating it as a permanent provider rule.

`events` is the immutable original ledger. The versioned SQLite view
`spend_accounting_v1` derives the estimated split before price-band, account,
model, or time aggregation. Both historical records and newly ingested records
use this view, without a destructive migration or duplicate event insertion.
Reports/timelines include `estimatedCacheWrite` (a subset of `cacheWrite`) and
`cacheWriteEstimateVersion: "sol-implicit-v1"`. Counts remain integers; the sum of
input + reads + writes + output is unchanged for every execution.

Writes are priced at the published 30-minute rate ($2.50/M for Sol; $5/M for
prompts over 272K under the API-equivalent benchmark). The estimate is part of
category/model/account/provider totals and per-plan cost-share allocations.
Charts and their three-hour forecasts use the same accounting view. API value
can increase; a plan's total allocated subscription fee does not increase.

The UI identifies the estimated input/write split and shows the original
counters in expanded details. CSV includes numeric effective categories and
costs plus `estimated_cache_write_tokens`, `cache_write_accounting`,
`reported_input_tokens`, and `reported_cache_write_tokens`. Original counts can
be reconstructed exactly by adding estimated writes back to input and subtracting
them from effective writes. Mixed measured/estimated aggregates retain the
estimated subset rather than marking the whole count as measured.

Rollback: restore the previous recorder and dashboard artifacts from the
production backup. The original `events` table is untouched; the extra view can
remain unused. No inference proxy restart is needed. Validation covers minimum
length, mixed request sizes in one price band, explicit writes, failures,
long-context pricing, unchanged Claude rows, raw-ledger preservation, repeated
reads, charts/forecasts, CSV provenance, and subscription allocation.

Official API schema and pricing distinguish ordinary input, reads, and writes:
<https://developers.openai.com/api/docs/guides/prompt-caching>.
The API schema alone does not establish the subscription endpoint's write counts.

Independent corroboration checked 2026-11-03:

- <https://github.com/openai/codex/issues/57545> remains open. It reports the same
  `gpt-6.1-sol` symptom with raw WebSocket evidence: 14,549 input, 6,912 cached,
  and zero writes, despite growing cached prefixes. This is a user bug report,
  not an OpenAI-confirmed diagnosis or fix.
- <https://github.com/router-for-me/CLIProxyAPI/issues/4170#issuecomment-4932318532>
  records the proxy maintainer's observation that OpenAI returns zero for this
  field.
- <https://github.com/router-for-me/CLIProxyAPI/issues/4262> describes a separate,
  older translator omission. The deployed v8.0.40 source already preserves
  positive write counts, so applying that old fix cannot supply the upstream
  zero values or backfill the missing historical split.

The upstream limitation remains. Never describe the estimated split as measured
Sol cache-write tokens. The original zero counters remain available for auditing.

### Subscription planning

`planning.mjs` stores validated subscription contract metadata in `subscription_terms`
and derives bounded quota/token calibration evidence from the existing database.
The authenticated `view=planning` extension exposes no credentials or prompt content.
Normal reports include optional `terms`; existing plan PUT requests remain valid,
and optional terms update atomically with the monthly-equivalent price. Annual
price conversion happens in the shared UI editor. See [the setup guide](../../docs/codedaptive-setup.md) for the
calibration/forecast assumptions and deployment procedure.

Tests include integer quota counters with unchanged reads, reset boundaries,
incomplete usage, mixed-model attribution, shared quotas, annual dates, transaction
rollback, and authenticated extension reads.
