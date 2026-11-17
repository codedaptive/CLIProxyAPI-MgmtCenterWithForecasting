#!/usr/bin/env python3
"""Refresh upstream's catalog, supplementing launch-day models until upstream catches up."""

import argparse
import copy
import json
import os
from pathlib import Path
import tempfile
import urllib.request

SOURCES = (
    'https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json',
    'https://models.router-for.me/models.json',
)
PAID_CODEX = ('codex-pro', 'codex-plus', 'codex-team')
MAX_BYTES = 8 * 1024 * 1024


def supplement(catalog):
    """Retain all upstream entries, and let upstream definitions win once published."""
    if not isinstance(catalog, dict):
        raise ValueError('Expected catalog object')
    for section in ('claude', 'gemini', *PAID_CODEX):
        models = catalog.get(section)
        if not isinstance(models, list) or not models:
            raise ValueError(f'Missing or empty section: {section}')
        if any(not isinstance(m, dict) or not isinstance(m.get('id'), str) for m in models):
            raise ValueError(f'Invalid model in section: {section}')
    result = copy.deepcopy(catalog)
    for section in PAID_CODEX:
        ids = {m['id'] for m in result[section]}
        for family in ('astra', 'sol'):
            model_id = f'gpt-6.2-{family}'
            if model_id in ids:
                continue
            # https://developers.openai.com/api/docs/models/gpt-6.2-{astra,sol}
            # Verified 2026-11-17. No aliases: requests use these exact upstream IDs.
            result[section].append({
                'id': model_id,
                'object': 'model',
                'created': 1794873600,
                'owned_by': 'openai',
                'type': 'openai',
                'display_name': f'GPT 6.2 {family.title()}',
                'version': 'gpt-6.2',
                'context_length': 1050000,
                'max_completion_tokens': 128000,
                'supported_parameters': ['tools'],
                'thinking': {'levels': ['low', 'medium', 'high', 'xhigh', 'max']},
                'supportedInputModalities': ['text', 'image'],
                'supportedOutputModalities': ['text'],
            })
    return result


def refresh(destination):
    errors = []
    for source in SOURCES:
        try:
            with urllib.request.urlopen(source, timeout=30) as response:
                data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError('Catalog exceeds size limit')
            catalog = supplement(json.loads(data))
            break
        except (OSError, ValueError) as error:
            errors.append(f'{source}: {error}')
    else:
        raise RuntimeError('; '.join(errors))

    destination = Path(destination)
    payload = json.dumps(catalog, indent=2) + '\n'
    if destination.exists() and destination.read_text() == payload:
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Publish only complete validated snapshots. Fetch failure leaves the old file intact.
    with tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
    try:
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    print('Catalog updated' if refresh(args.output) else 'Catalog unchanged')
