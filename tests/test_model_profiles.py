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

    def test_profile_orchestration_fields_round_trip(self):
        with tempfile.TemporaryDirectory() as td:
            store = ModelProfileStore(Path(td) / "profiles.json")
            created = store.create({
                "name": "Balanced chat",
                "model_id": "model-a",
                "purpose": ["text.chat", "code.review"],
                "companion_artifacts": ["ab12cd34ef56ab12cd34ef56", "local.clip-large-v1"],
                "profile_class": "hardware-bound",
                "hardware_signature": "hw_0123456789abcdef0123456789abcdef",
                "verification": {
                    "status": "verified",
                    "runtime_version": "llama.cpp 1.2.3",
                    "verified_at": "2026-09-30T10:20:30Z",
                    "hardware_signature": "hw_0123456789abcdef0123456789abcdef",
                },
            })
            restored = ModelProfileStore(Path(td) / "profiles.json").get(created["id"])
            self.assertEqual(restored["purpose"], ["text.chat", "code.review"])
            self.assertEqual(restored["companion_artifacts"], ["ab12cd34ef56ab12cd34ef56", "local.clip-large-v1"])
            self.assertEqual(restored["profile_class"], "hardware-bound")
            self.assertEqual(restored["hardware_signature"], "hw_0123456789abcdef0123456789abcdef")
            self.assertEqual(restored["verification"]["status"], "verified")
            self.assertEqual(restored["verification"]["verified_at"], "2026-09-30T10:20:30Z")

    def test_old_profile_store_is_lazily_migrated_with_additive_defaults(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "profiles.json"
            legacy_profile = {
                "id": "a" * 32,
                "model_id": "model-old",
                "name": "Old profile",
                "placement": {"gpu_layers": 12},
                "load": {"threads": 4},
                "generation": {"temperature": 0.7},
                "created_at": "2026-09-01T00:00:00+00:00",
                "updated_at": "2026-09-01T00:00:00+00:00",
            }
            path.write_text(json.dumps({"version": 1, "profiles": [legacy_profile]}), encoding="utf-8")

            store = ModelProfileStore(path)
            migrated = store.get("a" * 32)
            self.assertEqual(migrated["purpose"], [])
            self.assertEqual(migrated["companion_artifacts"], [])
            self.assertIsNone(migrated["hardware_signature"])
            self.assertEqual(migrated["profile_class"], "user")
            self.assertIsNone(migrated["verification"])

            store.update("a" * 32, {"profile_class": "balanced"})
            persisted = json.loads(path.read_text(encoding="utf-8"))["profiles"][0]
            self.assertEqual(persisted["purpose"], [])
            self.assertEqual(persisted["companion_artifacts"], [])
            self.assertEqual(persisted["profile_class"], "balanced")
            self.assertIn("verification", persisted)
            self.assertNotIn("verification_summary", persisted)

    def test_verification_summary_alias_normalizes_to_documented_verification_field(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "profiles.json"
            store = ModelProfileStore(path)
            alias_value = {
                "status": "verified",
                "runtime_version": "llama.cpp 1.2.3",
                "verified_at": "2026-09-30T10:20:30Z",
            }
            created = store.create({"name": "Alias input", "verification_summary": alias_value})
            self.assertEqual(created["verification"], alias_value)
            self.assertNotIn("verification_summary", created)
            updated = store.update(created["id"], {"verification_summary": {"status": "failed"}})
            self.assertEqual(updated["verification"], {"status": "failed"})
            self.assertNotIn("verification_summary", updated)
            stored = json.loads(path.read_text(encoding="utf-8"))["profiles"][0]
            self.assertIn("verification", stored)
            self.assertNotIn("verification_summary", stored)
            with self.assertRaisesRegex(ValueError, "not both"):
                store.create({"name": "Ambiguous", "verification": None, "verification_summary": None})
            with self.assertRaisesRegex(ValueError, "not both"):
                store.update(created["id"], {"verification": None, "verification_summary": None})

    def test_orchestration_profile_fields_have_bounded_validation(self):
        with tempfile.TemporaryDirectory() as td:
            store = ModelProfileStore(Path(td) / "profiles.json")
            invalid_profiles = (
                {"purpose": ["not-namespaced"]},
                {"purpose": ["text.chat", "text.chat"]},
                {"purpose": [f"text.{index}" for index in range(33)]},
                {"companion_artifacts": ["artifact"] * 33},
                {"companion_artifacts": ["duplicate", "duplicate"]},
                {"companion_artifacts": ["/private/model.gguf"]},
                {"companion_artifacts": ["x" * 129]},
                {"profile_class": "invented"},
                {"profile_class": "safe"},
                {"hardware_signature": "/etc/machine-id"},
                {"profile_class": "hardware-bound"},
                {"profile_class": "verified"},
                {"verification": {"status": "invented"}},
                {"verification": {"status": "verified"}},
                {"verification": {"status": "failed", "unexpected": True}},
                {"verification": {"status": "failed", "verified_at": "not-a-time"}},
                {"verification": {"status": "failed", "details": "x" * 513}},
                {"verification": None, "verification_summary": None},
            )
            for extra in invalid_profiles:
                with self.subTest(extra=extra):
                    with self.assertRaises(ValueError):
                        store.create({"name": "Invalid", **extra})

    def test_safe_default_profile_class_uses_documented_label(self):
        with tempfile.TemporaryDirectory() as td:
            store = ModelProfileStore(Path(td) / "profiles.json")
            profile = store.create({"name": "Conservative", "profile_class": "safe/default"})
            self.assertEqual(profile["profile_class"], "safe/default")


if __name__ == "__main__":
    unittest.main()
