# Dashboard hosting

Follow [the Codedaptive setup guide](../../docs/codedaptive-setup.md) to build and
serve the dashboard with the spend collector. `Caddyfile` is an environment-based
example; configure its address, artifact directory, state directory, and upstreams.

The single HTML bundle contains no credentials. The collector extension must be
served on the same origin at `/minillm/spend`; all other API routes go to the proxy.
The development server is independent of the production artifact.

For an HTML-only upgrade, back up the current `management.html` outside the public
root, then replace it atomically with `dist/index.html` on the same filesystem.
No core restart is needed. Roll back by restoring that artifact to the same path.

`redirect.html` is an optional example for an old entry point. Set its destination
to your dashboard before installing it; it preserves query strings and hash routes.
Do not change the coder API listener to deploy a dashboard.
