<div align="center">

# CLIProxyAPI Management Center with Forecasting

A fork of [router-for-me/Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center), optimized for use with
**[CodeTeam - CE](https://github.com/codedaptive/codeteam-ce)**.

### See your traffic, understand your spend, and plan your subscriptions.

**What ran. What it cost. What capacity comes next.**

[![Backend: v8](https://img.shields.io/badge/backend-CLIProxyAPI%20v8-blue)](https://github.com/codedaptive/CLIProxyAPI)
[![Single-file UI](https://img.shields.io/badge/UI-single%20HTML-0F766E)](#start-here)
[![License: MIT](https://img.shields.io/badge/license-MIT-success)](LICENSE)

[Start here](#start-here) · [Works with](#works-with) · [Documentation](#documentation) · [Issues](https://github.com/codedaptive/CLIProxyAPI-MgmtCenterWithForecasting/issues)

</div>

CodeTeam - CE is optional: this fork also works with other compatible clients and
agent workflows.

A model gateway can tell you that a request succeeded. Running a team of agents
raises more questions: which accounts are carrying the work, how much quota is
left, which models consume the subscription, and how many plans will cover the
next month's workload?

Codedaptive's management center brings those answers alongside the normal proxy
controls. It extends [CLI Proxy API Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)
with **Overview**, **Spend Analysis**, **Plans**, and **Subscription Planning**.
The browser shows the reports; a separate Node.js/SQLite collector keeps recording
usage and quota observations when the browser is closed.

## What it does

| Page | What you get |
| --- | --- |
| **Overview** | Request throughput, model/account routing, active account quota rows, and quota history with a forecast based on the last three hours of burn. |
| **Spend Analysis** | Input, output, cache-read, and cache-write breakdowns; API-equivalent spend; subscription allocation by model, account, and provider; usage forecasts and data export. |
| **Plans** | Published plan choices, account assignments, price and billing cadence, annual expiry, tax settings, and remembered cost-visibility controls. |
| **Subscription Planning** | Click **Calculate** to compare 5-hour, 7-day, and 30-day historical run rates against observed quota capacity and estimate next month's plan requirements. |
| **Proxy management** | Providers, OAuth/auth files, model aliases, configuration, logs, plugins, and server status from the upstream UI. |

Planning accounts for annual commitments and expiry, with preferences for personal
plans and fewer accounts. Capacity is learned from recorded token usage and quota
changes. New installations build that history as they run.

### How subscription costs are allocated

For each account, the model's share of estimated API cost determines its share of
the subscription fee. If Opus accounts for 60% of an account's API-equivalent spend,
it receives 60% of that account's subscription cost. A $200 plan therefore allocates
$120 to Opus. Account allocations are then summed into provider and overall totals.

Published token rates provide the comparison benchmark. Where an upstream omits a
cache-write counter, the supported estimate is identified separately from measured
counts. The [recorder reference](scripts/spend/README.md) explains the accounting.

## Works with

The three CLIProxy repositories form one stack. Each has a separate job and can be
updated independently:

| Project | What it does |
| --- | --- |
| **[CLIProxyAPI](https://github.com/codedaptive/CLIProxyAPI)** | Serves model APIs, connects provider accounts, and loads native plugins. |
| **[CLIProxyAPI-QuotaRouter](https://github.com/codedaptive/CLIProxyAPI-QuotaRouter)** | Selects accounts by quota/reset policy, keeps desktop sessions attached, and routes model/effort roles. |
| **[CLIProxyAPI-MgmtCenterWithForecasting](https://github.com/codedaptive/CLIProxyAPI-MgmtCenterWithForecasting)** | Manages the proxy and adds usage history, spend analysis, quota forecasts, and subscription planning. |

These Codedaptive projects complement the stack on the agent side:

- **[CodeTeam - CE](https://github.com/codedaptive/codeteam-ce)** runs a coordinated
  team of coding agents. Its agents can use the proxy for model access and the
  router's role names for task-specific model preferences.
- **[MOOTx01 CE](https://github.com/codedaptive/mootx01-ce)** gives agents persistent
  memory across sessions, models, and machines.
- **[CodeGraph Hub](https://github.com/codedaptive/codegraph-hub)** supplies a shared
  code knowledge graph for finding symbols, callers, and change impact.

MOOTx01 and CodeGraph connect to the agents through their own integrations; they
are optional and are not installed by the proxy.

## Prerequisites

- **CLIProxyAPI v8**, with **v8.0.67** as this fork's integration baseline, and a
  management key.
- **Node.js 24+** and **Bun 1.4.3** to build and run the reporting stack.
- A supported quota router for historical quota observations and capacity planning.
- Caddy or an equivalent reverse proxy to serve the dashboard and collector under
  the same authenticated management origin.

The UI uses `/v8/management`. Plugin resources and custom reporting extensions keep
their backend-declared paths. The management key signs into the UI; inference
client keys authorize model requests.

## Start here

Follow the **[Codedaptive setup guide](docs/codedaptive-setup.md)** for the complete
installation, including private configuration, the collector, HTTPS, and rollback.
Build the dashboard with:

```sh
git clone https://github.com/codedaptive/CLIProxyAPI-MgmtCenterWithForecasting.git
cd CLIProxyAPI-MgmtCenterWithForecasting
bun install --frozen-lockfile
bun run build
```

The output is **`dist/index.html`**, with JavaScript, CSS, and bundled assets
inlined. Serve it as `management.html` using the setup guide and
[Caddy example](scripts/dashboard/Caddyfile).

The full reporting setup has three parts:

1. **Proxy core** serves inference and management requests.
2. **One collector per proxy** records usage and quota history in SQLite.
3. **Dashboard and reverse proxy** expose the UI and its authenticated reporting API.

Installing the HTML alone does not start the collector. The usage queue is consumed
on read, so two collectors must not compete for the same proxy's records.

## What is in this repository

| Path | Purpose |
| --- | --- |
| `src/features/overview/` | Throughput, account quotas, and routing overview |
| `src/features/spend/` | Token pricing, subscription allocation, and spend charts |
| `src/features/planning/` | Historical capacity calibration and plan selection |
| `src/features/` | Provider, quota, configuration, log, and plugin UI |
| `src/services/api/` | Authenticated API clients and data normalization |
| `scripts/spend/` | Node.js collector, SQLite storage, and reporting endpoints |
| `scripts/dashboard/` | Reverse-proxy example and deployment helpers |
| `tests/` | Logic, rendering, API contract, and collector tests |
| `docs/codedaptive-setup.md` | Full-stack installation and maintenance |

## Documentation

- [Install, configure, and update](docs/codedaptive-setup.md)
- [Usage recorder and accounting](scripts/spend/README.md)
- [Caddy configuration](scripts/dashboard/Caddyfile)
- [Account routing and model/effort roles](https://github.com/codedaptive/CLIProxyAPI-QuotaRouter)
- [Core v8 Management API](https://github.com/codedaptive/CLIProxyAPI/blob/main/docs/management-api-v8.md)
- [Upstream UI reference](README_UPSTREAM.md) · [Upstream 简体中文](README_CN.md)

## Development and tests

```sh
bun install --frozen-lockfile
bun run dev       # Vite preview, normally http://localhost:5173
bun run verify    # Tests, lint, TypeScript, and production build
```

Use `MINILLM_PREVIEW_API` and `MINILLM_PREVIEW_SPEND` to point development at an
isolated core and collector. See the setup guide before connecting a development
instance to an existing server.

The frontend uses React, TypeScript, Vite, Zustand, and SCSS Modules. Tests include
pure logic, static rendering, and collector subprocess checks. Repository
conventions are in [AGENTS.md](AGENTS.md).

## Releases and updates

The upstream UI baseline is **v1.27.4**. Build this fork for the Codedaptive pages;
upstream dashboard downloads do not contain them. Check
[Codedaptive releases](https://github.com/codedaptive/CLIProxyAPI-MgmtCenterWithForecasting/releases)
for published fork artifacts.

Separately hosted HTML can be replaced atomically without restarting the inference
server. Collector changes require their own restart. Keep the collector's database
and private credentials outside Git, and back them up before an update. Native
router and core upgrades are separate operations.

## Contributing and support

[Open an issue](https://github.com/codedaptive/CLIProxyAPI-MgmtCenterWithForecasting/issues)
with UI/core versions, the affected page, reproduction steps, and redacted
screenshots or sample records. For accounting issues, include the model and token
categories involved. Pull requests should include relevant tests and screenshots
for visual changes.

Treat the management key as a secret. The UI's remember-password storage uses
reversible obfuscation, not encryption. Keep management access restricted to your
intended users and do not include credentials or private usage exports in reports.

## License and upstream credit

[MIT](LICENSE). Based on
[router-for-me/Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center).
Original notices and the [upstream README](README_UPSTREAM.md) are retained.
Codedaptive maintains the reporting, forecasting, and planning additions.
