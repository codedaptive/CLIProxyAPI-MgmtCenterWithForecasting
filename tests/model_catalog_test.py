import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'catalog', Path(__file__).parents[1] / 'scripts/models/sync_catalog.py'
)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class CatalogTests(unittest.TestCase):
    def fixture(self):
        return {name: [{'id': name + '-existing'}] for name in (
            'claude', 'gemini', 'codex-free', *catalog.PAID_CODEX
        )}

    def test_adds_only_paid_models_and_is_idempotent(self):
        original = self.fixture()
        result = catalog.supplement(original)
        self.assertEqual(result, catalog.supplement(result))
        self.assertEqual(result['codex-free'], original['codex-free'])
        self.assertEqual(len(original['codex-pro']), 1)
        for section in catalog.PAID_CODEX:
            self.assertEqual([m['id'] for m in result[section][1:]],
                             ['gpt-6.2-astra', 'gpt-6.2-sol'])

    def test_upstream_definition_and_future_models_win(self):
        original = self.fixture()
        published = {'id': 'gpt-6.2-sol', 'context_length': 999, 'new_field': True}
        original['codex-pro'].extend([published, {'id': 'future-model'}])
        result = catalog.supplement(original)
        self.assertIn(published, result['codex-pro'])
        self.assertIn({'id': 'future-model'}, result['codex-pro'])
        self.assertEqual(sum(m['id'] == 'gpt-6.2-sol' for m in result['codex-pro']), 1)

    def test_fetch_failure_preserves_existing_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'models.json'
            path.write_text(json.dumps(self.fixture()))
            before = path.read_bytes()
            with patch.object(catalog.urllib.request, 'urlopen', side_effect=OSError('offline')):
                with self.assertRaises(RuntimeError):
                    catalog.refresh(path)
            self.assertEqual(path.read_bytes(), before)

    def test_rejects_incomplete_catalog(self):
        for value in ({}, [], {'codex-pro': []}):
            with self.assertRaises(ValueError):
                catalog.supplement(value)


if __name__ == '__main__':
    unittest.main()
