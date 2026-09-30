from __future__ import annotations

import json
from types import SimpleNamespace
import unittest

from aidream.http_api import APINotFound, ReadOnlyAPI


class _Catalog:
    def __init__(self, models):
        self.models = models

    def list_models(self):
        return self.models


def _api(models=(), store=None):
    api = ReadOnlyAPI.__new__(ReadOnlyAPI)
    api.catalog = _Catalog(list(models))
    api.manifest_store = store
    return api


class ModelManifestAPITests(unittest.TestCase):
    def test_observed_manifest_is_conservative_and_path_free(self):
        model_id = "a" * 24
        model = SimpleNamespace(
            id=model_id,
            path="/private/models/secret-name.gguf",
            metadata={"general.name": "Example Local Model", "general.architecture": "llama"},
        )
        api = _api([model])

        status, response = api.get("/api/model-manifests")
        self.assertEqual(status, 200)
        manifests = response["data"]["manifests"]
        self.assertEqual(len(manifests), 1)
        manifest = manifests[0]
        self.assertEqual(manifest["id"], f"local.{model_id}")
        self.assertEqual(manifest["display_name"], "Example Local Model")
        self.assertEqual(manifest["artifacts"], [{"role": "model", "model_id": model_id, "optional": False}])
        self.assertEqual(manifest["capabilities"], [])
        self.assertEqual(manifest["provenance"]["source"], "model_metadata")
        self.assertEqual(manifest["provenance"]["status"], "unknown")

        detail_status, detail = api.get(f"/api/model-manifests/local.{model_id}")
        self.assertEqual(detail_status, 200)
        self.assertEqual(detail["data"]["manifest"], manifest)
        serialized = json.dumps(response)
        self.assertNotIn("/private/models", serialized)
        self.assertNotIn("secret-name.gguf", serialized)

    def test_empty_inventory_returns_empty_manifest_list(self):
        status, response = _api().get("/api/model-manifests")
        self.assertEqual(status, 200)
        self.assertEqual(response["data"]["manifests"], [])

    def test_unknown_manifest_returns_404(self):
        with self.assertRaises(APINotFound):
            _api().get("/api/model-manifests/local.aaaaaaaaaaaaaaaaaaaaaaaa")


if __name__ == "__main__":
    unittest.main()
