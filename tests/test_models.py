import json
import struct
import tempfile
import unittest
from pathlib import Path

from aidream.models import ModelCatalog


class ModelCatalogTests(unittest.TestCase):
    def test_sources_persist_and_scan_deduplicates(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            models = base / "models"
            models.mkdir()
            model = models / "tiny.gguf"
            # Minimal valid GGUF v3 header with one identifying string field.
            key, value = b"general.name", b"Tiny"
            model.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + struct.pack("<Q", len(key)) + key + struct.pack("<I", 8) + struct.pack("<Q", len(value)) + value)
            catalog = ModelCatalog(base / "cfg")
            catalog.add_source(models)
            catalog.add_source(models / ".." / "models")
            self.assertEqual(len(catalog.list_sources()), 1)
            first = catalog.scan()
            self.assertEqual(len(first), 1)
            self.assertEqual(first[0].metadata["general.name"], "Tiny")
            self.assertEqual(first[0].size, model.stat().st_size)
            self.assertEqual(catalog.list_models(), first)
            self.assertEqual(json.loads((base / "cfg" / "model-sources.json").read_text()), [str(models.resolve())])

    def test_rejects_non_directory(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ValueError):
                ModelCatalog(Path(td) / "cfg").add_source(Path(td) / "missing")


if __name__ == "__main__":
    unittest.main()
