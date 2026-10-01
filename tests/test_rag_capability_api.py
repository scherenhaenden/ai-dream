from __future__ import annotations

import sqlite3
from types import SimpleNamespace
import unittest

from aidream.capabilities import CapabilityRegistry
from aidream.http_api import ReadOnlyAPI


def _fts5_available() -> bool:
    try:
        with sqlite3.connect(":memory:") as connection:
            connection.execute("CREATE VIRTUAL TABLE fts_probe USING fts5(content)")
        return True
    except sqlite3.Error:
        return False


def _api():
    api = ReadOnlyAPI.__new__(ReadOnlyAPI)
    api.catalog = SimpleNamespace(list_models=lambda: [])
    api.capability_registry = CapabilityRegistry()
    api._effective_runtime_defaults = lambda: {}
    api._all_backends = lambda: []
    api.local_voice = SimpleNamespace(configuration=lambda: SimpleNamespace(
        capabilities=SimpleNamespace(speech_to_text=False, text_to_speech=False), whisper_models=()))
    return api


class RAGCapabilityAPITests(unittest.TestCase):
    def test_document_parse_is_exposed_as_local_tool_not_a_model_claim(self):
        capabilities = {item["id"]: item for item in _api().get("/api/capabilities")[1]["data"]["capabilities"]}
        item = capabilities["document.parse"]
        self.assertEqual(item["status"], "supported")
        self.assertEqual(item["inputs"], [{"kind": "document"}])
        self.assertEqual(item["outputs"], [{"kind": "text"}])
        self.assertEqual(item["routes"], [{
            "id": "route_local_document_parse", "model_id": None,
            "runtime_id": "local-document-parser",
        }])
        evidence = item["evidence"][0]
        self.assertEqual(evidence["status"], "supported")
        self.assertIn("TXT", evidence["details"])
        self.assertNotIn("verified_at", evidence)

    def test_retrieval_search_reports_fts5_tool_evidence_and_route_if_available(self):
        api = _api()
        api.knowledge_index = SimpleNamespace(search=lambda _query, _limit: [])
        capabilities = {item["id"]: item for item in api.get("/api/capabilities")[1]["data"]["capabilities"]}
        item = capabilities["retrieval.search"]
        self.assertEqual(item["inputs"], [{"kind": "text"}])
        self.assertEqual(item["outputs"], [{"kind": "json"}])
        if _fts5_available():
            self.assertEqual(item["status"], "supported")
            self.assertEqual(len(item["routes"]), 1)
            self.assertIsNone(item["routes"][0]["model_id"])
            self.assertEqual(item["routes"][0]["runtime_id"], "local-knowledge-fts5")
            self.assertIn("lexical", item["evidence"][0]["details"].casefold())
        else:
            self.assertEqual(item["status"], "unavailable")
            self.assertEqual(item["routes"], [])
            self.assertIn("FTS5", item["evidence"][0]["details"])

    def test_retrieval_search_is_not_advertised_without_an_executable_index_handler(self):
        capabilities = {item["id"]: item for item in _api().get("/api/capabilities")[1]["data"]["capabilities"]}
        item = capabilities["retrieval.search"]
        self.assertEqual("unavailable", item["status"])
        self.assertEqual([], item["routes"])
        if _fts5_available():
            self.assertIn("search handler is configured", item["evidence"][0]["details"])

    def test_embedding_and_reranking_remain_typed_unavailable_and_explain_why(self):
        capabilities = {item["id"]: item for item in _api().get("/api/capabilities")[1]["data"]["capabilities"]}
        expected = {
            "embedding.create": ([{"kind": "text"}], [{"kind": "embedding_batch"}], "embedding model"),
            "rerank.score": ([{"kind": "rerank_candidates"}], [{"kind": "rerank_candidates"}], "reranker"),
        }
        for capability_id, (inputs, outputs, reason) in expected.items():
            with self.subTest(capability=capability_id):
                item = capabilities[capability_id]
                self.assertEqual(item["status"], "unavailable")
                self.assertEqual(item["routes"], [])
                self.assertEqual(item["inputs"], inputs)
                self.assertEqual(item["outputs"], outputs)
                self.assertIn(reason, item["evidence"][0]["details"].casefold())

    def test_existing_rag_skill_remains_tool_based_and_does_not_require_embeddings(self):
        from aidream.skills import builtin_skill_manifests
        skill = next(item for item in builtin_skill_manifests()
                     if item["id"] == "document.answer-with-rag")
        self.assertEqual(skill["requirements"]["capabilities"], ["text.chat"])
        self.assertTrue(any(node.get("tool_id") == "document.retrieve-temporary"
                            for node in skill["graph"]))
        self.assertTrue(any(output["name"] == "citations" and output["artifact"] == "json"
                            for output in skill["outputs"]))


if __name__ == "__main__":
    unittest.main()
