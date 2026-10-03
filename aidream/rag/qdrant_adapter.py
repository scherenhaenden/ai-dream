"""Qdrant vector store adapter with HTTP REST and local persistent fallback.

Provides single-interface vector storage, dimension validation, collection management,
and filtered similarity search for SQLite RAG and document knowledge embeddings.
Connects to an external Qdrant instance (e.g. http://localhost:6333) via standard REST,
or operates an embedded persistent vector store locally with zero external dependencies.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
from typing import Any, Mapping, Sequence
import urllib.error
import urllib.request
import uuid


@dataclass(frozen=True)
class QdrantConfig:
    """Connection configuration for Qdrant vector database."""
    url: str = ""  # e.g. "http://localhost:6333", empty string enables local fallback
    collection_prefix: str = "aidream"
    api_key: str = ""
    timeout: float = 10.0


@dataclass(frozen=True)
class QdrantPoint:
    """A point to be indexed in the vector store."""
    id: str
    vector: list[float]
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class QdrantSearchResult:
    """Result from a nearest neighbor vector similarity search."""
    id: str
    score: float
    payload: dict[str, Any]
    version: int = 0


def cosine_similarity(u: Sequence[float], v: Sequence[float]) -> float:
    """Compute cosine similarity between two numeric vectors."""
    dot = 0.0
    norm_u = 0.0
    norm_v = 0.0
    for a, b in zip(u, v):
        dot += a * b
        norm_u += a * a
        norm_v += b * b
    if norm_u <= 0.0 or norm_v <= 0.0:
        return 0.0
    return dot / (math.sqrt(norm_u) * math.sqrt(norm_v))


def sanitize_collection_name(name: str) -> str:
    """Sanitize name into a valid Qdrant collection name."""
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("-_")
    return clean[:63] if clean else "collection"


class QdrantAdapterError(RuntimeError):
    """Base error for Qdrant adapter operations."""


class DimensionMismatchError(QdrantAdapterError):
    """Raised when an embedding dimension does not match existing collection."""


class _LocalCollectionStore:
    """Thread-safe persistent local collection store using JSON + cosine similarity."""

    def __init__(self, storage_dir: Path):
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._collections: dict[str, dict[str, Any]] = {}
        self._load_all()

    def _file_for(self, name: str) -> Path:
        return self.storage_dir / f"{sanitize_collection_name(name)}.json"

    def _load_all(self) -> None:
        with self._lock:
            for item in self.storage_dir.glob("*.json"):
                try:
                    data = json.loads(item.read_text(encoding="utf-8"))
                    self._collections[data["name"]] = data
                except Exception:
                    pass

    def _save(self, name: str) -> None:
        with self._lock:
            data = self._collections.get(name)
            if data is not None:
                path = self._file_for(name)
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
                tmp.replace(path)

    def exists(self, name: str) -> bool:
        with self._lock:
            return name in self._collections

    def get_info(self, name: str) -> dict[str, Any] | None:
        with self._lock:
            col = self._collections.get(name)
            if not col:
                return None
            return {
                "name": col["name"],
                "vector_size": col["vector_size"],
                "points_count": len(col["points"]),
            }

    def create(self, name: str, vector_size: int) -> None:
        with self._lock:
            if name in self._collections:
                return
            self._collections[name] = {
                "name": name,
                "vector_size": vector_size,
                "points": {},  # point_id -> {"vector": [...], "payload": {...}}
            }
            self._save(name)

    def upsert(self, name: str, points: Sequence[QdrantPoint]) -> int:
        with self._lock:
            col = self._collections.get(name)
            if col is None:
                raise QdrantAdapterError(f"Collection '{name}' does not exist")
            v_size = col["vector_size"]
            for pt in points:
                if len(pt.vector) != v_size:
                    raise DimensionMismatchError(
                        f"Point dimension {len(pt.vector)} does not match collection size {v_size}"
                    )
                col["points"][str(pt.id)] = {
                    "vector": [float(x) for x in pt.vector],
                    "payload": pt.payload,
                }
            self._save(name)
            return len(points)

    def search(
        self,
        name: str,
        query_vector: Sequence[float],
        limit: int = 10,
        filter_dict: Mapping[str, Any] | None = None,
    ) -> list[QdrantSearchResult]:
        with self._lock:
            col = self._collections.get(name)
            if col is None:
                return []
            q_vec = [float(x) for x in query_vector]
            results: list[tuple[float, str, dict[str, Any]]] = []

            for pid, pdata in col["points"].items():
                payload = pdata["payload"]
                if filter_dict:
                    match = True
                    for k, v in filter_dict.items():
                        if payload.get(k) != v:
                            match = False
                            break
                    if not match:
                        continue
                score = cosine_similarity(q_vec, pdata["vector"])
                results.append((score, pid, payload))

            results.sort(key=lambda item: item[0], reverse=True)
            top = results[:limit]
            return [
                QdrantSearchResult(id=pid, score=score, payload=payload)
                for score, pid, payload in top
            ]

    def delete_by_filter(self, name: str, filter_dict: Mapping[str, Any]) -> int:
        with self._lock:
            col = self._collections.get(name)
            if col is None or not filter_dict:
                return 0
            to_delete = []
            for pid, pdata in col["points"].items():
                payload = pdata["payload"]
                match = True
                for k, v in filter_dict.items():
                    if payload.get(k) != v:
                        match = False
                        break
                if match:
                    to_delete.append(pid)
            for pid in to_delete:
                del col["points"][pid]
            if to_delete:
                self._save(name)
            return len(to_delete)

    def delete_collection(self, name: str) -> bool:
        with self._lock:
            if name in self._collections:
                del self._collections[name]
                path = self._file_for(name)
                if path.exists():
                    try:
                        path.unlink()
                    except OSError:
                        pass
                return True
            return False


class QdrantAdapter:
    """Unified adapter supporting both Qdrant HTTP REST and local embedded vector storage."""

    def __init__(
        self,
        config: QdrantConfig | None = None,
        *,
        base_dir: str | Path | None = None,
    ):
        self.config = config or QdrantConfig()
        storage_base = Path(base_dir or (Path.home() / ".local/share/ai-dream/vector_store")).expanduser()
        self._local_store = _LocalCollectionStore(storage_base / "qdrant")
        self._remote_url = self.config.url.rstrip("/") if self.config.url else ""

    def _is_remote_active(self) -> bool:
        if not self._remote_url:
            return False
        try:
            req = urllib.request.Request(
                f"{self._remote_url}/collections",
                headers={"User-Agent": "AI-Dream-RAG/0.1"},
                method="GET",
            )
            if self.config.api_key:
                req.add_header("api-key", self.config.api_key)
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def _remote_request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self._remote_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "AI-Dream-RAG/0.1"},
            method=method,
        )
        if self.config.api_key:
            req.add_header("api-key", self.config.api_key)

        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8")) if raw else {}
        except urllib.error.HTTPError as exc:
            msg = exc.read().decode("utf-8", errors="ignore")
            raise QdrantAdapterError(f"Qdrant HTTP {exc.code}: {msg}") from exc
        except Exception as exc:
            raise QdrantAdapterError(f"Qdrant connection error: {exc}") from exc

    def collection_name_for_source(self, source_id: str) -> str:
        """Generate deterministic collection name for a given source."""
        slug = sanitize_collection_name(f"{self.config.collection_prefix}_{source_id}")
        return slug

    def collection_exists(self, name: str) -> bool:
        """Check whether a collection exists."""
        if self._is_remote_active():
            try:
                res = self._remote_request("GET", f"/collections/{name}")
                return res.get("status") == "ok"
            except QdrantAdapterError:
                return False
        return self._local_store.exists(name)

    def get_collection_info(self, name: str) -> dict[str, Any] | None:
        """Retrieve vector dimension and point count for a collection."""
        if self._is_remote_active():
            try:
                res = self._remote_request("GET", f"/collections/{name}")
                result = res.get("result", {})
                params = result.get("config", {}).get("params", {})
                vectors = params.get("vectors", {})
                size = vectors.get("size") if isinstance(vectors, dict) else None
                points_count = result.get("points_count", 0)
                return {
                    "name": name,
                    "vector_size": size,
                    "points_count": points_count,
                }
            except QdrantAdapterError:
                return None
        return self._local_store.get_info(name)

    def ensure_collection(self, name: str, vector_size: int, distance: str = "Cosine") -> str:
        """Create collection if absent, or validate matching dimension."""
        if vector_size < 1:
            raise ValueError("vector_size must be a positive integer")

        info = self.get_collection_info(name)
        if info is not None:
            existing = info.get("vector_size")
            if existing is not None and existing != vector_size:
                raise DimensionMismatchError(
                    f"Collection '{name}' has vector dimension {existing}, but input has dimension {vector_size}"
                )
            return name

        if self._is_remote_active():
            payload = {
                "vectors": {
                    "size": vector_size,
                    "distance": distance,
                }
            }
            self._remote_request("PUT", f"/collections/{name}", payload)
            return name

        self._local_store.create(name, vector_size)
        return name

    def upsert_records(
        self,
        name: str,
        points: Sequence[QdrantPoint],
        *,
        vector_size: int | None = None,
    ) -> int:
        """Upsert points into the collection, ensuring vector size matches."""
        if not points:
            return 0
        v_size = vector_size or len(points[0].vector)
        self.ensure_collection(name, v_size)

        if self._is_remote_active():
            remote_points = [
                {
                    "id": pt.id,
                    "vector": pt.vector,
                    "payload": pt.payload,
                }
                for pt in points
            ]
            payload = {"points": remote_points}
            self._remote_request("PUT", f"/collections/{name}/points?wait=true", payload)
            return len(points)

        return self._local_store.upsert(name, points)

    def search(
        self,
        name: str,
        query_vector: Sequence[float],
        limit: int = 10,
        filter_dict: Mapping[str, Any] | None = None,
    ) -> list[QdrantSearchResult]:
        """Search nearest neighbor points in collection."""
        if not query_vector:
            return []

        if self._is_remote_active():
            must_clauses = []
            if filter_dict:
                for k, v in filter_dict.items():
                    must_clauses.append({"key": k, "match": {"value": v}})
            body: dict[str, Any] = {
                "vector": list(query_vector),
                "limit": limit,
                "with_payload": True,
            }
            if must_clauses:
                body["filter"] = {"must": must_clauses}

            res = self._remote_request("POST", f"/collections/{name}/points/search", body)
            hits = res.get("result", [])
            return [
                QdrantSearchResult(
                    id=str(h.get("id")),
                    score=float(h.get("score", 0.0)),
                    payload=h.get("payload", {}),
                    version=h.get("version", 0),
                )
                for h in hits
            ]

        return self._local_store.search(name, query_vector, limit=limit, filter_dict=filter_dict)

    def delete_by_filter(self, name: str, filter_dict: Mapping[str, Any]) -> int:
        """Delete points matching specific payload filter."""
        if self._is_remote_active():
            must_clauses = []
            for k, v in filter_dict.items():
                must_clauses.append({"key": k, "match": {"value": v}})
            body = {"filter": {"must": must_clauses}}
            self._remote_request("POST", f"/collections/{name}/points/delete?wait=true", body)
            return 1
        return self._local_store.delete_by_filter(name, filter_dict)

    def delete_collection(self, name: str) -> bool:
        """Drop collection entirely."""
        if self._is_remote_active():
            try:
                self._remote_request("DELETE", f"/collections/{name}")
                return True
            except QdrantAdapterError:
                return False
        return self._local_store.delete_collection(name)
