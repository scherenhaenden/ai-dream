from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock

from aidream.http_api import ReadOnlyAPI
from aidream.providers import (
    CrossEncoderReranker,
    Embedder,
    LLMReranker,
    LexicalReranker,
    LocalSentenceTransformerEmbedder,
    OpenAICompatibleTransport,
    ProviderAPI,
    ProviderAPIError,
    ProviderAuthError,
    ProviderConnectionError,
    ProviderConnections,
    ProviderConnectionStore,
    ProviderError,
    ProviderResponse,
    ProviderResponseError,
    RemoteEmbedder,
    RemoteReranker,
    Reranker,
    chat,
    classify_model_role,
    embed_texts,
    list_provider_models,
    normalize_provider_base_url,
    parse_model_id,
    rerank_candidates,
    resolve_embedder,
    resolve_reranker,
    safe_provider_error,
    stream_chat,
)


class MockSecretStore:
    def __init__(self, initial=None):
        self.values = initial or {}

    def available(self):
        return True

    def set(self, ref, secret):
        self.values[ref] = secret

    def get(self, ref):
        return self.values.get(ref)

    def delete(self, ref):
        self.values.pop(ref, None)


class MockTransport:
    def __init__(self):
        self.requests = []
        self.responses = {}

    def list_models(self, base_url, api_key):
        self.requests.append(("GET", base_url, "/models", api_key, None))
        return self.responses.get(
            "/models",
            ProviderResponse(200, {
                "data": [
                    {"id": "gpt-4o-mini", "name": "GPT-4o Mini"},
                    {"id": "text-embedding-3-small", "name": "Text Embedding 3 Small"},
                    {"id": "bge-reranker-large", "name": "BGE Reranker Large"},
                ]
            }),
        )

    def request(self, method, base_url, endpoint, api_key=None, json_body=None, headers=None, timeout=None, max_bytes=None):
        self.requests.append((method, base_url, endpoint, api_key, json_body))
        if endpoint in self.responses:
            return self.responses[endpoint]
        if endpoint == "/embeddings":
            texts = (json_body or {}).get("input", [])
            # Return 3-dim mock vectors
            return ProviderResponse(200, {
                "data": [
                    {"index": i, "embedding": [0.1 * (i + 1), 0.2 * (i + 1), 0.3 * (i + 1)]}
                    for i in range(len(texts))
                ]
            })
        if endpoint == "/rerank":
            docs = (json_body or {}).get("documents", [])
            return ProviderResponse(200, {
                "results": [
                    {"index": i, "relevance_score": 0.9 - (i * 0.1)}
                    for i in range(len(docs))
                ]
            })
        if endpoint == "/chat/completions":
            return ProviderResponse(200, {
                "id": "chatcmpl-test",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello, world!"},
                    "finish_reason": "stop"
                }],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
            })
        return ProviderResponse(404, {"error": "Not found"})

    def stream_request(self, method, base_url, endpoint, api_key=None, json_body=None, headers=None, timeout=None):
        self.requests.append((method, base_url, endpoint, api_key, json_body))
        yield "Hello"
        yield ", "
        yield "world!"


class ProviderCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        store_path = Path(self.temp_dir.name) / "connections.json"
        self.store = ProviderConnectionStore(store_path)
        self.secrets = MockSecretStore()
        self.transport = MockTransport()
        self.connections = ProviderConnections(self.store, self.secrets, self.transport)

        # Create fixture connection
        self.connection = self.connections.create({
            "name": "Test Provider",
            "base_url": "http://127.0.0.1:1234/v1",
            "api_key": "sk-secret-key-12345",
            "enabled": True,
        })
        self.conn_id = self.connection["id"]

    def test_safe_provider_error_redacts_credentials(self):
        err1 = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token failed"
        redacted1 = safe_provider_error(err1)
        self.assertNotIn("eyJhbGci", redacted1)
        self.assertIn("[REDACTED]", redacted1)

        err2 = "Failed connecting to https://user:secretpass123@api.openai.com/v1?api_key=mysecret"
        redacted2 = safe_provider_error(err2)
        self.assertNotIn("secretpass123", redacted2)
        self.assertNotIn("mysecret", redacted2)
        self.assertIn("[REDACTED]", redacted2)

    def test_normalize_provider_base_url(self):
        norm1 = normalize_provider_base_url("http://127.0.0.1:1234/v1/chat/completions")
        self.assertEqual(norm1, "http://127.0.0.1:1234/v1")

        norm2 = normalize_provider_base_url("https://api.openai.com/v1/models")
        self.assertEqual(norm2, "https://api.openai.com/v1")

        norm3 = normalize_provider_base_url("http://localhost:8000/v1/")
        self.assertEqual(norm3, "http://localhost:8000/v1")

    def test_classify_model_role(self):
        self.assertEqual(classify_model_role("text-embedding-3-small"), "embedding")
        self.assertEqual(classify_model_role("bge-small-en-v1.5"), "embedding")
        self.assertEqual(classify_model_role("bge-reranker-large"), "rerank")
        self.assertEqual(classify_model_role("cross-encoder/ms-marco"), "rerank")
        self.assertEqual(classify_model_role("gpt-4o"), "llm")
        self.assertEqual(classify_model_role("llama-3.2-3b-instruct"), "llm")
        self.assertEqual(classify_model_role({"id": "custom", "type": "embedding"}), "embedding")
        self.assertEqual(classify_model_role({"id": "custom", "capabilities": {"rerank": True}}), "rerank")

    def test_list_provider_models_with_role_filter(self):
        all_models = list_provider_models(self.connections)
        self.assertEqual(len(all_models), 3)

        embed_models = list_provider_models(self.connections, role="embedding")
        self.assertEqual(len(embed_models), 1)
        self.assertEqual(embed_models[0]["provider_model_id"], "text-embedding-3-small")
        self.assertEqual(embed_models[0]["role"], "embedding")

        rerank_models = list_provider_models(self.connections, role="rerank")
        self.assertEqual(len(rerank_models), 1)
        self.assertEqual(rerank_models[0]["provider_model_id"], "bge-reranker-large")

        llm_models = list_provider_models(self.connections, role="llm")
        self.assertEqual(len(llm_models), 1)
        self.assertEqual(llm_models[0]["provider_model_id"], "gpt-4o-mini")

    def test_remote_embedder_batching_and_dimension(self):
        embedder = RemoteEmbedder(self.conn_id, "text-embedding-3-small", self.connections, max_batch_size=2)
        texts = ["apple", "banana", "cherry", "date", "elderberry"]
        embeddings = embedder.embed(texts)

        self.assertEqual(len(embeddings), 5)
        self.assertEqual(embedder.dimension, 3)
        self.assertEqual(len(embeddings[0]), 3)
        # Check batch requests were sent (3 batches for 5 items with max_batch_size=2)
        embed_requests = [r for r in self.transport.requests if r[2] == "/embeddings"]
        self.assertEqual(len(embed_requests), 3)

    def test_remote_embedder_rejects_nan_and_inf(self):
        self.transport.responses["/embeddings"] = ProviderResponse(200, {
            "data": [{"index": 0, "embedding": [0.1, float("nan"), 0.3]}]
        })
        embedder = RemoteEmbedder(self.conn_id, "text-embedding-3-small", self.connections)
        with self.assertRaises(ProviderError) as exc:
            embedder.embed(["bad input"])
        self.assertIn("NaN", str(exc.exception))

    def test_resolve_embedder_and_embed_texts_helper(self):
        # Explicit remote model
        model_id = f"provider:{self.conn_id}:text-embedding-3-small"
        embedder = resolve_embedder(model_id, self.connections)
        self.assertIsInstance(embedder, RemoteEmbedder)

        # Auto-discovery finds the embedding model
        auto_embedder = resolve_embedder(None, self.connections)
        self.assertIsInstance(auto_embedder, RemoteEmbedder)
        self.assertEqual(auto_embedder.model, "text-embedding-3-small")

        # Test embed_texts top-level function
        vectors = embed_texts(["test text"], model=model_id, provider_connections=self.connections)
        self.assertEqual(len(vectors), 1)
        self.assertEqual(len(vectors[0]), 3)

    def test_lexical_reranker(self):
        reranker = LexicalReranker()
        docs = [
            "The quick brown fox jumps over the lazy dog",
            "SQLite is a C-language library that implements a small SQL database engine",
            "Dogs and foxes are animals that jump",
        ]
        results = reranker.rank("SQLite SQL database", docs, top_k=2)
        self.assertEqual(len(results), 2)
        # SQLite doc should rank first
        self.assertEqual(results[0]["index"], 1)
        self.assertGreater(results[0]["score"], results[1]["score"])

    def test_remote_reranker(self):
        reranker = RemoteReranker(self.conn_id, "bge-reranker-large", self.connections)
        docs = ["Doc A", "Doc B", "Doc C"]
        results = reranker.rank("Query", docs, top_k=2)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["index"], 0)
        self.assertAlmostEqual(results[0]["score"], 0.9)

    def test_llm_reranker_with_tolerant_json_parsing(self):
        # Response with markdown fences
        self.transport.responses["/chat/completions"] = ProviderResponse(200, {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": '```json\n[{"index": 1, "score": 0.98}, {"index": 0, "score": 0.15}]\n```'
                }
            }]
        })
        reranker = LLMReranker(self.conn_id, "gpt-4o-mini", self.connections)
        docs = ["Introductory chapter", "Advanced database indexing and B-trees"]
        results = reranker.rank("database indexing", docs)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["index"], 1)
        self.assertAlmostEqual(results[0]["score"], 0.98)

    def test_chat_and_stream_chat_client(self):
        model_id = f"provider:{self.conn_id}:gpt-4o-mini"
        messages = [{"role": "user", "content": "Hello"}]

        # Non-streaming
        resp = chat(model_id, messages, provider_connections=self.connections, temperature=0.7)
        self.assertEqual(resp["message"]["content"], "Hello, world!")
        self.assertEqual(resp["model"], model_id)
        self.assertEqual(resp["usage"]["total_tokens"], 15)

        # Streaming
        stream = list(stream_chat(model_id, messages, provider_connections=self.connections))
        self.assertEqual("".join(stream), "Hello, world!")

    def test_parse_model_id(self):
        conn_id, p_model = parse_model_id(f"provider:{self.conn_id}:my-model")
        self.assertEqual(conn_id, self.conn_id)
        self.assertEqual(p_model, "my-model")

        local_conn, local_model = parse_model_id("llama-3.2-1b.gguf")
        self.assertIsNone(local_conn)
        self.assertEqual(local_model, "llama-3.2-1b.gguf")


