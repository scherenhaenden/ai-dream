"""Text embedding providers: remote OpenAI-compatible and local sentence-transformers.

Validates vector dimensions, rejects non-finite/NaN/Inf numbers, batches long
inputs, and enforces pinned-socket SSRF protection for remote providers.
"""
from __future__ import annotations

import math
from typing import Any, Mapping, Protocol

from aidream.providers.connections import ProviderConnections, ProviderConnectionError
from aidream.providers.discovery import list_provider_models
from aidream.providers.errors import (
    ProviderError,
    ProviderModelNotFoundError,
    ProviderResponseError,
    safe_provider_error,
)


class Embedder(Protocol):
    """Protocol for embedding generation engines."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    @property
    def dimension(self) -> int | None:
        ...


def _validate_vector(vector: Any, expected_dim: int | None = None) -> list[float]:
    """Validate that vector is a non-empty list of finite float numbers."""
    if not isinstance(vector, (list, tuple)) or not vector:
        raise ProviderError("Provider returned an empty or invalid embedding vector")
    if expected_dim is not None and len(vector) != expected_dim:
        raise ProviderError(
            f"Embedding vector dimension mismatch: expected {expected_dim}, got {len(vector)}"
        )
    result = []
    for val in vector:
        if not isinstance(val, (int, float)) or not math.isfinite(val):
            raise ProviderError("Embedding vector contains NaN, Inf, or non-numeric values")
        result.append(float(val))
    return result


class RemoteEmbedder:
    """Remote OpenAI-compatible embedding client via ProviderConnections."""

    def __init__(
        self,
        connection_id: str,
        model: str,
        provider_connections: ProviderConnections | None = None,
        max_batch_size: int = 32,
    ):
        self.connection_id = connection_id
        self.model = model
        self.provider_connections = provider_connections or ProviderConnections()
        self.max_batch_size = max(1, min(max_batch_size, 128))
        self._dimension: int | None = None

    @property
    def dimension(self) -> int | None:
        return self._dimension

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        for idx, text in enumerate(texts):
            if not isinstance(text, str):
                raise ProviderError(f"Input text at index {idx} must be a string")

        all_embeddings: list[list[float]] = []

        # Process in batches
        for i in range(0, len(texts), self.max_batch_size):
            batch = texts[i : i + self.max_batch_size]
            payload = {"model": self.model, "input": batch}

            try:
                response = self.provider_connections.request(
                    self.connection_id,
                    "POST",
                    "/embeddings",
                    json_body=payload,
                )
            except ProviderConnectionError as exc:
                raise ProviderError(str(exc)) from exc
            except Exception as exc:
                raise ProviderError(f"Embedding request failed: {safe_provider_error(exc)}") from exc

            if response.status < 200 or response.status >= 300:
                raise ProviderResponseError(
                    f"Embedding provider returned HTTP {response.status}",
                    status=response.status,
                )

            body = response.body
            if not isinstance(body, Mapping) or not isinstance(body.get("data"), list):
                raise ProviderError("Embedding provider returned invalid response structure (missing 'data' list)")

            items = body["data"]
            if len(items) != len(batch):
                raise ProviderError(
                    f"Embedding count mismatch: sent {len(batch)} texts, received {len(items)} vectors"
                )

            # OpenAI embeds usually contain an "index" field; sort if present
            if all(isinstance(it, Mapping) and "index" in it for it in items):
                items = sorted(items, key=lambda x: x.get("index", 0))

            for item in items:
                if not isinstance(item, Mapping) or "embedding" not in item:
                    raise ProviderError("Embedding response item missing 'embedding' vector")
                vector = _validate_vector(item["embedding"], expected_dim=self._dimension)
                if self._dimension is None:
                    self._dimension = len(vector)
                all_embeddings.append(vector)

        return all_embeddings


class LocalSentenceTransformerEmbedder:
    """Local embedding using sentence-transformers when installed."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self.model_name = model_name
        self._model: Any = None
        self._dimension: int | None = None

    def _ensure_loaded(self) -> None:
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(self.model_name)
                self._dimension = self._model.get_sentence_embedding_dimension()
            except ImportError as exc:
                raise ProviderError(
                    "Local embedding requires the 'sentence-transformers' package. "
                    "Install it or configure a remote provider embedding model.",
                    status=501,
                ) from exc

    @property
    def dimension(self) -> int | None:
        if self._dimension is None:
            try:
                self._ensure_loaded()
            except Exception:
                pass
        return self._dimension

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        self._ensure_loaded()
        embeddings = self._model.encode(texts, convert_to_numpy=True)
        results = []
        for vec in embeddings:
            validated = _validate_vector(vec.tolist(), expected_dim=self._dimension)
            results.append(validated)
        return results


def resolve_embedder(
    model_identifier: str | None = None,
    provider_connections: ProviderConnections | None = None,
) -> Embedder:
    """Resolve an Embedder implementation based on model identifier.

    If model_identifier starts with 'provider:<connection_id>:<model_name>', returns RemoteEmbedder.
    If None, discovers the first available provider embedding model, or falls back to local.
    """
    conns = provider_connections or ProviderConnections()

    if model_identifier and model_identifier.startswith("provider:"):
        parts = model_identifier.split(":", 2)
        if len(parts) != 3:
            raise ProviderError("Invalid remote model identifier format (expected 'provider:<connection_id>:<model_id>')")
        connection_id, model_name = parts[1], parts[2]
        return RemoteEmbedder(connection_id, model_name, conns)

    if model_identifier is None:
        # Check if any enabled provider has an embedding model
        embedding_models = list_provider_models(conns, role="embedding")
        if embedding_models:
            first = embedding_models[0]
            conn_id = first["connection_id"]
            p_model = first["provider_model_id"]
            return RemoteEmbedder(conn_id, p_model, conns)
        return LocalSentenceTransformerEmbedder()

    # Local model name
    return LocalSentenceTransformerEmbedder(model_identifier)


def embed_texts(
    texts: list[str],
    model: str | None = None,
    provider_connections: ProviderConnections | None = None,
) -> list[list[float]]:
    """Embed texts using the specified or auto-resolved embedder."""
    embedder = resolve_embedder(model, provider_connections=provider_connections)
    return embedder.embed(texts)
