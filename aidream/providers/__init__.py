"""Unified inference, embedding, reranking, and discovery core for local and remote LLM providers."""
from __future__ import annotations

from aidream.providers.api import ProviderAPI, ProviderAPIError
from aidream.providers.client import chat, parse_model_id, stream_chat
from aidream.providers.connections import (
    OSKeyringSecretStore,
    OpenAICompatibleTransport,
    ProviderConnectionError,
    ProviderConnectionNotFound,
    ProviderConnectionStore,
    ProviderConnections,
    ProviderResponse,
    ProviderTransport,
    SecretStore,
    SecretStoreUnavailable,
    validate_base_url,
)
from aidream.providers.discovery import (
    classify_model_role,
    list_provider_models,
    normalize_provider_base_url,
)
from aidream.providers.embeddings import (
    Embedder,
    LocalSentenceTransformerEmbedder,
    RemoteEmbedder,
    embed_texts,
    resolve_embedder,
)
from aidream.providers.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderModelNotFoundError,
    ProviderResponseError,
    ProviderTimeoutError,
    safe_provider_error,
)
from aidream.providers.rerank import (
    CrossEncoderReranker,
    LLMReranker,
    LexicalReranker,
    RemoteReranker,
    Reranker,
    rerank_candidates,
    resolve_reranker,
)

__all__ = [
    "CrossEncoderReranker",
    "Embedder",
    "LLMReranker",
    "LexicalReranker",
    "LocalSentenceTransformerEmbedder",
    "OSKeyringSecretStore",
    "OpenAICompatibleTransport",
    "ProviderAPI",
    "ProviderAPIError",
    "ProviderAuthError",
    "ProviderConnectionError",
    "ProviderConnectionNotFound",
    "ProviderConnectionStore",
    "ProviderConnections",
    "ProviderError",
    "ProviderModelNotFoundError",
    "ProviderResponse",
    "ProviderResponseError",
    "ProviderTimeoutError",
    "ProviderTransport",
    "RemoteEmbedder",
    "RemoteReranker",
    "Reranker",
    "SecretStore",
    "SecretStoreUnavailable",
    "chat",
    "classify_model_role",
    "embed_texts",
    "list_provider_models",
    "normalize_provider_base_url",
    "parse_model_id",
    "rerank_candidates",
    "resolve_embedder",
    "resolve_reranker",
    "safe_provider_error",
    "stream_chat",
    "validate_base_url",
]
