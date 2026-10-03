import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from aidream.app_settings import default_settings
from aidream.http_api import ReadOnlyAPI, create_server
from tests.test_rag_sqlite import create_sample_database


class FakeSettingsStore:
    def __init__(self, data_dir: Path):
        self._data = default_settings()
        self._data["data_dir"] = str(data_dir)

    def get(self):
        return dict(self._data)


class HTTPRAGSQLiteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_store.sqlite"
        create_sample_database(self.db_path)
        data_dir = Path(self.temp_dir.name) / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        settings_store = FakeSettingsStore(data_dir)
        self.server = create_server(0, api=ReadOnlyAPI(settings_store=settings_store))
        self.port = self.server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"
        import threading
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.server_close()
        self.temp_dir.cleanup()

    def _post(self, path: str, body: dict) -> tuple[int, dict]:
        data = json.dumps(body).encode("utf-8")
        req = Request(f"{self.base_url}{path}", data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Origin", self.base_url)
        with urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def _get(self, path: str) -> tuple[int, dict]:
        req = Request(f"{self.base_url}{path}", method="GET")
        req.add_header("Origin", self.base_url)
        with urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def _delete(self, path: str) -> tuple[int, dict]:
        req = Request(f"{self.base_url}{path}", method="DELETE")
        req.add_header("Origin", self.base_url)
        with urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def test_inspect_sqlite_database(self):
        status, body = self._post("/api/rag/sqlite/inspect", {"path": str(self.db_path)})
        self.assertEqual(status, 200)
        data = body["data"]
        profile = data["profile"]
        self.assertEqual(profile["file_name"], "test_store.sqlite")
        self.assertEqual(len(profile["tables"]), 2)
        self.assertEqual(len(profile["views"]), 1)
        schema_card = data["schema_card"]
        self.assertIn("# Database Schema: test_store.sqlite", schema_card)
        self.assertIn("### Table `customers`", schema_card)

    def test_sqlite_source_lifecycle_and_query(self):
        # 1. Ingest source
        status, body = self._post("/api/rag/sqlite/sources", {
            "name": "my_store.db",
            "path": str(self.db_path),
        })
        self.assertEqual(status, 201)
        source_meta = body["data"]
        source_id = source_meta["source_id"]
        self.assertEqual(source_meta["file_name"], "my_store.db")
        self.assertIn("profile", source_meta)

        # 2. List sources
        status, list_body = self._get("/api/rag/sqlite/sources")
        self.assertEqual(status, 200)
        sources = list_body["data"]["sources"]
        self.assertTrue(any(s["source_id"] == source_id for s in sources))

        # 3. Get single source
        status, get_body = self._get(f"/api/rag/sqlite/sources/{source_id}")
        self.assertEqual(status, 200)
        self.assertEqual(get_body["data"]["source"]["source_id"], source_id)

        # 4. Safe query
        status, query_body = self._post(f"/api/rag/sqlite/sources/{source_id}/query", {
            "sql": "SELECT name, email FROM customers WHERE status = 'active' ORDER BY id",
            "max_rows": 10,
        })
        self.assertEqual(status, 200)
        qdata = query_body["data"]
        self.assertEqual(qdata["columns"], ["name", "email"])
        self.assertEqual(len(qdata["rows"]), 2)
        self.assertEqual(qdata["rows"][0][0], "Alice Smith")

        # 5. Security blocked query
        req = Request(
            f"{self.base_url}/api/rag/sqlite/sources/{source_id}/query",
            data=json.dumps({"sql": "DELETE FROM customers"}).encode("utf-8"),
            method="POST",
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Origin", self.base_url)
        with self.assertRaises(HTTPError) as raised:
            urlopen(req)
        self.assertEqual(raised.exception.status, 400)

        # 6. Delete source
        status, del_body = self._delete(f"/api/rag/sqlite/sources/{source_id}")
        self.assertEqual(status, 200)
        self.assertTrue(del_body["data"]["deleted"])

        # 7. Verify deletion
        status, after_list = self._get("/api/rag/sqlite/sources")
        self.assertFalse(any(s["source_id"] == source_id for s in after_list["data"]["sources"]))

    def test_rag_status_endpoint(self):
        status, body = self._get("/api/rag/status")
        self.assertEqual(status, 200)
        self.assertIn("vector_store", body["data"])
        self.assertTrue(body["data"]["vector_store"]["connected"])

    def test_semantic_indexing_and_search(self):
        # 1. Ingest source
        status, body = self._post("/api/rag/sqlite/sources", {
            "name": "semantic_store.db",
            "path": str(self.db_path),
        })
        self.assertEqual(status, 201)
        source_id = body["data"]["source_id"]

        # 2. Trigger semantic indexing into Qdrant
        status, idx_body = self._post(f"/api/rag/sqlite/sources/{source_id}/index_semantic", {})
        self.assertEqual(status, 200)
        idx_data = idx_body["data"]
        self.assertEqual(idx_data["source_id"], source_id)
        self.assertEqual(idx_data["rows_indexed"], 6)

        # 3. Perform semantic search over SQLite rows
        status, search_body = self._post(f"/api/rag/sqlite/sources/{source_id}/search_semantic", {
            "query": "front porch",
            "limit": 3,
            "table": "orders",
        })
        self.assertEqual(status, 200)
        results = search_body["data"]["results"]
        self.assertGreater(len(results), 0)
        self.assertEqual(results[0]["table"], "orders")
        self.assertIn("front porch", results[0]["text"])

        # 4. Ingest and semantically index a knowledge document
        status, doc_body = self._post("/api/knowledge/documents", {
            "name": "sample_doc.txt",
            "content": "Antigravity RAG engine connects SQLite with Qdrant vector databases.",
        })
        self.assertEqual(status, 201)
        doc_id = doc_body["data"]["document"]["id"]

        # Index document semantically
        status, doc_idx = self._post(f"/api/rag/knowledge/documents/{doc_id}/index_semantic", {})
        self.assertEqual(status, 200)
        self.assertEqual(doc_idx["data"]["document_id"], doc_id)
        self.assertGreater(doc_idx["data"]["chunks_indexed"], 0)

        # Search documents semantically
        status, doc_search = self._post("/api/rag/knowledge/search_semantic", {
            "query": "vector databases",
            "limit": 3,
        })
        self.assertEqual(status, 200)
        doc_results = doc_search["data"]["results"]
        self.assertGreater(len(doc_results), 0)
        self.assertEqual(doc_results[0]["document_id"], doc_id)


if __name__ == "__main__":
    unittest.main()
