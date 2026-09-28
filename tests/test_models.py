import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_source_details_report_stable_id_access_and_model_totals(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            root = base / "models"
            nested = root / "nested"
            nested.mkdir(parents=True)
            (root / "one.GGUF").write_bytes(b"123")
            (nested / "two.gguf").write_bytes(b"12345")
            (root / "ignore.bin").write_bytes(b"ignored")
            catalog = ModelCatalog(base / "cfg")
            catalog.add_source(root)
            first = catalog.list_source_details()[0]
            again = catalog.list_source_details()[0]
            self.assertEqual(first["id"], again["id"])
            self.assertEqual(first["path"], str(root.resolve()))
            self.assertEqual(first["canonical_path"], str(root.resolve()))
            self.assertTrue(first["exists"])
            self.assertTrue(first["readable"])
            self.assertFalse(first["managed"])
            self.assertEqual(first["model_count"], 2)
            self.assertEqual(first["total_bytes"], 8)

    def test_source_details_deduplicate_paths_and_mark_managed_directory(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            managed = base / "xdg" / "ai-dream" / "models"
            managed.mkdir(parents=True)
            model = managed / "model.gguf"
            model.write_bytes(b"gguf")
            catalog = ModelCatalog(base / "cfg")
            with patch.dict("os.environ", {"XDG_DATA_HOME": str(base / "xdg")}):
                catalog.add_source(managed)
                details = catalog.list_source_details()
            self.assertEqual(len(details), 1)
            self.assertTrue(details[0]["managed"])
            self.assertEqual(details[0]["model_count"], 1)

    def test_remove_source_unregisters_only_and_rejects_unknown_id(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            root = base / "models"
            root.mkdir()
            model = root / "keep.gguf"
            model.write_bytes(b"model data")
            catalog = ModelCatalog(base / "cfg")
            catalog.add_source(root)
            source_id = catalog.list_source_details()[0]["id"]
            catalog.remove_source(source_id)
            self.assertEqual(catalog.list_sources(), [])
            self.assertTrue(model.is_file())
            with self.assertRaises(KeyError):
                catalog.remove_source(source_id)
            with self.assertRaises(ValueError):
                catalog.remove_source("../invalid")

    def test_source_details_keep_missing_sources_removable(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            missing = base / "missing"
            catalog = ModelCatalog(base / "cfg")
            catalog.sources_file.parent.mkdir(parents=True)
            catalog.sources_file.write_text(json.dumps([str(missing)]), encoding="utf-8")
            details = catalog.list_source_details()
            self.assertEqual(len(details), 1)
            self.assertFalse(details[0]["exists"])
            self.assertFalse(details[0]["readable"])
            self.assertEqual(details[0]["model_count"], 0)
            catalog.remove_source(details[0]["id"])
            self.assertEqual(catalog.list_sources(), [])


if __name__ == "__main__":
    unittest.main()
