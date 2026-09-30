import tempfile
import unittest

from aidream.artifacts import ArtifactAPI, ArtifactAPIError, ArtifactStore


class ArtifactAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = ArtifactStore(self.temp.name, max_artifact_bytes=4, max_total_bytes=6, max_artifacts=3)
        self.api = ArtifactAPI(self.store)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def upload(self, body=b"bin", *, owner_type="session", owner_id="session-1", **options):
        return self.api.create(body, kind="image", media_type="image/png", name="upload.png",
                               owner_type=owner_type, owner_id=owner_id, **options)

    def test_upload_list_metadata_and_content_keep_binary_separate(self):
        envelope = self.upload()
        artifacts = self.api.list(owner_type="session", owner_id="session-1")
        self.assertEqual([item["id"] for item in artifacts], [envelope["id"]])
        self.assertEqual(self.api.metadata(envelope["id"], owner_type="session", owner_id="session-1"), envelope)
        metadata, body = self.api.content(envelope["id"], owner_type="session", owner_id="session-1")
        self.assertEqual(metadata["media_type"], "image/png")
        self.assertEqual(body, b"bin")
        self.assertNotIn(str(self.store.root), repr(envelope))
        self.assertNotIn("content", envelope)

    def test_list_and_access_are_owner_scoped(self):
        artifact = self.upload()
        self.assertEqual(self.api.list(owner_type="session", owner_id="session-2"), [])
        for operation in (
            lambda: self.api.metadata(artifact["id"], owner_type="session", owner_id="session-2"),
            lambda: self.api.content(artifact["id"], owner_type="session", owner_id="session-2"),
            lambda: self.api.delete(artifact["id"], owner_type="session", owner_id="session-2"),
        ):
            with self.assertRaises(ArtifactAPIError) as raised:
                operation()
            self.assertEqual(raised.exception.status, 404)

    def test_delete_is_owner_scoped_and_returns_not_found_after_removal(self):
        artifact = self.upload()
        self.api.delete(artifact["id"], owner_type="session", owner_id="session-1")
        with self.assertRaises(ArtifactAPIError) as raised:
            self.api.metadata(artifact["id"], owner_type="session", owner_id="session-1")
        self.assertEqual(raised.exception.code, "artifact_not_found")

    def test_upload_limits_are_rejected_as_payload_too_large(self):
        with self.assertRaises(ArtifactAPIError) as raised:
            self.upload(b"12345")
        self.assertEqual((raised.exception.status, raised.exception.code), (413, "artifact_too_large"))
        self.upload(b"1234")
        with self.assertRaises(ArtifactAPIError) as raised:
            self.upload(b"123")
        self.assertEqual(raised.exception.status, 413)  # total-byte quota

    def test_count_quota_maps_to_413(self):
        store = ArtifactStore(self.temp.name, max_artifact_bytes=4, max_total_bytes=20, max_artifacts=1)
        api = ArtifactAPI(store)
        try:
            api.create(b"a", kind="text", media_type="text/plain", name="a.txt",
                       owner_type="user", owner_id="edward", lifetime="session")
            with self.assertRaises(ArtifactAPIError) as raised:
                api.create(b"b", kind="text", media_type="text/plain", name="b.txt",
                           owner_type="user", owner_id="edward", lifetime="session")
            self.assertEqual((raised.exception.status, raised.exception.code), (413, "artifact_limit"))
        finally:
            store.close()

    def test_rejects_unsupported_lifetimes_owner_shapes_and_paths(self):
        cases = [
            lambda: self.upload(lifetime="persistent"),
            lambda: self.api.create(b"x", kind="image", media_type="image/png", name="x.png",
                                    owner_type="other", owner_id="one"),
            lambda: self.api.create(b"x", kind="image", media_type="image/png", name="../x.png",
                                    owner_type="session", owner_id="one"),
            lambda: self.api.create(b"x", kind="image", media_type="image/png", name="x.png",
                                    owner_type="session", owner_id="/tmp/path"),
        ]
        for call in cases:
            with self.assertRaises(ArtifactAPIError):
                call()
        self.assertEqual(list(self.store.root.iterdir()), [])

    def test_closed_store_maps_to_safe_unavailable_error(self):
        self.store.close()
        with self.assertRaises(ArtifactAPIError) as raised:
            self.upload()
        self.assertEqual((raised.exception.status, raised.exception.code), (503, "artifact_store_unavailable"))
        self.assertNotIn(str(self.store.root), raised.exception.message)


if __name__ == "__main__":
    unittest.main()
