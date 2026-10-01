from __future__ import annotations

from pathlib import Path
import tempfile
import threading
import unittest

from aidream.capabilities import (
    ArtifactType,
    CapabilityDeclaration,
    Evidence,
    EvidenceConfidence,
    EvidenceSource,
    EvidenceStatus,
    ManifestVerificationResult,
    ManifestVerificationStore,
    ModelManifestStore,
    UserManifestOverlayStore,
)
from aidream.http_api import APIError, APIUnavailable, ReadOnlyAPI
from aidream.model_profiles import ModelProfileStore


MANIFEST_ID = "local.aaaaaaaaaaaaaaaaaaaaaaaa"
VERIFIED_AT = "2026-09-30T14:30:00+00:00"


def _manifest():
    return {
        "schema_version": 1,
        "id": MANIFEST_ID,
        "display_name": "Example Model",
        "artifacts": [{"role": "model", "model_id": "a" * 24}],
        "capabilities": [],
        "provenance": {"source": "model_metadata", "status": "unknown"},
    }


def _claim():
    return CapabilityDeclaration(
        "text.chat", (ArtifactType("text"),), (ArtifactType("text"),),
        Evidence(EvidenceSource.VERIFIED_RUN, EvidenceStatus.VERIFIED,
                 EvidenceConfidence.HIGH, VERIFIED_AT, "fake local probe passed"),
    )


class _Verifier:
    def __init__(self, result):
        self.result = result
        self.runtime_id = "runtime.fake"
        self.seen = []

    def verify(self, manifest):
        self.seen.append(manifest.id)
        return self.result


def _result(*, manifest_id=MANIFEST_ID, success=True, claims=None):
    claims = (_claim(),) if claims is None and success else tuple(claims or ())
    profile = ({
        "name": "Verified local chat",
        "runtime_id": "runtime.fake",
        "profile_class": "verified",
        "purpose": [claim.id for claim in claims],
        "verification": {
            "status": "verified",
            "runtime_version": "fake-1.0",
            "verified_at": VERIFIED_AT,
            "details": "fake local probe passed",
        },
    } if success else None)
    return ManifestVerificationResult(
        manifest_id=manifest_id, runtime_id="runtime.fake", success=success,
        completed_at=VERIFIED_AT, details="fake local probe passed",
        capabilities=claims, profile=profile,
    )


def _api(root, result=None):
    api = ReadOnlyAPI.__new__(ReadOnlyAPI)
    api.manifest_store = ModelManifestStore.from_layers(observed=[_manifest()])
    api.manifest_overlay_store = UserManifestOverlayStore(Path(root) / "user-overrides.json")
    api.manifest_verification_store = ManifestVerificationStore(Path(root) / "verifications.json")
    api.manifest_verifier = _Verifier(result) if result is not None else None
    api.runtime_installations = type("Installations", (), {
        "list_installations": lambda self: [{"id": "runtime.fake", "enabled": True, "available": True}]
    })()
    api.profile_store = ModelProfileStore(Path(root) / "profiles.json")
    api._manifest_verification_lock = threading.Lock()
    return api


class ManifestVerificationAPITests(unittest.TestCase):
    def test_typed_probe_promotes_generated_claims_and_persists_verified_profile(self):
        with tempfile.TemporaryDirectory() as root:
            api = _api(root, _result())
            api.manifest_overlay_store.patch(MANIFEST_ID, {"display_name": "My local model"})

            response = api.verify_model_manifest(MANIFEST_ID)

            self.assertEqual(api.manifest_verifier.seen, [MANIFEST_ID])
            self.assertTrue(response["verification"]["success"])
            self.assertEqual(response["manifest"]["display_name"], "My local model")
            self.assertEqual([item["id"] for item in response["manifest"]["capabilities"]], ["text.chat"])
            self.assertEqual(response["manifest"]["capabilities"][0]["evidence"]["status"], "verified")
            self.assertEqual(response["manifest"]["capabilities"][0]["evidence"]["source"], "verified_run")
            profiles = api.profile_store.list_profiles("a" * 24)
            self.assertEqual(len(profiles), 1)
            self.assertEqual(profiles[0]["profile_class"], "verified")
            self.assertEqual(profiles[0]["purpose"], ["text.chat"])
            self.assertEqual(profiles[0]["verification"]["runtime_version"], "fake-1.0")

    def test_absent_verifier_fails_closed_without_persisting_claims(self):
        with tempfile.TemporaryDirectory() as root:
            api = _api(root)
            self.assertFalse(api.get(f"/api/model-manifests/{MANIFEST_ID}")[1]["data"]["verification_available"])
            with self.assertRaises(APIUnavailable):
                api.verify_model_manifest(MANIFEST_ID)
            self.assertEqual(api.manifest_verification_store.list_records(), ())
            self.assertEqual(api.profile_store.list_profiles(), [])

    def test_ui_read_model_reports_only_a_bound_available_local_verifier(self):
        with tempfile.TemporaryDirectory() as root:
            api = _api(root, _result())
            self.assertTrue(api.get(f"/api/model-manifests/{MANIFEST_ID}")[1]["data"]["verification_available"])
            api.runtime_installations.list_installations = lambda: []
            self.assertFalse(api.get(f"/api/model-manifests/{MANIFEST_ID}")[1]["data"]["verification_available"])

    def test_unregistered_or_unavailable_runtime_is_rejected_before_probe(self):
        with tempfile.TemporaryDirectory() as root:
            api = _api(root, _result())
            api.runtime_installations.list_installations = lambda: [
                {"id": "runtime.fake", "enabled": False, "available": True}
            ]
            with self.assertRaisesRegex(APIUnavailable, "enabled, available local runtime"):
                api.verify_model_manifest(MANIFEST_ID)
            self.assertEqual(api.manifest_verifier.seen, [])
            self.assertEqual(api.manifest_verification_store.list_records(), ())
            self.assertEqual(api.profile_store.list_profiles(), [])

    def test_verifier_cannot_report_a_different_runtime_than_its_bound_installation(self):
        with tempfile.TemporaryDirectory() as root:
            api = _api(root, _result())
            api.manifest_verifier.result = _result()
            api.manifest_verifier.result = ManifestVerificationResult(
                manifest_id=MANIFEST_ID, runtime_id="runtime.other", success=False,
                completed_at=VERIFIED_AT, details="probe failed",
            )
            with self.assertRaisesRegex(APIError, "different runtime"):
                api.verify_model_manifest(MANIFEST_ID)
            self.assertEqual(api.manifest_verification_store.list_records(), ())

    def test_verifier_cannot_promote_another_manifest_or_unverified_claims(self):
        with tempfile.TemporaryDirectory() as root:
            api = _api(root, _result(manifest_id="other.model"))
            with self.assertRaisesRegex(APIError, "different manifest"):
                api.verify_model_manifest(MANIFEST_ID)
            self.assertEqual(api.manifest_verification_store.list_records(), ())
            self.assertEqual(api.profile_store.list_profiles(), [])

    def test_failed_probe_is_recorded_without_a_verified_profile_or_overlay(self):
        with tempfile.TemporaryDirectory() as root:
            api = _api(root, _result(success=False))
            response = api.verify_model_manifest(MANIFEST_ID)
            self.assertFalse(response["verification"]["success"])
            self.assertIsNone(response["profile"])
            self.assertEqual(response["manifest"]["capabilities"], [])
            self.assertEqual(api.profile_store.list_profiles(), [])


if __name__ == "__main__":
    unittest.main()
