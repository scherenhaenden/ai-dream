import tempfile
import unittest
from pathlib import Path

from aidream.artifacts import ArtifactLimitError, ArtifactNotFoundError, ArtifactStore


class ArtifactStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = [100.0]
        self.store = ArtifactStore(
            self.temp.name,
            max_artifact_bytes=8,
            max_total_bytes=12,
            max_artifacts=2,
            ephemeral_ttl_seconds=10,
            session_ttl_seconds=50,
            clock=lambda: self.now[0],
        )

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def put(self, content=b"abc", *, lifetime="ephemeral", owner_id="run-1"):
        return self.store.put(
            content, kind="image", media_type="image/png", name="input.png",
            owner_type="run", owner_id=owner_id, lifetime=lifetime,
        )

    def test_stores_bytes_separately_and_returns_typed_metadata(self):
        envelope = self.put()
        self.assertEqual(self.store.read(envelope["id"]), b"abc")
        self.assertEqual(envelope["storage"]["type"], "run-local")
        self.assertNotIn(str(self.store.root), str(envelope))
        self.assertEqual(Path(self.store.root / envelope["storage"]["key"]).stat().st_mode & 0o777, 0o600)

    def test_enforces_per_item_store_and_count_quotas(self):
        with self.assertRaises(ArtifactLimitError):
            self.put(b"123456789")
        self.put(b"12345678")
        self.put(b"1234")
        with self.assertRaises(ArtifactLimitError):
            self.put(b"")

    def test_owner_scoped_delete_supports_cancellation_cleanup(self):
        first = self.put(owner_id="run-1")
        self.put(owner_id="run-2")
        with self.assertRaises(ArtifactNotFoundError):
            self.store.read(first["id"], owner_type="run", owner_id="run-2")
        self.assertEqual(self.store.delete_owner("run", "run-1"), 1)
        with self.assertRaises(ArtifactNotFoundError):
            self.store.read(first["id"])

    def test_expiry_obeys_lifetime_and_can_be_cleaned(self):
        short = self.put(lifetime="ephemeral")
        long = self.put(lifetime="session", owner_id="session-1")
        self.now[0] += 11
        self.assertEqual(self.store.cleanup_expired(), 1)
        with self.assertRaises(ArtifactNotFoundError):
            self.store.read(short["id"])
        self.assertEqual(self.store.read(long["id"]), b"abc")

    def test_ttl_starts_after_artifact_bytes_are_committed(self):
        # Simulate a slow write by advancing the injected monotonic clock
        # between capacity/expiry cleanup and the post-write commit point.
        ticks = iter((100.0, 111.0, 112.0))
        self.store._clock = lambda: next(ticks)
        envelope = self.put()
        self.assertEqual(self.store.read(envelope["id"]), b"abc")

    def test_delete_lazily_sweeps_expired_artifacts_even_when_target_is_missing(self):
        expired = self.put(owner_id="run-expired")
        path = self.store.root / expired["storage"]["key"]
        self.now[0] += 11
        self.assertFalse(self.store.delete("art_missing"))
        self.assertFalse(path.exists())
        with self.assertRaises(ArtifactNotFoundError):
            self.store.read(expired["id"])

    def test_owner_cleanup_lazily_sweeps_expired_artifacts_for_other_owners(self):
        expired = self.put(owner_id="run-expired")
        path = self.store.root / expired["storage"]["key"]
        self.now[0] += 11
        self.assertEqual(self.store.delete_owner("run", "unrelated-owner"), 0)
        self.assertFalse(path.exists())
        with self.assertRaises(ArtifactNotFoundError):
            self.store.read(expired["id"])

    def test_persistent_lifetime_is_not_accepted_by_temporary_store(self):
        with self.assertRaises(ValueError):
            self.put(lifetime="persistent")

    def test_invalid_metadata_does_not_leave_partial_artifact(self):
        before = set(self.store.root.iterdir())
        with self.assertRaises(ValueError):
            self.store.put(b"x", kind="image", media_type="image/png", name="../bad",
                           owner_type="run", owner_id="run-1", metadata={})
        self.assertEqual(set(self.store.root.iterdir()), before)

    def test_close_removes_private_temporary_root(self):
        root = self.store.root
        self.put()
        self.store.close()
        self.assertFalse(root.exists())

    def test_constructor_preserves_caller_owned_parent_permissions(self):
        parent = Path(self.temp.name) / "shared-parent"
        parent.mkdir(mode=0o755)
        parent.chmod(0o755)
        before = parent.stat().st_mode & 0o777
        store = ArtifactStore(parent)
        try:
            self.assertEqual(parent.stat().st_mode & 0o777, before)
            self.assertEqual(store.root.stat().st_mode & 0o777, 0o700)
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
