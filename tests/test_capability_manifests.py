from __future__ import annotations

import unittest

from aidream.capabilities import (
    EvidenceSource,
    EvidenceStatus,
    ModelManifestStore,
)
from aidream.capabilities.manifests import ModelManifest


def _manifest(**changes):
    value = {
        "schema_version": 1,
        "id": "example.model",
        "display_name": "Example Model",
        "artifacts": [{"role": "model", "model_id": "artifact-123"}],
        "capabilities": [{
            "id": "text.chat",
            "inputs": [{"kind": "text"}],
            "outputs": [{"kind": "text"}],
            "evidence": {"source": "runtime_probe", "status": "supported"},
        }],
        "provenance": {
            "source": "model_metadata",
            "status": "supported",
            "confidence": "medium",
        },
        "modalities": {"inputs": ["text"], "outputs": ["text"]},
        "runtime_compatibility": [{
            "runtime_kind": "llama.cpp",
            "formats": ["gguf"],
            "required_features": ["protocol.chat_completions"],
            "preferred": True,
        }],
        "defaults": {"generation": {"temperature": 0.7}},
    }
    value.update(changes)
    return value


class ModelManifestTests(unittest.TestCase):
    def test_documented_schema_example_accepts_optional_model_key_and_empty_provenance(self):
        value = {
            "schema_version": 1,
            "id": "example.model",
            "display_name": "Example Model",
            "description": "Short user-facing description",
            "family": "example-family",
            "variant": "4b-q4",
            "artifacts": [],
            "capabilities": [],
            "modalities": {"inputs": ["text", "image"], "outputs": ["text"]},
            "runtime_compatibility": [],
            "dependencies": [],
            "resource_hints": {},
            "defaults": {},
            "provenance": {},
            "ui": {},
        }

        manifest = ModelManifest.from_mapping(value)

        self.assertIsNone(manifest.model_key)
        self.assertEqual(manifest.provenance.source, EvidenceSource.UNKNOWN)
        self.assertEqual(manifest.provenance.status, EvidenceStatus.UNKNOWN)
        self.assertNotIn("model_key", manifest.to_dict())
        self.assertEqual(manifest.to_dict()["provenance"], {"source": "unknown", "status": "unknown"})

    def test_mapping_round_trip_preserves_extensions_and_normalizes_fields(self):
        value = _manifest(model_key="example/revision-1/q4", future_field={"enabled": True})
        manifest = ModelManifest.from_mapping(value)
        result = manifest.to_dict()

        self.assertEqual(manifest.model_key, "example/revision-1/q4")
        self.assertEqual(result["future_field"], {"enabled": True})
        self.assertEqual(result["artifacts"][0]["model_id"], "artifact-123")
        self.assertEqual(result["capabilities"][0]["id"], "text.chat")

    def test_rejects_invalid_schema_ids_types_and_bounds(self):
        cases = (
            ({"id": "Upper.Model"}, "namespaced"),
            ({"model_key": "../secret"}, "model_key"),
            ({"schema_version": 2}, "schema_version"),
            ({"artifacts": "not-a-list"}, "artifacts"),
            ({"capabilities": ["text.chat"]}, "capability declaration"),
            ({"display_name": "x" * 201}, "display_name"),
            ({"artifacts": [{"role": "bad role", "model_id": "id"}]}, "artifact role"),
            ({"resource_hints": {"vram_bytes_estimate": -1}}, "non-negative"),
        )
        for changes, message in cases:
            with self.subTest(changes=changes):
                value = _manifest()
                value.update(changes)
                with self.assertRaisesRegex(ValueError, message):
                    ModelManifest.from_mapping(value)

    def test_nonempty_provenance_is_strict(self):
        value = _manifest(provenance={"source": "made_up", "status": "supported"})
        with self.assertRaisesRegex(ValueError, "evidence source"):
            ModelManifest.from_mapping(value)

    def test_input_is_detached_and_to_dict_returns_fresh_nested_values(self):
        value = _manifest(future_field={"items": ["before"]})
        manifest = ModelManifest.from_mapping(value)
        value["future_field"]["items"].append("after")
        result = manifest.to_dict()
        self.assertEqual(result["future_field"], {"items": ["before"]})
        result["future_field"]["items"].append("caller-change")
        self.assertEqual(manifest.to_dict()["future_field"], {"items": ["before"]})
        with self.assertRaises(TypeError):
            manifest.defaults["generation"]["temperature"] = 0.1


