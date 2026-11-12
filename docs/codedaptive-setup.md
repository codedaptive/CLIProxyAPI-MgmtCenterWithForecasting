# Codedaptive setup and maintenance

## Components

| Repository / component | Purpose |
| --- | --- |
| `codedaptive/CLIProxyAPI` | Proxy core; upstream v8.0.67 plus auto-mode regression coverage |
| `codedaptive/CLIProxyAPI-MgmtCenterWithForecasting` | This dashboard, spend collector, and subscription planner |
| `codedaptive/CLIProxyAPI-QuotaRouter` | Optional quota routing, desktop affinity, roles, and weekly reserve |

The dashboard builds to one `dist/index.html`. Caddy serves that as
`management.html`, forwards `/minillm/spend` to the collector, and forwards other
API requests to the core. Hash routes remain client-side. Core API paths use v8;
plugin-declared paths are preserved.

## Build

Use Node.js 24+ and **Bun 1.4.3**. From this repository:

```sh
bun install --frozen-lockfile
bun run verify
```

`bun run dev` starts a loopback development preview. Core management writes are
blocked there; the allowlisted Claude profile/usage reads use POST envelopes.
Spend settings can still be written to the configured collector. For development,
point both services at an isolated instance using `MINILLM_PREVIEW_API` and
`MINILLM_PREVIEW_SPEND`. Do not start a second collector against production.

## Core and collector

Configure the proxy from its `config.example.yaml`; use your own client and
management keys. Enable usage recording in the v8 configuration:

```yaml
observability:
  usage:
    usage-statistics-enabled: true
```

Create a private access file outside the repository. Its `management_key` must be
the plaintext management key accepted by your proxy (not the stored bcrypt hash).
The optional client launchers also use `client_key`:

```json
{"management_key":"REPLACE_WITH_YOUR_MANAGEMENT_KEY","client_key":"REPLACE_WITH_YOUR_CLIENT_KEY"}
```

Restrict the directory to mode 700 and the file to mode 600. Then run:

```sh
MINILLM_ACCESS_FILE=/absolute/private/access.json \
MINILLM_SPEND_STATE=/absolute/private/spend \
MINILLM_SPEND_UPSTREAM=http://127.0.0.1:8317 \
MINILLM_SPEND_PORT=8318 \
node scripts/spend/server.mjs
```

The collector binds to loopback, requires the management key on every endpoint,
and records metadata in SQLite. It polls independently of browser tabs. Run
**one collector per proxy**: the upstream usage queue is destructive. History
starts at collection; never point a test collector at the production queue.
Keep the whole `scripts/spend` directory together when installing the service.
Use your OS service manager to run it continuously.

For quota history, enable one supported quota router. The collector reads its
cached `/status` and `/accounts` data; it does not spend tokens to measure quota.
See [the recorder documentation](../scripts/spend/README.md) for accounting,
cache-write estimation, and data retention details.

## Serve the dashboard

Install the built HTML under a private deployment directory as `management.html`.
Use [the Caddy example](../scripts/dashboard/Caddyfile), setting:

- `MINILLM_DASHBOARD_ADDRESS`: e.g. `https://proxy.local:8444`.
- `MINILLM_DASHBOARD_ROOT`: absolute directory containing `management.html`.
- `MINILLM_CADDY_STORAGE`: absolute persistent Caddy state directory.
- `MINILLM_PROXY_UPSTREAM`: core address, default `127.0.0.1:8317`.
- `MINILLM_SPEND_UPSTREAM_ADDRESS`: collector address, default `127.0.0.1:8318`.

The example uses Caddy's local CA; install its public root certificate on clients.
Do not distribute the CA private key. For a public hostname, adapt TLS to your
certificate provisioning. Keep management access restricted to your intended users.
If managing the core from a non-loopback address, its management access policy
must explicitly allow that address; keep authentication enabled.

The core's built-in HTML hosting alone does not route the collector extension.
Keep the custom dashboard separately hosted, and disable the core's panel auto-update
if it would overwrite your custom entry point. Open the dashboard, enter its base
URL and your management key, and add provider credentials through the normal UI.
The Dashboard client setup commands use that connection's URL and placeholder keys.

## Plans and planning

In **Plans**, fetch published plan options, assign each account a plan, and record
billing cadence and renewal date. Enter your applicable tax rate; the browser
remembers the last value. API/plan cost visibility is also remembered per browser.

Spend Analysis estimates API-equivalent cost from input, output, cache-read, and
cache-write counts. Each account's model share of that cost allocates its subscription
fee. Sol's estimated cache-write split is identified separately from measured counts.

Subscription Planning runs when you press **Calculate**. It calibrates model quota
consumption from historical usage and quota changes, then compares the observed
5-hour, 7-day, and 30-day run rates to plan capacity. Annual commitments, expiry,
individual-plan preference, and account-count preference participate in selection.
New installations need usage and quota observations before meaningful capacity can
be inferred. The collector continues gathering those observations without the page open.

## Updates and rollback

1. Fetch upstream into a development branch and merge a reviewed release.
2. Preserve fork features, run `bun run verify`, and check Overview, Spend, Plans,
   and Planning in an isolated browser preview.
3. Back up the deployed HTML, collector sources, and a consistent SQLite snapshot
   using SQLite's backup API. Keep credentials, databases, logs, and private
   deployment journals out of Git.
4. Replace HTML atomically on the same filesystem. This does not restart inference.
5. Collector source changes need a collector restart. Keep it brief because the
   upstream queue has finite retention. Never run old and new collectors together.
6. A **core binary upgrade is separate** and requires a controlled service restart;
   do not promise uninterrupted in-flight requests without a tested drain procedure.

Rollback HTML by atomically restoring the old artifact at the same path. Restore
collector code separately; preserve its database unless rolling back a specifically
incompatible migration. Do not overwrite unrelated live configuration changes.

No tagged Codedaptive binary release is implied by a source push. Build from the
reviewed commit or use explicitly published fork release assets.

## Integration checks — November 11, 2026

- Dashboard: 2,161 Bun tests pass; ESLint, TypeScript, and single-file Vite build pass.
- Core: full `go test ./...` and `go build ./cmd/server` pass on macOS arm64.
- Router: Go race tests and vet, 35 web tests, rebuilt embedded UI, and native build pass.
- Router loads into checksum-verified upstream v8.0.67 with desktop policy and reserve
  enabled. Mock-provider tests cover role fallback, recovery, effort, and streaming.
- Browser: an isolated v8 core and empty collector were used to verify login,
  Overview, Spend Analysis, Plans, and click-to-calculate Planning. Cost visibility
  persists across reload and re-login. No production usage queue was consumed.
- Other OS/architecture binaries require their release CI checks; no new production
  core, collector, or dashboard was deployed as part of this source cleanup.
