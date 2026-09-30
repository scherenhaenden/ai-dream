import unittest

from aidream.artifacts.contracts import validate_artifact_envelope


def envelope(**overrides):
    value = {
        "schema_version": 1,
        "id": "art_contract-fixture",
        "kind": "json",
        "media_type": "application/json",
        "name": "fixture.json",
        "storage": {"type": "session", "key": "opaque-key"},
        "size_bytes": 2,
        "lifetime": "session",
        "owner": {"type": "session", "id": "session-fixture"},
        "metadata": {},
    }
    value.update(overrides)
    return value


class ArtifactContractTests(unittest.TestCase):
    def test_bounded_metadata_extension_fields_survive_validation_detached(self):
        original = {"producer": {"schema": "future-extension-v1", "tags": ["one", "two"]}}
        result = validate_artifact_envelope(envelope(metadata=original))
        self.assertEqual(result["metadata"], original)
        result["metadata"]["producer"]["tags"].append("mutated")
        self.assertEqual(original["producer"]["tags"], ["one", "two"])

    def test_future_versions_and_unknown_v1_top_level_fields_fail_closed(self):
        for version in (2, 99, True):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "schema_version"):
                validate_artifact_envelope(envelope(schema_version=version))
        with self.assertRaisesRegex(ValueError, "unsupported fields"):
            validate_artifact_envelope(envelope(future_field={"unbounded": "outside metadata"}))

    def test_metadata_extension_budget_is_enforced(self):
        with self.assertRaisesRegex(ValueError, "metadata exceeds"):
            metadata = {f"extension_{index}": "x" * 1024 for index in range(9)}
            validate_artifact_envelope(envelope(metadata=metadata))


if __name__ == "__main__":
    unittest.main()
