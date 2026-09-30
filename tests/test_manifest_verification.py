from __future__ import annotations

from pathlib import Path
import tempfile
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
)


MANIFEST_ID = "local.aaaaaaaaaaaaaaaaaaaaaaaa"
COMPLETED = "2026-09-30T12:30:00+00:00"


def _claim(capability_id="text.generate"):
    return CapabilityDeclaration(
        id=capability_id,
        inputs=(ArtifactType("text"),),
        outputs=(ArtifactType("text"),),
        evidence=Evidence(EvidenceSource.VERIFIED_RUN, EvidenceStatus.VERIFIED,
                          EvidenceConfidence.HIGH, COMPLETED, "bounded fake probe succeeded"),
    )


def _result(*, success=True, capabilities=None, profile=None):
    if capabilities is None:
        capabilities = (_claim(),) if success else ()
    if profile is None and success:
        profile = {
            "name": "Verified text",
            "runtime_id": "fake-runtime",
            "profile_class": "verified",
            "purpose": ["text.generate"],
            "verification": {"status": "verified", "verified_at": COMPLETED,
                             "details": "bounded fake probe succeeded"},
        }
    return ManifestVerificationResult(
        manifest_id=MANIFEST_ID, runtime_id="fake-runtime", success=success,
        completed_at=COMPLETED, details="bounded fake probe succeeded",
        capabilities=capabilities, profile=profile,
    )


class ManifestVerificationStoreTests(unittest.TestCase):
    def test_successful_fake_probe_persists_verified_overlay_and_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "verification.json"
            store = ManifestVerificationStore(path)
            store.record(_result())

            restarted = ManifestVerificationStore(path)
            record = restarted.get(MANIFEST_ID)
            self.assertTrue(record["success"])
            self.assertEqual(record["profile"]["profile_class"], "verified")
            overlays = restarted.generated_overlays()
            self.assertEqual(len(overlays), 1)
            merged = ModelManifestStore.from_layers(
                observed=[{"schema_version": 1, "id": MANIFEST_ID, "display_name": "Observed",
                           "artifacts": [], "capabilities": [],
                           "provenance": {"source": "model_metadata", "status": "unknown"}}],
                generated=overlays,
            )
            manifest = merged.get(MANIFEST_ID)
            self.assertEqual(manifest.provenance.source, EvidenceSource.VERIFIED_RUN)
            self.assertEqual(manifest.provenance.status, EvidenceStatus.VERIFIED)
            self.assertEqual([item.id for item in manifest.capabilities], ["text.generate"])
            self.assertEqual(merged.provenance_for(MANIFEST_ID, "capabilities")["capabilities"].layer, "generated")

    def test_failure_is_persisted_for_diagnostics_and_clears_previous_verified_overlay(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = ManifestVerificationStore(Path(temporary) / "verification.json")
            store.record(_result())
            store.record(_result(success=False, profile=None))
            self.assertFalse(store.get(MANIFEST_ID)["success"])
            self.assertEqual(store.generated_overlays(), ())

    def test_cannot_promote_unverified_or_user_fabricated_capability_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = ManifestVerificationStore(Path(temporary) / "verification.json")
            with self.assertRaisesRegex(ValueError, "verified_run evidence"):
                store.record(_result(capabilities=(CapabilityDeclaration(
                    id="text.generate", inputs=(), outputs=(),
                    evidence=Evidence(EvidenceSource.USER_OVERRIDE, EvidenceStatus.VERIFIED),
                ),)))
            with self.assertRaisesRegex(ValueError, "failed verification"):
                store.record(_result(success=False, capabilities=(_claim(),), profile=None))
            self.assertIsNone(store.get(MANIFEST_ID))

    def test_rejects_untyped_callback_output_and_corrupt_or_future_store(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "verification.json"
            store = ManifestVerificationStore(path)
            with self.assertRaises(TypeError):
                store.record({"manifest_id": MANIFEST_ID, "success": True})
            path.write_text('{"version":99,"records":{}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsupported shape or version"):
                store.list_records()


if __name__ == "__main__":
    unittest.main()
