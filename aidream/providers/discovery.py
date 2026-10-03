"""Role-aware provider model discovery and URL normalization.

Discovers and classifies models by role:
- 'llm': Chat / text generation models
- 'embedding': Text embedding models (e.g. bge, minilm, text-embedding-3)
- 'rerank': Reranker / cross-encoder models (e.g. bge-reranker)
"""
from __future__ import annotations

import re
from typing import Any, Mapping
from urllib.parse import urlsplit, urlunsplit

from aidream.providers.connections import ProviderConnections, validate_base_url

_EMBED_PATTERNS = re.compile(
    r"(?i)\b(embed|embedding|bge-(?:small|base|large|m3)|e5-(?:small|base|large)|gte-(?:small|base|large)|minilm|nomic-embed|paraphrase)\b|"
    r"text-embedding"
)
_RERANK_PATTERNS = re.compile(
    r"(?i)\b(rerank|reranker|bge-reranker|cross-encoder|cohere-rerank)\b"
)
_LLM_PATTERNS = re.compile(
    r"(?i)\b(chat|instruct|gpt|claude|llama|qwen|mistral|gemma|deepseek|phi|command)\b"
)

# Endpoints users often mistakenly append when copying URLs from documentation
_STRIP_ENDPOINTS = (
    "/chat/completions",
    "/completions",
    "/embeddings",
    "/models",
    "/rerank",
)


def normalize_provider_base_url(url: str) -> str:
    """Normalize a provider URL by stripping extraneous endpoint paths and trailing slashes.

    Examples:
        http://localhost:1234/v1/chat/completions -> http://localhost:1234/v1
        http://127.0.0.1:11434/v1/models          -> http://127.0.0.1:11434/v1
    """
    if not isinstance(url, str):
        raise ValueError("url must be a string")
    clean = url.strip()
    for endpoint in _STRIP_ENDPOINTS:
        if clean.endswith(endpoint):
            clean = clean[:-len(endpoint)]
            break
    clean = clean.rstrip("/")
    return validate_base_url(clean)


def classify_model_role(model_info: str | Mapping[str, Any]) -> str:
    """Classify model role as 'embedding', 'rerank', or 'llm'.

    Inspects metadata if available (e.g. LM Studio native type, capabilities),
    falling back to model name heuristics.
    """
    if isinstance(model_info, Mapping):
        # 1. Explicit type or capabilities declarations
        explicit_type = str(model_info.get("type") or "").strip().lower()
        if explicit_type in {"embedding", "embeddings"}:
            return "embedding"
        if explicit_type in {"rerank", "reranker", "cross-encoder"}:
            return "rerank"
        if explicit_type in {"llm", "chat", "text"}:
            return "llm"

        caps = model_info.get("capabilities")
        if isinstance(caps, Mapping):
            if caps.get("embeddings") is True:
                return "embedding"
            if caps.get("rerank") is True:
                return "rerank"
            if caps.get("chat") is True or caps.get("text") is True:
                return "llm"

        name_to_check = str(model_info.get("id") or model_info.get("name") or "")
    else:
        name_to_check = str(model_info or "")

    name_lower = name_to_check.lower()

    if _RERANK_PATTERNS.search(name_lower):
        return "rerank"
    if _EMBED_PATTERNS.search(name_lower):
        return "embedding"
    return "llm"


def list_provider_models(
    provider_connections: ProviderConnections,
    connection_id: str | None = None,
    role: str | None = None,
) -> list[dict[str, Any]]:
    """List remote models enriched with classified roles, optionally filtered by role."""
    data = provider_connections.models(connection_id)
    models = data.get("models", [])
    result = []
    for item in models:
        enriched = dict(item)
        classified_role = classify_model_role(item)
        enriched["role"] = classified_role
        if role is not None and classified_role != role.lower().strip():
            continue
        result.append(enriched)
    return result
