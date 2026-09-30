from __future__ import annotations

from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from aidream.capabilities import UserManifestOverlayStore
from aidream.http_api import APIError, ReadOnlyAPI


MODEL_ID = "a" * 24


def _api(path: Path):
    api = ReadOnlyAPI.__new__(ReadOnlyAPI)
    api.catalog = SimpleNamespace(list_models=lambda: [SimpleNamespace(
        id=MODEL_ID, metadata={"general.name": "Observed name"}, path="/private/model.gguf")])
    api.manifest_store = None
    api.manifest_overlay_store = UserManifestOverlayStore(path)
    return api


class ManifestOverlayStoreTests(unittest.TestCase):
    def test_persists_user_metadata_across_store_restart_and_can_reset(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "model-overrides.json"
            first = UserManifestOverlayStore(path)
            self.assertEqual(first.patch("local." + MODEL_ID, {
                "display_name": "My model", "ui": {"color": "blue"},
            })["provenance"]["status"], "unknown")
            first.patch("local." + MODEL_ID, {"ui": {"icon": "sparkles"}})

            restarted = UserManifestOverlayStore(path)
            overlay = restarted.get("local." + MODEL_ID)
            self.assertEqual(overlay["display_name"], "My model")
            self.assertEqual(overlay["ui"], {"color": "blue", "icon": "sparkles"})
            self.assertEqual(overlay["provenance"]["source"], "user_override")
            self.assertEqual(restarted.patch("local." + MODEL_ID, {"reset": True}), None)
            self.assertEqual(UserManifestOverlayStore(path).list_overrides(), ())

    def test_rejects_protected_claims_and_invalid_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = UserManifestOverlayStore(Path(temporary) / "overrides.json")
            for changes in (
                {"capabilities": [{"id": "text.chat"}]},
                {"provenance": {"source": "user_override", "status": "verified"}},
                {"artifacts": []},
                {"display_name": float("nan")},
            ):
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    store.patch("local." + MODEL_ID, changes)

    def test_api_merges_persistent_overlay_and_reports_field_provenance_without_verifying(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "overrides.json"
            api = _api(path)
            result = api.update_model_manifest_preferences("local." + MODEL_ID, {
                "display_name": "User label", "ui": {"color": "blue"},
            })
            self.assertEqual(result["manifest"]["display_name"], "User label")
            self.assertEqual(result["manifest"]["provenance"]["source"], "user_override")
            self.assertEqual(result["manifest"]["provenance"]["status"], "unknown")
            self.assertEqual(result["field_provenance"]["display_name"]["layer"], "user_override")
            self.assertEqual(result["field_provenance"]["artifacts"]["layer"], "observed")
            self.assertEqual(result["manifest"]["capabilities"], [])

            restarted_api = _api(path)
            detail = restarted_api.get(f"/api/model-manifests/local.{MODEL_ID}")[1]["data"]
            persisted = detail["manifest"]
            self.assertEqual(persisted["display_name"], "User label")
            self.assertEqual(detail["field_provenance"]["display_name"]["layer"], "user_override")
            reset = restarted_api.update_model_manifest_preferences("local." + MODEL_ID, {"reset": True})
            self.assertEqual(reset["manifest"]["display_name"], "Observed name")
            self.assertEqual(reset["manifest"]["provenance"]["source"], "model_metadata")

    def test_api_validation_happens_before_persistent_write_and_unknown_ids_404(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "overrides.json"
            api = _api(path)
            with self.assertRaises(ValueError):
                api.update_model_manifest_preferences("local." + MODEL_ID, {"modalities": {"inputs": ["made_up"]}})
            self.assertEqual(UserManifestOverlayStore(path).list_overrides(), ())
            with self.assertRaisesRegex(APIError, "not found"):
                api.update_model_manifest_preferences("local." + "b" * 24, {"display_name": "No model"})

if __name__ == "__main__":
    unittest.main()
