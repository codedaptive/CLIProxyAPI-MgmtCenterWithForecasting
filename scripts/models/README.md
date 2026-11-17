# Launch-day model catalog supplement

`sync_catalog.py --output /absolute/path/models.json` fetches the current official
CLIProxyAPI model catalog and adds GPT-6.2 Astra and Sol for paid Codex accounts
until upstream publishes them. Existing upstream definitions always win. It does
not rename or alias older models. The models were verified with live Responses
requests and Anthropic Messages tool round trips on 2026-11-17.

Configure the proxy's `models.catalog` to the output path. This setting reloads
without restarting the server. Run the synchronizer every three hours using the
host's service manager; the proxy rereads the file on its own three-hour cadence.
The Codex client catalog stays on its official remote feed. This avoids freezing
other providers' catalogs while waiting for launch-day additions.

Network or validation failures preserve the last valid snapshot. To remove the
supplement after both IDs appear in all three upstream paid Codex sections, clear
`models.catalog` and remove the synchronizer service. Keep a private configuration
backup before changing the setting. No credentials are used by the synchronizer.

Tests: `python3 -m unittest discover -s tests -p model_catalog_test.py`.
