# Production MiniLLM dashboard

Production UI: https://minillm.local:8444/management.html

The old HTTP 8317 and HTTPS 8443 `/management.html` pages redirect here, preserving
query and hash routing. The existing coder API listeners on 8317 and 8443 remain
unchanged. No proxy or inference gateway restart/reload is needed to deploy the UI.

A dedicated Caddy process serves the single-file production build and forwards
`/minillm/spend` to the local recorder (8318), with all other API/plugin requests
forwarded to CLIProxyAPI (8317). It uses the existing MiniLLM CA and shared Caddy
certificate storage, so Macs which already trust that CA can use this dashboard.
The development preview on 5174 is independent of production.

## Runtime paths

- Artifact: `~/.config/cliproxy-home/dashboard-public/management.html`
- Configuration: `~/.config/cliproxy-home/dashboard.Caddyfile`
- LaunchAgent: `~/Library/LaunchAgents/io.offaxislabs.minillm-dashboard.plist`
- Logs: `~/.config/cliproxy-home/dashboard-{stdout,stderr}.log`
- Old entry point: `/opt/homebrew/etc/static/management.html` (redirect only)
- Pre-deployment backup directory:
  `~/.config/cliproxy-home/backups/dashboard-2026-10-20T02-20-27-053Z/`

The LaunchAgent supplies `MINILLM_DASHBOARD_ROOT` and `MINILLM_CADDY_STORAGE` and
starts at user login, matching the other home services. There is no dependency on
Vite or an open terminal. The dashboard auto-updater was already disabled in CPA
and remains disabled, so upstream releases cannot overwrite the redirect.

## Subsequent UI releases

Run `bun run verify`, then atomically install the resulting `dist/index.html` at
the artifact path above. Back up the previous artifact outside the public directory
first. Keep both temp and target on the same filesystem for the rename. No process
restart or Caddy reload is needed for an HTML-only release. Do not install the full
bundle over the redirect on port 8317: the spend endpoint belongs to port 8444.

## Rollback

Atomically restore the backed-up `management.html` to
`/opt/homebrew/etc/static/management.html`. This returns old bookmarks to the old UI.
The dedicated dashboard can be left running or stopped independently:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.offaxislabs.minillm-dashboard.plist"
```

Do not stop the original Caddy service or CLIProxyAPI. Do not restore the backed-up
proxy config as part of a dashboard rollback: the deployment did not change it.
The spend recorder and its saved data can continue running independently.
