import json
import tempfile
import unittest
from pathlib import Path

from aidream.model_profiles import ModelProfileStore, load_fingerprint, resolve_effective_settings


class ModelProfileResolutionTests(unittest.TestCase):
    def test_precedence_merges_runtime_categories_separately(self):
        effective = resolve_effective_settings(
            {"backend_name": "global", "placement": {"gpu_layers": 10},
             "load": {"threads": 4}, "generation": {"temperature": 0.7}},
            {"backend_name": "model", "placement": {"device": "ROCm0"},
             "load": {"threads": 8, "context_size": 4096},
             "generation": {"temperature": 0.2, "top_p": 0.9}},
            {"backend_name": "chat", "runtime": {"placement": {"gpu_layers": 24},
             "load": {"context_size": 8192}}, "generation": {"system_prompt": "chat"}},
            {"backend": "request", "placement": {"tensor_split": "2,1"},
             "load": {"threads": 12}, "generation": {"temperature": 0.1}},
        )
        self.assertEqual(effective["backend_name"], "request")
        self.assertEqual(effective["placement"], {"gpu_layers": 24, "device": "ROCm0", "tensor_split": "2,1"})
        self.assertEqual(effective["load"], {"threads": 12, "context_size": 8192})
        self.assertEqual(effective["generation"], {"temperature": 0.1, "top_p": 0.9, "system_prompt": "chat"})

    def test_empty_legacy_chat_settings_are_empty_overrides(self):
        effective = resolve_effective_settings(
            {"placement": {"gpu_layers": 7}, "load": {"threads": 2}},
            chat_settings={},
        )
        self.assertEqual(effective["placement"], {"gpu_layers": 7})
        self.assertEqual(effective["load"], {"threads": 2})
        self.assertEqual(effective["generation"], {})

    def test_profile_persistence_create_filter_update_and_delete(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "profiles.json"
            store = ModelProfileStore(path)
            created = store.create({"name": "Qwen GPU", "model_id": "model-a",
                                    "backend_name": "llama.cpp", "placement": {"gpu_layers": 20},
                                    "load": {"threads": 8}, "generation": {"temperature": 0.2}})
            reread = ModelProfileStore(path)
            self.assertEqual(reread.get(created["id"]), created)
            self.assertEqual([item["id"] for item in reread.list_profiles("model-a")], [created["id"]])
            self.assertEqual(reread.list_profiles("other-model"), [])
            updated = reread.update(created["id"], {"load": {"context_size": 8192}})
            self.assertEqual(updated["load"], {"threads": 8, "context_size": 8192})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["version"], 1)
            reread.delete(created["id"])
            self.assertEqual(reread.list_profiles(), [])

    def test_load_fingerprint_excludes_generation_but_tracks_load_settings(self):
        base = {"runtime_id": "runtime-1", "backend_name": "llama.cpp", "model_id": "model-a",
                "placement": {"device": "Vulkan0", "gpu_layers": 18},
                "load": {"threads": 8, "context_size": 4096},
                "generation": {"temperature": 0.7}}
        unchanged = {**base, "generation": {"temperature": 0.1, "top_p": 0.8}}
        changed_load = {**base, "load": {"threads": 12, "context_size": 4096}}
        self.assertEqual(load_fingerprint(base), load_fingerprint(unchanged))
        self.assertNotEqual(load_fingerprint(base), load_fingerprint(changed_load))

    def test_profile_rejects_mlock_alias(self):
        with tempfile.TemporaryDirectory() as td:
            store = ModelProfileStore(Path(td) / "profiles.json")
            with self.assertRaisesRegex(ValueError, "unsupported load setting.*mlock"):
                store.create({"name": "Invalid", "load": {"mlock": True}})


if __name__ == "__main__":
    unittest.main()
