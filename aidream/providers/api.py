"""Transport-neutral control plane for provider operations.

Handles model discovery by role, embedding generation, reranking, and chat
completion with validated parameters and safe error mapping.
"""
from __future__ import annotations

from typing import Any, Mapping

from aidream.providers.client import chat, parse_model_id
from aidream.providers.connections import ProviderConnections
from aidream.providers.discovery import list_provider_models
from aidream.providers.embeddings import embed_texts, resolve_embedder
from aidream.providers.errors import ProviderError
from aidream.providers.rerank import rerank_candidates, resolve_reranker

MAX_EMBED_TEXTS = 512
MAX_RERANK_DOCS = 256


class ProviderAPIError(Exception):
    """Transport-neutral API error with HTTP-compatible status code."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def to_dict(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "status": self.status}}


class ProviderAPI:
    """Control plane for remote/local model inference, embeddings, and reranking."""

    def __init__(self, provider_connections: ProviderConnections | None = None):
        self.connections = provider_connections or ProviderConnections()

    def test_connection(self, connection_id: str) -> dict[str, Any]:
        try:
            return self.connections.test(connection_id)
        except Exception as exc:
            status = getattr(exc, "status", 400)
            raise ProviderAPIError(status, "connection_test_failed", str(exc)) from exc

    def list_models(
        self, connection_id: str | None = None, role: str | None = None
    ) -> dict[str, Any]:
        try:
            models = list_provider_models(self.connections, connection_id=connection_id, role=role)
            return {"models": models, "count": len(models)}
        except Exception as exc:
            status = getattr(exc, "status", 400)
            raise ProviderAPIError(status, "list_models_failed", str(exc)) from exc

    def embed(self, texts: list[str], model: str | None = None) -> dict[str, Any]:
        if not isinstance(texts, list):
            raise ProviderAPIError(400, "invalid_input", "'texts' must be a list of strings")
        if not texts:
            return {"embeddings": [], "dimension": None, "count": 0}
        if len(texts) > MAX_EMBED_TEXTS:
            raise ProviderAPIError(
                400,
                "payload_too_large",
                f"Cannot embed more than {MAX_EMBED_TEXTS} texts in a single request",
            )
        for idx, text in enumerate(texts):
            if not isinstance(text, str):
                raise ProviderAPIError(400, "invalid_input", f"Text at index {idx} must be a string")

        try:
            embedder = resolve_embedder(model, provider_connections=self.connections)
            embeddings = embedder.embed(texts)
            dimension = embedder.dimension or (len(embeddings[0]) if embeddings else None)
            return {
                "embeddings": embeddings,
                "dimension": dimension,
                "count": len(embeddings),
                "model": model or "auto",
            }
        except ProviderError as exc:
            raise ProviderAPIError(exc.status, exc.code, exc.message) from exc
        except Exception as exc:
            status = getattr(exc, "status", 500)
            raise ProviderAPIError(status, "embed_failed", str(exc)) from exc

    def rerank(
        self,
        query: str,
        documents: list[str],
        model: str | None = None,
        top_k: int | None = None,
    ) -> dict[str, Any]:
        if not isinstance(query, str) or not query.strip():
            raise ProviderAPIError(400, "invalid_input", "'query' must be a non-empty string")
        if not isinstance(documents, list):
            raise ProviderAPIError(400, "invalid_input", "'documents' must be a list of strings")
        if len(documents) > MAX_RERANK_DOCS:
            raise ProviderAPIError(
                400,
                "payload_too_large",
                f"Cannot rerank more than {MAX_RERANK_DOCS} documents in a single request",
            )
        for idx, doc in enumerate(documents):
            if not isinstance(doc, str):
                raise ProviderAPIError(400, "invalid_input", f"Document at index {idx} must be a string")

        try:
            results = rerank_candidates(
                query, documents, model=model, top_k=top_k, provider_connections=self.connections
            )
            return {
                "results": results,
                "count": len(results),
                "model": model or "auto",
            }
        except ProviderError as exc:
            raise ProviderAPIError(exc.status, exc.code, exc.message) from exc
        except Exception as exc:
            status = getattr(exc, "status", 500)
            raise ProviderAPIError(status, "rerank_failed", str(exc)) from exc

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        **options: Any,
    ) -> dict[str, Any]:
        if not isinstance(model, str) or not model.strip():
            raise ProviderAPIError(400, "invalid_input", "'model' must be a non-empty string")
        if not isinstance(messages, list) or not messages:
            raise ProviderAPIError(400, "invalid_input", "'messages' must be a non-empty list")

        try:
            return chat(model, messages, provider_connections=self.connections, **options)
        except ProviderError as exc:
            raise ProviderAPIError(exc.status, exc.code, exc.message) from exc
        except Exception as exc:
            status = getattr(exc, "status", 500)
            raise ProviderAPIError(status, "chat_failed", str(exc)) from exc
