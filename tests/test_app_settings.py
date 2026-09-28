import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aidream.app_settings import AppSettingsStore, default_settings


class AppSettingsTests(unittest.TestCase):
    def test_defaults_and_xdg_paths(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": str(root / "cfg"),
                                         "XDG_DATA_HOME": str(root / "data")}):
                settings = AppSettingsStore(root / "settings.json").get()
            self.assertEqual(settings["runtime_defaults"], {"placement": {}, "load": {}})
            self.assertEqual(settings["default_profile_behavior"], "model")
            self.assertFalse(settings["keep_last_model_loaded"])
            self.assertEqual(settings["config_dir"], str(root / "cfg" / "ai-dream"))
            self.assertEqual(settings["data_dir"], str(root / "data" / "ai-dream"))
            self.assertEqual(settings["managed_models_dir"], str(root / "data" / "ai-dream" / "models"))

    def test_default_store_paths_use_xdg_and_ignore_relative_xdg_values(self):
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            with patch("pathlib.Path.home", return_value=home), patch.dict(
                    os.environ, {"XDG_CONFIG_HOME": "relative", "XDG_DATA_HOME": "relative"}):
                settings = default_settings()
            self.assertEqual(settings["config_dir"], str(home / ".config" / "ai-dream"))
            self.assertEqual(settings["data_dir"], str(home / ".local" / "share" / "ai-dream"))

    def test_patch_persists_versioned_settings_and_merges_nested_defaults(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "cfg" / "app-settings.json"
            store = AppSettingsStore(path)
            store.patch({"runtime_defaults": {"backend_name": "llama.cpp",
                          "placement": {"device": "ROCm0", "gpu_layers": 24},
                          "load": {"threads": 8}}, "keep_last_model_loaded": True})
            store.patch({"runtime_defaults": {"placement": {"gpu_layers": 30},
                          "load": {"context_size": 8192}}, "default_profile_behavior": "global"})
            fresh = AppSettingsStore(path).get()
            self.assertEqual(fresh["runtime_defaults"], {
                "backend_name": "llama.cpp", "placement": {"device": "ROCm0", "gpu_layers": 30},
                "load": {"threads": 8, "context_size": 8192}})
            self.assertTrue(fresh["keep_last_model_loaded"])
            self.assertEqual(fresh["default_profile_behavior"], "global")
            document = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(document["version"], 1)
            self.assertNotIn("config_dir", document["settings"])

    def test_read_only_paths_are_rejected_without_persisting(self):
        with tempfile.TemporaryDirectory() as td:
            store = AppSettingsStore(Path(td) / "settings.json")
            for field in ("config_dir", "data_dir", "managed_models_dir"):
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, "read-only"):
                    store.patch({field: "/tmp/elsewhere"})
            self.assertFalse(store.path.exists())

    def test_unknown_fields_and_invalid_types_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            store = AppSettingsStore(Path(td) / "settings.json")
            invalid = [
                {"unexpected": True},
                {"default_profile_behavior": "automatic"},
                {"keep_last_model_loaded": 1},
                {"runtime_defaults": {"placement": {"made_up": 3}}},
                {"runtime_defaults": {"load": {"threads": True}}},
                {"runtime_defaults": {"load": {"context_size": 0}}},
                {"runtime_defaults": {"backend_name": 5}},
                {"runtime_defaults": []},
            ]
            for changes in invalid:
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    store.patch(changes)
            self.assertFalse(store.path.exists())

    def test_invalid_versioned_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "settings.json"
            path.write_text('{"version":2,"settings":{}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Unsupported"):
                AppSettingsStore(path).get()


if __name__ == "__main__":
    unittest.main()
