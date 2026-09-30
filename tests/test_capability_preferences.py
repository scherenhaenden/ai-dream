from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from aidream.capabilities.preferences import (
    CapabilityPreferenceStore,
    default_capability_preferences_path,
)


class CapabilityPreferenceStoreTests(unittest.TestCase):
    def test_default_path_uses_absolute_xdg_config_home(self):
        with tempfile.TemporaryDirectory() as td:
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": td}):
                self.assertEqual(
                    default_capability_preferences_path(),
                    Path(td) / "ai-dream" / "capability-preferences.json",
                )

    def test_get_returns_defaults_and_detached_values(self):
        with tempfile.TemporaryDirectory() as td:
            store = CapabilityPreferenceStore(Path(td) / "preferences.json")
            expected = {
                "capability_preferences": {},
                "selection_defaults": {
                    "mode": "auto",
                    "prefer_verified": True,
                    "prefer_loaded": True,
                    "resource_headroom_percent": 10,
                    "eviction_policy": "lru",
                    "assisted_planner_enabled": False,
                },
            }
            first = store.get()
            self.assertEqual(first, expected)
            first["selection_defaults"]["mode"] = "manual"
            first["capability_preferences"]["text.chat"] = {"model_id": "model-a"}
            self.assertEqual(store.get(), expected)

    def test_v1_store_without_eviction_policy_migrates_to_lru_default(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "preferences.json"
            path.write_text(json.dumps({
                "version": 1,
                "capability_preferences": {},
                "selection_defaults": {
                    "mode": "guided", "prefer_verified": True,
                    "prefer_loaded": True, "resource_headroom_percent": 15,
                },
            }), encoding="utf-8")
            store = CapabilityPreferenceStore(path)
            self.assertEqual(store.get()["selection_defaults"]["eviction_policy"], "lru")
            store.patch({"selection_defaults": {"mode": "manual"}})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["selection_defaults"]["eviction_policy"], "lru")

    def test_patch_merges_preferences_and_selection_defaults(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "preferences.json"
            store = CapabilityPreferenceStore(path)
            profile_id = "a" * 32
            updated = store.patch({
                "capability_preferences": {
                    "text.chat": {"model_id": "model-a", "profile_id": profile_id},
                    "code.review": {"model_id": "model-b"},
                },
                "selection_defaults": {"mode": "guided", "resource_headroom_percent": 25},
            })
            self.assertEqual(updated["capability_preferences"]["text.chat"], {
                "model_id": "model-a", "profile_id": profile_id,
            })
            self.assertEqual(updated["selection_defaults"], {
                "mode": "guided", "prefer_verified": True, "prefer_loaded": True,
                "resource_headroom_percent": 25, "eviction_policy": "lru",
                "assisted_planner_enabled": False,
            })

            second = store.patch({
                "capability_preferences": {"vision.understand": {"model_id": "model-c"}},
                "selection_defaults": {"prefer_loaded": False},
            })
            self.assertEqual(set(second["capability_preferences"]), {
                "text.chat", "code.review", "vision.understand",
            })
            self.assertEqual(second["selection_defaults"]["mode"], "guided")
            self.assertFalse(second["selection_defaults"]["prefer_loaded"])
            self.assertEqual(CapabilityPreferenceStore(path).get(), second)

    def test_set_and_clear_one_capability_preference(self):
        with tempfile.TemporaryDirectory() as td:
            store = CapabilityPreferenceStore(Path(td) / "preferences.json")
            store.set_capability_preference("text.chat", {"model_id": "model-a"})
            self.assertIn("text.chat", store.get()["capability_preferences"])
            store.set_capability_preference("text.chat", None)
            self.assertNotIn("text.chat", store.get()["capability_preferences"])

    def test_unknown_fields_are_rejected_for_patch_and_store(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "preferences.json"
            store = CapabilityPreferenceStore(path)
            invalid_patches = (
                {"other": True},
                {"capability_preferences": {"text.chat": {"model_id": "m", "extra": 1}}},
                {"selection_defaults": {"unexpected": 1}},
            )
            for patch_value in invalid_patches:
                with self.subTest(patch=patch_value):
                    with self.assertRaises(ValueError):
                        store.patch(patch_value)

            path.write_text(json.dumps({
                "version": 1,
                "capability_preferences": {},
                "selection_defaults": {},
                "future_field": True,
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsupported capability preferences store field"):
                store.get()

    def test_preference_capability_model_and_profile_ids_are_validated(self):
        with tempfile.TemporaryDirectory() as td:
            store = CapabilityPreferenceStore(Path(td) / "preferences.json")
            invalid = (
                {"BadCapability": {"model_id": "model-a"}},
                {"text.chat": {"model_id": "/private/model.gguf"}},
                {"text.chat": {"model_id": "x" * 257}},
                {"text.chat": {"profile_id": "not-a-profile-id"}},
                {"text.chat": {}},
            )
            for value in invalid:
                with self.subTest(value=value):
                    with self.assertRaises(ValueError):
                        store.patch({"capability_preferences": value})

            with self.assertRaises(ValueError):
                store.patch({"capability_preferences": {f"text.cap{index}": {"model_id": "m"}
                                                          for index in range(257)}})

    def test_selection_defaults_values_and_types_are_bounded(self):
        with tempfile.TemporaryDirectory() as td:
            store = CapabilityPreferenceStore(Path(td) / "preferences.json")
            invalid = (
                {"mode": "automatic"},
                {"mode": "manual", "prefer_verified": 1},
                {"prefer_loaded": "false"},
                {"resource_headroom_percent": True},
                {"resource_headroom_percent": -1},
                {"resource_headroom_percent": 101},
                {"eviction_policy": "aggressive"},
                {"assisted_planner_enabled": 1},
            )
            for value in invalid:
                with self.subTest(value=value):
                    with self.assertRaises(ValueError):
                        store.patch({"selection_defaults": value})

    def test_atomic_store_file_is_private_and_no_temp_files_remain(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "config" / "capability-preferences.json"
            store = CapabilityPreferenceStore(path)
            store.patch({"selection_defaults": {"mode": "manual"}})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(list(path.parent.iterdir()), [path])
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["version"], 1)
            self.assertEqual(payload["selection_defaults"]["mode"], "manual")
            store.patch({"selection_defaults": {"eviction_policy": "never"}})
            self.assertEqual(CapabilityPreferenceStore(path).get()["selection_defaults"]["eviction_policy"], "never")

    def test_invalid_json_future_version_and_oversize_store_fail_safely(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "preferences.json"
            store = CapabilityPreferenceStore(path)
            path.write_text("{broken", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid JSON"):
                store.get()
            path.write_text(json.dumps({
                "version": 2,
                "capability_preferences": {},
                "selection_defaults": {},
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "version"):
                store.get()
            path.write_text(" " * (1024 * 1024 + 1), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "size limit"):
                store.get()


if __name__ == "__main__":
    unittest.main()
