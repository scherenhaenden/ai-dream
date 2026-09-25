import json
import struct
import tempfile
import unittest
from pathlib import Path

from aidream.models import ModelCatalog, ModelRecord


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
            shown = first[0].display_info()
            self.assertEqual(shown["name"], "Tiny")
            self.assertEqual(shown["format"], "GGUF")
            self.assertEqual(shown["quantization"], "Unknown")
            self.assertEqual(shown["license"], "Not declared in GGUF metadata")
            self.assertTrue(shown["size_human"].endswith("B"))
            self.assertEqual(catalog.list_models(), first)
            self.assertEqual(json.loads((base / "cfg" / "model-sources.json").read_text()), [str(models.resolve())])

    def test_rejects_non_directory(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ValueError):
                ModelCatalog(Path(td) / "cfg").add_source(Path(td) / "missing")

    def test_display_info_uses_header_license_architecture_and_quantization(self):
        record = ModelRecord(
            "id", "/models/example.gguf", 2 * 1024 * 1024,
            metadata={
                "general.name": "Example",
                "general.architecture": "llama",
                "general.file_type": 15,
                "general.license": "apache-2.0",
                "llama.context_length": 8192,
                "general.source.url": "https://huggingface.co/example/model",
            },
        )
        info = record.display_info()
        self.assertEqual(info["quantization"], "Q4_K_M")
        self.assertEqual(info["size_human"], "2.0 MiB")
        self.assertEqual(info["license"], "apache-2.0")
        self.assertEqual(info["context_length"], 8192)
        self.assertEqual(info["source"], "https://huggingface.co/example/model")

    def test_quantization_filename_is_marked_as_hint(self):
        record = ModelRecord("id", "/models/qwen-Q5_K_M.gguf", 10)
        self.assertEqual(record.display_info()["quantization"], "Q5_K_M (filename)")


if __name__ == "__main__":
    unittest.main()
