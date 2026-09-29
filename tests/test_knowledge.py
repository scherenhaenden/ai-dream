import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import threading
import unittest

from aidream.http_api import ReadOnlyAPI, create_server
from aidream.knowledge import KnowledgeError, SQLiteKnowledgeIndex


class KnowledgeTests(unittest.TestCase):
    def test_index_add_search_delete_and_metadata_does_not_expose_text_or_paths(self):
        with TemporaryDirectory() as temp:
            index = SQLiteKnowledgeIndex(Path(temp) / "knowledge" / "index.sqlite3")
            document = index.add_document("meeting.md", b"Local notes mention cobalt and music.")
            listed = index.list_documents()
            self.assertEqual(listed["count"], 1)
            self.assertNotIn("text", listed["documents"][0])
            self.assertNotIn("path", listed["documents"][0])
            hits = index.search("cobalt", 10)
            self.assertEqual(hits[0]["id"], document["id"])
            self.assertIn("cobalt", hits[0]["snippet"].lower())
            self.assertTrue(index.delete_document(document["id"]))
            self.assertEqual(index.search("cobalt", 10), [])
            self.assertFalse(index.delete_document(document["id"]))

    def test_index_rejects_path_names_and_bounds_queries(self):
        with TemporaryDirectory() as temp:
            index = SQLiteKnowledgeIndex(Path(temp) / "index.sqlite3")
            for name in ("../secret.txt", "folder\\secret.md"):
                with self.subTest(name=name), self.assertRaises(KnowledgeError):
                    index.add_document(name, b"text")
            with self.assertRaises(KnowledgeError):
                index.search("word " * 17)
            with self.assertRaises(KnowledgeError):
                index.search("x", 21)

    def test_http_api_supports_upload_list_search_and_delete(self):
        with TemporaryDirectory() as temp:
            api = ReadOnlyAPI(hardware=object(), catalog=object(), runtimes=object(),
                              knowledge_index=SQLiteKnowledgeIndex(Path(temp) / "knowledge" / "index.sqlite3"))
            server = create_server(0, api=api)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_address[1]}"
            try:
                payload = json.dumps({"name": "reference.txt", "content": "Local search needle value"}).encode()
                request = Request(base + "/api/knowledge/documents", data=payload, method="POST", headers={
                    "Origin": "http://127.0.0.1:5173", "Content-Type": "application/json"})
                with urlopen(request, timeout=3) as response:
                    self.assertEqual(response.status, 201)
                    created = json.loads(response.read())["data"]["document"]
                with urlopen(base + "/api/knowledge/documents", timeout=3) as response:
                    self.assertEqual(json.loads(response.read())["data"]["count"], 1)
                with urlopen(base + "/api/knowledge/search?q=needle&limit=5", timeout=3) as response:
                    result = json.loads(response.read())["data"]
                    self.assertEqual(result["mode"], "full_text")
                    self.assertEqual(result["results"][0]["id"], created["id"])
                request = Request(base + f"/api/knowledge/documents/{created['id']}", method="DELETE",
                                  headers={"Origin": "http://127.0.0.1:5173"})
                with urlopen(request, timeout=3) as response:
                    self.assertTrue(json.loads(response.read())["data"]["deleted"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_search_rejects_query_ambiguity_and_upload_rejects_invalid_name(self):
        with TemporaryDirectory() as temp:
            api = ReadOnlyAPI(hardware=object(), catalog=object(), runtimes=object(),
                              knowledge_index=SQLiteKnowledgeIndex(Path(temp) / "index.sqlite3"))
            for query in ("q=a&q=b", "q=x&unsupported=y", "q=x&limit=0"):
                with self.subTest(query=query), self.assertRaises(Exception):
                    api.get("/api/knowledge/search", query)
            with self.assertRaises(Exception):
                api.add_knowledge_document({"name": "../escape.txt", "content": "text"})


if __name__ == "__main__":
    unittest.main()
