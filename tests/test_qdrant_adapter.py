from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from aidream.rag.qdrant_adapter import (
    DimensionMismatchError,
    QdrantAdapter,
    QdrantConfig,
    QdrantPoint,
    cosine_similarity,
    sanitize_collection_name,
)


class TestQdrantAdapter(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.base_dir = Path(self.temp_dir.name)
        self.adapter = QdrantAdapter(base_dir=self.base_dir)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cosine_similarity(self):
        # Orthogonal vectors
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0], [0.0, 1.0]), 0.0)
        # Identical vectors
        self.assertAlmostEqual(cosine_similarity([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]), 1.0)
        # Opposite vectors
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0], [-1.0, 0.0]), -1.0)
        # Zero vectors
        self.assertEqual(cosine_similarity([0.0, 0.0], [1.0, 1.0]), 0.0)

    def test_sanitize_collection_name(self):
        self.assertEqual(sanitize_collection_name("my-collection_1"), "my-collection_1")
        self.assertEqual(sanitize_collection_name("coll with spaces!@#"), "coll_with_spaces")

    def test_collection_lifecycle_and_upsert(self):
        col_name = "test_col"
        self.assertFalse(self.adapter.collection_exists(col_name))

        self.adapter.ensure_collection(col_name, vector_size=4)
        self.assertTrue(self.adapter.collection_exists(col_name))

        info = self.adapter.get_collection_info(col_name)
        self.assertIsNotNone(info)
        self.assertEqual(info["vector_size"], 4)
        self.assertEqual(info["points_count"], 0)

        # Upsert points
        p1 = QdrantPoint(
            id="00000000-0000-0000-0000-000000000001",
            vector=[1.0, 0.0, 0.0, 0.0],
            payload={"table": "users", "name": "Alice"},
        )
        p2 = QdrantPoint(
            id="00000000-0000-0000-0000-000000000002",
            vector=[0.0, 1.0, 0.0, 0.0],
            payload={"table": "users", "name": "Bob"},
        )
        p3 = QdrantPoint(
            id="00000000-0000-0000-0000-000000000003",
            vector=[0.9, 0.1, 0.0, 0.0],
            payload={"table": "orders", "amount": 100},
        )

        count = self.adapter.upsert_records(col_name, [p1, p2, p3])
        self.assertEqual(count, 3)

        info_after = self.adapter.get_collection_info(col_name)
        self.assertEqual(info_after["points_count"], 3)

        # Search nearest neighbor to [1.0, 0.0, 0.0, 0.0]
        hits = self.adapter.search(col_name, [1.0, 0.0, 0.0, 0.0], limit=2)
        self.assertEqual(len(hits), 2)
        self.assertEqual(hits[0].id, p1.id)
        self.assertAlmostEqual(hits[0].score, 1.0)
        self.assertEqual(hits[1].id, p3.id)

        # Search with filter
        filtered_hits = self.adapter.search(
            col_name,
            [1.0, 0.0, 0.0, 0.0],
            limit=2,
            filter_dict={"table": "orders"},
        )
        self.assertEqual(len(filtered_hits), 1)
        self.assertEqual(filtered_hits[0].id, p3.id)

        # Delete by filter
        deleted_count = self.adapter.delete_by_filter(col_name, {"table": "orders"})
        self.assertEqual(deleted_count, 1)

        info_del = self.adapter.get_collection_info(col_name)
        self.assertEqual(info_del["points_count"], 2)

        # Drop collection
        self.assertTrue(self.adapter.delete_collection(col_name))
        self.assertFalse(self.adapter.collection_exists(col_name))

    def test_dimension_mismatch_rejection(self):
        col_name = "dim_test"
        self.adapter.ensure_collection(col_name, vector_size=3)

        # Upserting vector of size 4 must raise DimensionMismatchError
        bad_pt = QdrantPoint(id="p1", vector=[1.0, 2.0, 3.0, 4.0], payload={})
        with self.assertRaises(DimensionMismatchError):
            self.adapter.upsert_records(col_name, [bad_pt])

        # Trying to ensure same collection with different size must raise DimensionMismatchError
        with self.assertRaises(DimensionMismatchError):
            self.adapter.ensure_collection(col_name, vector_size=5)


if __name__ == "__main__":
    unittest.main()
