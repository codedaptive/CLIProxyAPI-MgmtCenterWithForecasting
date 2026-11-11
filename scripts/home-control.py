#!/opt/homebrew/bin/python3
"""Local controls for the MiniLLM proxy. Credentials never appear in command arguments."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib
import urllib.request

state = Path.home() / '.config/cliproxy-home'
keys = json.loads((state / 'access.json').read_text())
command = sys.argv[1] if len(sys.argv) > 1 else 'status'
base = 'http://127.0.0.1:8317'

def get(path, key):
    request = urllib.request.Request(base + path, headers={'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)

if command == 'copy-management-key':
    subprocess.run(['/usr/bin/pbcopy'], input=keys['management_key'].encode(), check=True)
    print('Management key copied to clipboard.')
elif command == 'open':
    subprocess.run(['/usr/bin/open', 'http://MiniLLM.local:8317/management.html'], check=True)
elif command == 'status':
    credentials = get('/v8/management/credentials', keys['management_key']).get('files', [])
    models = get('/v1/models', keys['client_key']).get('data', [])
    print(f'Server reachable. {len(credentials)} provider accounts; {len(models)} available models.')
    print('Dashboard: http://MiniLLM.local:8317/management.html')
elif command == 'activate-codex':
    config = Path.home() / '.codex/config.toml'
    raw = config.read_text()
    data = tomllib.loads(raw)
    model = data.get('model')
    models = {item['id'] for item in get('/v1/models', keys['client_key']).get('data', [])}
    if not model or model not in models:
        raise SystemExit('Codex default model is not available through the proxy yet. Connect the Codex account in Provider sign-in first, then check the model list.')
    head, separator, tail = raw.partition('\n[')
    if re.search(r'^model_provider\s*=', head, re.M):
        head = re.sub(r'^model_provider\s*=.*$', 'model_provider = "cliproxy_home"', head, flags=re.M)
    else:
        head = 'model_provider = "cliproxy_home"\n' + head
    updated = head + separator + tail
    assert tomllib.loads(updated)['model_provider'] == 'cliproxy_home'
    shutil.copy2(config, state / 'codex-config-before-activation.toml')
    (state / 'codex-config-before-activation.toml').chmod(0o600)
    temp = config.with_name('config.toml.cliproxy-new')
    with temp.open('x') as output:
        temp.chmod(config.stat().st_mode & 0o777)
        output.write(updated)
    temp.replace(config)
    print('Codex default now uses MiniLLM. Restart the desktop app when your current work is finished. Existing sessions may retain their original provider.')
else:
    raise SystemExit('Usage: cliproxy-home [status|open|copy-management-key|activate-codex]')
