#!/usr/bin/env python3
"""Local bearer-token resolver for Codex desktop and CLI; stdout is consumed by Codex."""
import json
from pathlib import Path
print(json.loads((Path.home() / '.config/cliproxy-home/access.json').read_text())['client_key'])