class ProviderAPITests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        store_path = Path(self.temp_dir.name) / "connections.json"
        self.store = ProviderConnectionStore(store_path)
        self.secrets = MockSecretStore()
        self.transport = MockTransport()
        self.connections = ProviderConnections(self.store, self.secrets, self.transport)
        self.connection = self.connections.create({
            "name": "Test Provider",
            "base_url": "http://127.0.0.1:1234/v1",
            "api_key": "sk-secret-key-12345",
            "enabled": True,
        })
        self.conn_id = self.connection["id"]
        self.api = ProviderAPI(self.connections)

    def test_provider_api_embed(self):
        res = self.api.embed(["first doc", "second doc"], model=f"provider:{self.conn_id}:text-embedding-3-small")
        self.assertEqual(res["count"], 2)
        self.assertEqual(res["dimension"], 3)
        self.assertEqual(len(res["embeddings"]), 2)

    def test_provider_api_rerank(self):
        res = self.api.rerank("query", ["doc 1", "doc 2"], model=f"provider:{self.conn_id}:bge-reranker-large", top_k=1)
        self.assertEqual(res["count"], 1)
        self.assertEqual(res["results"][0]["index"], 0)

    def test_provider_api_chat(self):
        res = self.api.chat(f"provider:{self.conn_id}:gpt-4o-mini", [{"role": "user", "content": "Hi"}])
        self.assertEqual(res["message"]["content"], "Hello, world!")

    def test_provider_api_list_models_with_role(self):
        res = self.api.list_models(role="embedding")
        self.assertEqual(res["count"], 1)
        self.assertEqual(res["models"][0]["role"], "embedding")


class ProviderHTTPAPITests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        store_path = Path(self.temp_dir.name) / "connections.json"
        self.store = ProviderConnectionStore(store_path)
        self.secrets = MockSecretStore()
        self.transport = MockTransport()
        self.connections = ProviderConnections(self.store, self.secrets, self.transport)
        self.connection = self.connections.create({
            "name": "Test Provider",
            "base_url": "http://127.0.0.1:1234/v1",
            "api_key": "sk-secret-key-12345",
            "enabled": True,
        })
        self.conn_id = self.connection["id"]

        self.api = ReadOnlyAPI(provider_connections=self.connections)

    def test_get_providers_models_filtered_by_role(self):
        status, data = self.api.get("/api/providers/models", "role=embedding")
        self.assertEqual(status, 200)
        models = data["data"]["models"]
        self.assertEqual(len(models), 1)
        self.assertEqual(models[0]["provider_model_id"], "text-embedding-3-small")

    def test_capability_snapshot_reports_supported_when_provider_models_exist(self):
        status, data = self.api.get("/api/capabilities")
        self.assertEqual(status, 200)
        caps = {it["id"]: it for it in data["data"]["capabilities"]}
        self.assertEqual(caps["embedding.create"]["status"], "supported")
        self.assertEqual(caps["rerank.score"]["status"], "supported")
