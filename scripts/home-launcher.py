#!/usr/bin/env python3
"""Launch installed clients through MiniLLM without changing their defaults."""
import json
import os
from pathlib import Path
import shutil
import sys

state = Path.home() / '.config/cliproxy-home'
name = Path(sys.argv[0]).name
keys = json.loads((state / 'access.json').read_text())
env = os.environ.copy()
base = 'http://127.0.0.1:8317'

if name == 'claude-home':
    program = shutil.which('claude')
    args = ['--settings', str(state / 'claude-settings.json')]
    env['ANTHROPIC_BASE_URL'] = base
    env['ANTHROPIC_AUTH_TOKEN'] = keys['client_key']
    env.pop('ANTHROPIC_API_KEY', None)
elif name == 'codex-home':
    program = shutil.which('codex')
    args = ['-c', 'model_provider="cliproxy_home"']
else:
    raise SystemExit('Use the claude-home or codex-home launcher.')
if not program:
    raise SystemExit(f'{name.removesuffix("-home")} is not installed or is not on PATH.')
os.execve(program, [program, *args, *sys.argv[1:]], env)
