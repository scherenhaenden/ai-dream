"""Reranker models: Cross-Encoder, Remote /rerank, LLM-as-reranker, and Lexical fallback.

Provides high-precision re-scoring over candidate document and database row sets.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any, Mapping, Protocol

from aidream.providers.connections import ProviderConnections, ProviderConnectionError
from aidream.providers.discovery import list_provider_models
from aidream.providers.errors import ProviderError, ProviderResponseError, safe_provider_error


class Reranker(Protocol):
    """Protocol for candidate re-ranking engines."""

    def rank(
        self, query: str, documents: list[str], top_k: int | None = None
    ) -> list[dict[str, Any]]:
        ...


class LexicalReranker:
    """Zero-dependency lexical scorer using token overlap and BM25-style term weighting.

    Guarantees that a deterministic, offline ranking fallback is always available.
    """

    def rank(
        self, query: str, documents: list[str], top_k: int | None = None
    ) -> list[dict[str, Any]]:
        if not documents:
            return []
        query_tokens = [t.lower() for t in re.findall(r"\w+", query) if len(t) > 1]
        if not query_tokens:
            results = [{"index": idx, "document": doc, "score": 0.0} for idx, doc in enumerate(documents)]
            return results[:top_k] if top_k else results

        # Document frequencies
        doc_tokens_list = [
            [t.lower() for t in re.findall(r"\w+", doc)]
            for doc in documents
        ]
        num_docs = len(documents)
        df: dict[str, int] = {}
        for tokens in doc_tokens_list:
            unique = set(tokens)
            for qt in query_tokens:
                if qt in unique:
                    df[qt] = df.get(qt, 0) + 1

        scored = []
        for idx, (doc, tokens) in enumerate(zip(documents, doc_tokens_list)):
            doc_len = len(tokens)
            if doc_len == 0:
                scored.append({"index": idx, "document": doc, "score": 0.0})
                continue

            score = 0.0
            token_counts: dict[str, int] = {}
            for t in tokens:
                token_counts[t] = token_counts.get(t, 0) + 1

            for qt in query_tokens:
                tf = token_counts.get(qt, 0)
                if tf > 0:
                    idf = math.log(1.0 + (num_docs - df.get(qt, 0) + 0.5) / (df.get(qt, 0) + 0.5))
                    idf = max(0.1, idf)
                    # Simple BM25 term score
                    term_score = (tf * (1.2 + 1.0)) / (tf + 1.2 * (1.0 - 0.75 + 0.75 * (doc_len / 50.0)))
                    score += idf * term_score

            # Normalize to 0.0 - 1.0 sigmoid-like
            norm_score = 1.0 - (1.0 / (1.0 + score)) if score > 0 else 0.0
            scored.append({"index": idx, "document": doc, "score": round(norm_score, 4)})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_k] if top_k else scored


class RemoteReranker:
    """Remote reranker calling dedicated /rerank endpoint (e.g. Cohere, Jina)."""

    def __init__(
        self,
        connection_id: str,
        model: str,
        provider_connections: ProviderConnections | None = None,
    ):
        self.connection_id = connection_id
        self.model = model
        self.provider_connections = provider_connections or ProviderConnections()

    def rank(
        self, query: str, documents: list[str], top_k: int | None = None
    ) -> list[dict[str, Any]]:
        if not documents:
            return []
        payload: dict[str, Any] = {
            "model": self.model,
            "query": query,
            "documents": documents,
        }
        if top_k is not None:
            payload["top_n"] = top_k

        try:
            response = self.provider_connections.request(
                self.connection_id,
                "POST",
                "/rerank",
                json_body=payload,
            )
        except ProviderConnectionError as exc:
            raise ProviderError(str(exc)) from exc
        except Exception as exc:
            raise ProviderError(f"Rerank request failed: {safe_provider_error(exc)}") from exc

        if response.status < 200 or response.status >= 300:
            raise ProviderResponseError(
                f"Reranker provider returned HTTP {response.status}",
                status=response.status,
            )

        body = response.body
        items = body.get("results") if isinstance(body, Mapping) else None
        if not isinstance(items, list):
            raise ProviderError("Reranker response missing 'results' array")

        results = []
        for item in items:
            if not isinstance(item, Mapping):
                continue
            idx = item.get("index")
            score = item.get("relevance_score", item.get("score", 0.0))
            if isinstance(idx, int) and 0 <= idx < len(documents):
                results.append({
                    "index": idx,
                    "document": documents[idx],
                    "score": float(score),
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k] if top_k else results


class LLMReranker:
    """LLM-as-reranker with robust tolerant JSON parsing and lexical fallback."""

    def __init__(
        self,
        connection_id: str,
        model: str,
        provider_connections: ProviderConnections | None = None,
    ):
        self.connection_id = connection_id
        self.model = model
        self.provider_connections = provider_connections or ProviderConnections()
        self._fallback = LexicalReranker()

    def _parse_llm_json(self, content: str, doc_count: int) -> dict[int, float]:
        """Tolerantly extract ranking scores from LLM JSON response."""
        # Strip code markdown fences if present
        text = content.strip()
        fence_match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1).strip()
        else:
            array_match = re.search(r"\[\s*\{.*?\}\s*\]", text, re.DOTALL)
            if array_match:
                text = array_match.group(0).strip()

        scores: dict[int, float] = {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict) and "index" in item and "score" in item:
                        idx = int(item["index"])
                        score = float(item["score"])
                        if 0 <= idx < doc_count and math.isfinite(score):
                            scores[idx] = max(0.0, min(1.0, score))
        except (ValueError, TypeError, json.JSONDecodeError):
            pass
        return scores

    def rank(
        self, query: str, documents: list[str], top_k: int | None = None
    ) -> list[dict[str, Any]]:
        if not documents:
            return []

        doc_prompts = []
        for idx, doc in enumerate(documents):
            snippet = doc.replace("\n", " ").strip()
            if len(snippet) > 300:
                snippet = snippet[:297] + "..."
            doc_prompts.append(f"[{idx}]: {snippet}")

        prompt = (
            "You are an expert ranking model. Given a search query and a list of candidate documents, "
            "evaluate how relevant each document is to the query.\n"
            "Score each document between 0.0 (completely irrelevant) and 1.0 (highly relevant).\n"
            "Respond ONLY with a JSON array of objects in this exact format:\n"
            '[{"index": 0, "score": 0.95}, {"index": 1, "score": 0.1}]\n\n'
            f"Query: {query}\n\n"
            "Documents:\n" + "\n".join(doc_prompts)
        )

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are a concise reranking system that outputs valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 512,
        }

        parsed_scores: dict[int, float] = {}
        try:
            response = self.provider_connections.request(
                self.connection_id,
                "POST",
                "/chat/completions",
                json_body=payload,
            )
            if response.status == 200 and isinstance(response.body, Mapping):
                choices = response.body.get("choices")
                if isinstance(choices, list) and choices:
                    msg = choices[0].get("message", {})
                    content = msg.get("content", "")
                    parsed_scores = self._parse_llm_json(content, len(documents))
        except Exception:
            # Fall back gracefully to lexical reranker
            pass

        # If LLM parsing produced no results, fall back to lexical
        if not parsed_scores:
            return self._fallback.rank(query, documents, top_k)

        # Merge results, using lexical score for any missing docs
        lex_results = {it["index"]: it["score"] for it in self._fallback.rank(query, documents)}
        results = []
        for idx, doc in enumerate(documents):
            score = parsed_scores.get(idx, lex_results.get(idx, 0.0))
            results.append({"index": idx, "document": doc, "score": round(score, 4)})

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k] if top_k else results


class CrossEncoderReranker:
    """Local cross-encoder reranker using sentence-transformers."""

    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.model_name = model_name
        self._model: Any = None

    def _ensure_loaded(self) -> None:
        if self._model is None:
            try:
                from sentence_transformers import CrossEncoder
                self._model = CrossEncoder(self.model_name)
            except ImportError as exc:
                raise ProviderError(
                    "Local cross-encoder requires 'sentence-transformers'. "
                    "Install it or use a remote/lexical reranker.",
                    status=501,
                ) from exc

    def rank(
        self, query: str, documents: list[str], top_k: int | None = None
    ) -> list[dict[str, Any]]:
        if not documents:
            return []
        self._ensure_loaded()
        pairs = [[query, doc] for doc in documents]
        scores = self._model.predict(pairs)
        results = []
        for idx, (doc, score) in enumerate(zip(documents, scores)):
            norm_score = 1.0 / (1.0 + math.exp(-float(score)))  # sigmoid
            results.append({"index": idx, "document": doc, "score": round(norm_score, 4)})

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k] if top_k else results


def resolve_reranker(
    model_identifier: str | None = None,
    provider_connections: ProviderConnections | None = None,
) -> Reranker:
    """Resolve an appropriate Reranker implementation."""
    conns = provider_connections or ProviderConnections()

    if model_identifier and model_identifier.startswith("provider:"):
        parts = model_identifier.split(":", 2)
        if len(parts) == 3:
            connection_id, model_name = parts[1], parts[2]
            if "rerank" in model_name.lower():
                return RemoteReranker(connection_id, model_name, conns)
            return LLMReranker(connection_id, model_name, conns)

    if model_identifier is None:
        # Check if any provider has a reranker model
        rerank_models = list_provider_models(conns, role="rerank")
        if rerank_models:
            first = rerank_models[0]
            return RemoteReranker(first["connection_id"], first["provider_model_id"], conns)

        # Check for any chat model to use as LLM reranker
        chat_models = list_provider_models(conns, role="llm")
        if chat_models:
            first = chat_models[0]
            return LLMReranker(first["connection_id"], first["provider_model_id"], conns)

        return LexicalReranker()

    return LexicalReranker()


def rerank_candidates(
    query: str,
    documents: list[str],
    model: str | None = None,
    top_k: int | None = None,
    provider_connections: ProviderConnections | None = None,
) -> list[dict[str, Any]]:
    """Rerank candidate documents against a query."""
    reranker = resolve_reranker(model, provider_connections=provider_connections)
    return reranker.rank(query, documents, top_k=top_k)
