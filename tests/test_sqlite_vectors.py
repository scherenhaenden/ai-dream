from __future__ import annotations

import hashlib
import math
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from aidream.rag.qdrant_adapter import QdrantAdapter
from aidream.rag.sqlite_vectors import (
    chunk_document_text,
    format_row_as_text,
    index_knowledge_document,
    index_sqlite_source,
    search_knowledge_documents,
    search_sqlite_vectors,
)
from tests.test_rag_sqlite import create_sample_database


def dummy_embedder(texts: list[str]) -> list[list[float]]:
    """Deterministic 32-dim normalized embedding based on MD5 tokens."""
    results = []
    for text in texts:
        vec = [0.0] * 32
        tokens = text.lower().split()
        for tok in tokens:
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:8], 16)
            vec[h % 32] += 1.0
        norm = math.sqrt(sum(x * x for x in vec))
        if norm > 0:
            vec = [x / norm for x in vec]
        results.append(vec)
    return results


class TestSQLiteVectors(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "sample.sqlite"
        create_sample_database(self.db_path)
        self.adapter = QdrantAdapter(base_dir=Path(self.temp_dir.name) / "vector_store")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_format_row_as_text(self):
        row = {"id": 1, "name": "Alice", "balance": 150.5, "data": None}
        text = format_row_as_text("users", ["id", "name", "balance", "data"], row)
        self.assertIn("Table: users", text)
        self.assertIn('id: 1; name: "Alice"; balance: 150.5; data: null', text)

    def test_chunk_document_text(self):
        short = "Hello world"
        chunks = chunk_document_text(short, chunk_size=100)
        self.assertEqual(chunks, ["Hello world"])

        long_text = "Sentence one. " * 30
        chunks = chunk_document_text(long_text, chunk_size=100, overlap=20)
        self.assertGreater(len(chunks), 1)

    def test_index_and_search_sqlite_source(self):
        source_id = "test_src_01"
        res = index_sqlite_source(
            self.db_path,
            source_id,
            dummy_embedder,
            self.adapter,
            batch_size=10,
        )
        self.assertEqual(res["source_id"], source_id)
        self.assertEqual(set(res["tables_indexed"]), {"customers", "orders"})
        # 3 customers + 3 orders = 6 rows
        self.assertEqual(res["rows_indexed"], 6)

        # Search for customer Alice
        hits = search_sqlite_vectors("Alice Smith", source_id, dummy_embedder, self.adapter, limit=3)
        self.assertGreater(len(hits), 0)
        self.assertEqual(hits[0]["table"], "customers")
        self.assertIn("Alice", hits[0]["text"])

        # Search filtered by table
        order_hits = search_sqlite_vectors(
            "front porch", source_id, dummy_embedder, self.adapter, limit=3, table="orders"
        )
        self.assertGreater(len(order_hits), 0)
        self.assertEqual(order_hits[0]["table"], "orders")
        self.assertIn("front porch", order_hits[0]["text"])

    def test_index_and_search_knowledge_document(self):
        doc_id = "doc_12345"
        doc_name = "architecture.md"
        doc_text = (
            "The architecture utilizes SQLite for metadata and relational storage.\n"
            "Vector embeddings are stored in Qdrant collections with cosine distance.\n"
            "Dynamic row serialization formats each table row cleanly."
        )
        res = index_knowledge_document(doc_id, doc_name, doc_text, dummy_embedder, self.adapter)
        self.assertEqual(res["document_id"], doc_id)
        self.assertGreater(res["chunks_indexed"], 0)

        # Search
        hits = search_knowledge_documents("Qdrant cosine embeddings", dummy_embedder, self.adapter, limit=2)
        self.assertGreater(len(hits), 0)
        self.assertEqual(hits[0]["document_id"], doc_id)
        self.assertIn("Qdrant", hits[0]["text"])

    def test_index_sqlite_source_with_progress_and_eta(self):
        source_id = "test_src_eta"
        progress_events = []
        res = index_sqlite_source(
            self.db_path,
            source_id,
            dummy_embedder,
            self.adapter,
            batch_size=2,
            progress_callback=progress_events.append,
        )
        self.assertEqual(res["rows_indexed"], 6)
        self.assertGreaterEqual(len(progress_events), 2)
        self.assertEqual(progress_events[0]["phase"], "indexing")
        self.assertEqual(progress_events[0]["total"], 6)
        self.assertEqual(progress_events[-1]["phase"], "completed")
        self.assertEqual(progress_events[-1]["percent"], 100.0)
        self.assertEqual(progress_events[-1]["eta_seconds"], 0.0)
        self.assertIn("speed", progress_events[-1])
        self.assertEqual(progress_events[-1]["unit"], "filas")

    def test_index_document_with_progress_and_eta(self):
        doc_id = "doc_eta"
        doc_name = "test.txt"
        doc_text = "Paragraph one of information.\n\n" * 10
        progress_events = []
        res = index_knowledge_document(
            doc_id, doc_name, doc_text, dummy_embedder, self.adapter,
            chunk_size=50, chunk_overlap=10, batch_size=2,
            progress_callback=progress_events.append,
        )
        self.assertGreater(res["chunks_indexed"], 0)
        self.assertGreaterEqual(len(progress_events), 2)
        self.assertEqual(progress_events[0]["phase"], "indexing")
        self.assertEqual(progress_events[-1]["phase"], "completed")
        self.assertEqual(progress_events[-1]["percent"], 100.0)
        self.assertEqual(progress_events[-1]["unit"], "bloques")


if __name__ == "__main__":
    unittest.main()