class ModelManifestStoreTests(unittest.TestCase):
    def test_layer_precedence_deep_merge_list_replace_and_field_provenance(self):
        observed = _manifest(
            model_key="example/rev1",
            defaults={"generation": {"temperature": 0.7, "top_p": 0.9}, "keep": True},
            runtime_compatibility=[{"runtime_kind": "llama.cpp", "formats": ["gguf"]}],
        )
        curated = {
            "id": "example.model",
            "provenance": {"source": "bundled_manifest", "status": "supported"},
            "defaults": {"generation": {"temperature": 0.4}},
            "runtime_compatibility": [{"runtime_kind": "vllm", "formats": ["safetensors"]}],
        }
        generated = {
            "id": "example.model",
            "description": "Generated note",
            "defaults": {"generation": {"seed": 7}},
            "provenance": {"source": "verified_run", "status": "verified"},
        }
        user = {
            "id": "example.model",
            "display_name": "My Model",
            "provenance": {"source": "user_override", "status": "supported"},
        }

        store = ModelManifestStore.from_layers(
            observed=[observed], curated=[curated], generated=[generated], user_overrides=[user]
        )
        merged = store.get("example.model")
        self.assertEqual(merged.display_name, "My Model")
        self.assertEqual(merged.defaults["generation"], {"temperature": 0.4, "top_p": 0.9, "seed": 7})
        self.assertTrue(merged.defaults["keep"])
        self.assertEqual([route.runtime_kind for route in merged.runtime_compatibility], ["vllm"])
        self.assertEqual(merged.provenance.source, EvidenceSource.USER_OVERRIDE)
        self.assertEqual(store.provenance_for("example.model", "display_name")["display_name"].layer, "user_override")
        self.assertEqual(store.provenance_for("example.model", "defaults.generation.temperature")[
            "defaults.generation.temperature"].layer, "curated")
        self.assertEqual(store.provenance_for("example.model", "runtime_compatibility")[
            "runtime_compatibility"].layer, "curated")
        self.assertEqual([item.id for item in store.list_manifests()], ["example.model"])

    def test_rejects_conflicting_stable_model_keys_and_duplicate_layer_ids(self):
        with self.assertRaisesRegex(ValueError, "model_key conflicts"):
            ModelManifestStore.from_layers(
                observed=[_manifest(model_key="family/rev1")],
                user_overrides=[{"id": "example.model", "model_key": "family/rev2"}],
            )
        with self.assertRaisesRegex(ValueError, "duplicate manifest id"):
            ModelManifestStore.from_layers(observed=[_manifest(), _manifest(display_name="Duplicate")])

    def test_empty_overlay_provenance_stays_explicitly_unknown(self):
        store = ModelManifestStore.from_layers(
            observed=[_manifest()],
            user_overrides=[{"id": "example.model", "provenance": {}}],
        )
        self.assertEqual(store.get("example.model").provenance.source, EvidenceSource.UNKNOWN)
        self.assertEqual(store.get("example.model").provenance.status, EvidenceStatus.UNKNOWN)
        self.assertEqual(store.provenance_for("example.model", "provenance")["provenance"].layer, "user_override")

    def test_store_detaches_source_mappings_and_returns_immutable_snapshot(self):
        source = _manifest()
        store = ModelManifestStore.from_layers(observed=[source])
        source["display_name"] = "Changed outside"
        self.assertEqual(store.get("example.model").display_name, "Example Model")
        out = store.get("example.model").to_dict()
        out["artifacts"].clear()
        self.assertEqual(len(store.get("example.model").artifacts), 1)
        self.assertIsNone(store.get("missing.model"))
        with self.assertRaises(TypeError):
            store.provenance_for("example.model")["display_name"] = None

    def test_generated_verification_overrides_claims_but_user_metadata_keeps_priority(self):
        base = ModelManifestStore.from_layers(observed=[_manifest()])
        generated = base.with_generated_overrides([{
            "id": "example.model",
            "provenance": {"source": "verified_run", "status": "verified"},
            "capabilities": [{
                "id": "text.summarize", "inputs": [{"kind": "text"}], "outputs": [{"kind": "text"}],
                "evidence": {"source": "verified_run", "status": "verified",
                             "verified_at": "2026-09-30T12:30:00+00:00"},
            }],
        }])
        merged = generated.with_user_overrides([{
            "id": "example.model", "display_name": "My label",
            "provenance": {"source": "user_override", "status": "unknown"},
        }])
        self.assertEqual([item.id for item in merged.get("example.model").capabilities], ["text.summarize"])
        self.assertEqual(merged.get("example.model").provenance.source, EvidenceSource.USER_OVERRIDE)
        self.assertEqual(merged.provenance_for("example.model", "capabilities")["capabilities"].layer, "generated")
        self.assertEqual(merged.provenance_for("example.model", "display_name")["display_name"].layer,
                         "user_override")

    def test_generated_claims_do_not_replace_preexisting_user_fields(self):
        base = ModelManifestStore.from_layers(
            observed=[_manifest()],
            user_overrides=[{
                "id": "example.model", "display_name": "Chosen name",
                "provenance": {"source": "user_override", "status": "unknown"},
            }],
        )
        merged = base.with_generated_overrides([{
            "id": "example.model",
            "display_name": "Generated name",
            "provenance": {"source": "verified_run", "status": "verified"},
            "capabilities": [],
        }])
        self.assertEqual(merged.get("example.model").display_name, "Chosen name")
        self.assertEqual(merged.get("example.model").provenance.source, EvidenceSource.USER_OVERRIDE)
        self.assertEqual(merged.provenance_for("example.model", "display_name")["display_name"].layer,
                         "user_override")
        self.assertEqual(merged.provenance_for("example.model", "capabilities")["capabilities"].layer,
                         "generated")

    def test_user_override_merge_preserves_existing_field_provenance(self):
        base = ModelManifestStore.from_layers(
            observed=[_manifest(description="Observed description")],
            curated=[{"id": "example.model", "provenance": {"source": "bundled_manifest", "status": "supported"},
                      "family": "example-family"}],
        )
        merged = base.with_user_overrides([{
            "id": "example.model", "display_name": "My name",
            "provenance": {"source": "user_override", "status": "unknown"},
        }])
        self.assertEqual(merged.get("example.model").display_name, "My name")
        self.assertEqual(merged.provenance_for("example.model", "display_name")["display_name"].layer,
                         "user_override")
        self.assertEqual(merged.provenance_for("example.model", "family")["family"].layer, "curated")
        self.assertEqual(merged.provenance_for("example.model", "description")["description"].layer,
                         "observed")


if __name__ == "__main__":
    unittest.main()
