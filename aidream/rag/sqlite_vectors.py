"""Schema-aware SQLite and Document vector indexing and similarity search.

Transforms relational database rows and text documents into rich semantic text
representations, generates vector embeddings in bounded batches, and indexes them
into Qdrant collections with source provenance and structured metadata.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import time
from typing import Any, Callable, Mapping, Sequence
import uuid

from aidream.rag.qdrant_adapter import QdrantAdapter, QdrantPoint, QdrantSearchResult


class VectorIndexError(RuntimeError):
    """Raised when vector indexing or search fails."""


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def generate_point_id(source_id: str, table: str, primary_key: Any, row_idx: int) -> str:
    """Generate a deterministic UUID string suitable for Qdrant point IDs."""
    seed = f"{source_id}:{table}:{primary_key}:{row_idx}"
    digest = hashlib.md5(seed.encode("utf-8")).digest()
    return str(uuid.UUID(bytes=digest))


def format_row_as_text(table_name: str, columns: Sequence[str], row_data: Mapping[str, Any]) -> str:
    """Render a table row into a structured, semantic textual representation."""
    parts = []
    for col in columns:
        val = row_data.get(col)
        if isinstance(val, (bytes, bytearray)):
            val_str = f"<binary {len(val)} bytes>"
        elif val is None:
            val_str = "null"
        elif isinstance(val, float) and not math.isfinite(val):
            val_str = str(val)
        else:
            val_str = json.dumps(val, ensure_ascii=False)
        parts.append(f"{col}: {val_str}")
    formatted = "; ".join(parts)
    return f"Table: {table_name}\nRecord: {formatted}"


def chunk_document_text(text: str, chunk_size: int = 600, overlap: int = 100) -> list[str]:
    """Split long document text into overlapping chunks for embedding."""
    clean = text.strip()
    if not clean:
        return []
    if len(clean) <= chunk_size:
        return [clean]

    chunks = []
    start = 0
    stride = max(50, chunk_size - overlap)
    while start < len(clean):
        end = min(start + chunk_size, len(clean))
        # Try to break on newline or sentence boundary near the end
        if end < len(clean):
            boundary = clean.rfind("\n", start + stride, end)
            if boundary == -1:
                boundary = clean.rfind(". ", start + stride, end)
                if boundary != -1:
                    boundary += 1
            if boundary != -1:
                end = boundary + 1
        chunk = clean[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += stride
    return chunks


def _emit_progress(cb: Any, payload: dict[str, Any], legacy_first: int, legacy_second: int, legacy_third: str) -> None:
    if not cb:
        return
    try:
        cb(payload)
    except TypeError:
        try:
            cb(legacy_first, legacy_second, legacy_third)
        except Exception:
            pass


def index_sqlite_source(
    db_path: str | Path,
    source_id: str,
    embedder: Callable[[list[str]], list[list[float]]],
    adapter: QdrantAdapter,
    *,
    batch_size: int = 64,
    max_rows_per_table: int = 10000,
    progress_callback: Callable[..., None] | None = None,
) -> dict[str, Any]:
    """Inspect and index all tables of a SQLite database into Qdrant vectors.

    Rows are extracted, converted to semantic representations, embedded in batches,
    and stored with full table and primary key metadata payloads with real-time ETA tracking.
    """
    path = Path(db_path).expanduser().resolve(strict=True)
    collection_name = adapter.collection_name_for_source(source_id)

    # Open SQLite read-only with safety pragmas
    conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA trusted_schema = OFF")

        # Discover tables (ignore sqlite_% and virtual tables)
        tables_res = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        tables = [row["name"] for row in tables_res]

        total_rows_est = 0
        for table in tables:
            try:
                cnt = conn.execute(f"SELECT COUNT(*) FROM {_quote_identifier(table)}").fetchone()[0]
                total_rows_est += min(cnt, max_rows_per_table)
            except Exception:
                pass

        start_time = time.time()
        total_rows_indexed = 0
        tables_indexed = []

        _emit_progress(
            progress_callback,
            {
                "phase": "indexing",
                "source_id": source_id,
                "current_table": tables[0] if tables else "",
                "done": 0,
                "total": total_rows_est,
                "percent": 0.0,
                "speed": 0.0,
                "eta_seconds": 0.0,
                "elapsed_seconds": 0.0,
                "unit": "filas",
            },
            0, len(tables), tables[0] if tables else ""
        )

        for table_idx, table in enumerate(tables):
            # Get table schema info
            info_rows = conn.execute(f"PRAGMA table_info({_quote_identifier(table)})").fetchall()
            if not info_rows:
                continue

            columns = [col["name"] for col in info_rows]
            pk_cols = [col["name"] for col in info_rows if col["pk"] > 0]

            # Read rows in batches
            cursor = conn.execute(
                f"SELECT * FROM {_quote_identifier(table)} LIMIT ?",
                (max_rows_per_table,),
            )

            batch_texts = []
            batch_points_meta = []
            table_row_idx = 0

            while True:
                rows = cursor.fetchmany(batch_size)
                if not rows:
                    break

                for row in rows:
                    row_dict = dict(row)
                    pk_val = (
                        ":".join(str(row_dict.get(c)) for c in pk_cols)
                        if pk_cols
                        else f"row_{table_row_idx}"
                    )
                    text = format_row_as_text(table, columns, row_dict)
                    pid = generate_point_id(source_id, table, pk_val, table_row_idx)

                    batch_texts.append(text)
                    batch_points_meta.append({
                        "id": pid,
                        "table": table,
                        "primary_key": pk_val,
                        "fields": row_dict,
                        "text": text,
                    })
                    table_row_idx += 1

                # Embed batch
                if batch_texts:
                    try:
                        embeddings = embedder(batch_texts)
                    except Exception as exc:
                        raise VectorIndexError(f"Embedding generation failed: {exc}") from exc

                    if len(embeddings) != len(batch_texts):
                        raise VectorIndexError(
                            f"Embedder returned {len(embeddings)} vectors for {len(batch_texts)} texts"
                        )

                    points = [
                        QdrantPoint(
                            id=meta["id"],
                            vector=embeddings[idx],
                            payload={
                                "source_id": source_id,
                                "table": meta["table"],
                                "primary_key": meta["primary_key"],
                                "text": meta["text"],
                                "fields": meta["fields"],
                            },
                        )
                        for idx, meta in enumerate(batch_points_meta)
                    ]

                    adapter.upsert_records(collection_name, points)
                    total_rows_indexed += len(points)
                    batch_texts.clear()
                    batch_points_meta.clear()

                    elapsed = max(0.001, time.time() - start_time)
                    speed = total_rows_indexed / elapsed
                    remaining = max(0, total_rows_est - total_rows_indexed)
                    eta = (remaining / speed) if speed > 0 else 0.0
                    pct = round(min(100.0, (total_rows_indexed / total_rows_est) * 100), 1) if total_rows_est > 0 else 100.0

                    _emit_progress(
                        progress_callback,
                        {
                            "phase": "indexing",
                            "source_id": source_id,
                            "current_table": table,
                            "table_index": table_idx + 1,
                            "total_tables": len(tables),
                            "done": total_rows_indexed,
                            "total": total_rows_est,
                            "percent": pct,
                            "speed": round(speed, 1),
                            "eta_seconds": round(eta, 1),
                            "elapsed_seconds": round(elapsed, 1),
                            "unit": "filas",
                        },
                        total_rows_indexed, len(tables), table
                    )

            tables_indexed.append(table)

        elapsed = max(0.001, time.time() - start_time)
        speed = total_rows_indexed / elapsed
        _emit_progress(
            progress_callback,
            {
                "phase": "completed",
                "source_id": source_id,
                "current_table": tables[-1] if tables else "",
                "done": total_rows_indexed,
                "total": total_rows_est,
                "percent": 100.0,
                "speed": round(speed, 1),
                "eta_seconds": 0.0,
                "elapsed_seconds": round(elapsed, 1),
                "unit": "filas",
            },
            total_rows_indexed, len(tables), tables[-1] if tables else ""
        )

        return {
            "source_id": source_id,
            "collection_name": collection_name,
            "tables_indexed": tables_indexed,
            "rows_indexed": total_rows_indexed,
            "elapsed_seconds": round(elapsed, 1),
        }
    finally:
        conn.close()


def search_sqlite_vectors(
    query: str,
    source_id: str,
    embedder: Callable[[list[str]], list[list[float]]],
    adapter: QdrantAdapter,
    *,
    limit: int = 10,
    table: str | None = None,
) -> list[dict[str, Any]]:
    """Perform semantic nearest neighbor search across vectorized SQLite rows."""
    if not query.strip():
        return []

    collection_name = adapter.collection_name_for_source(source_id)
    if not adapter.collection_exists(collection_name):
        return []

    query_vectors = embedder([query])
    if not query_vectors:
        return []

    filter_dict = {"source_id": source_id}
    if table:
        filter_dict["table"] = table

    results = adapter.search(collection_name, query_vectors[0], limit=limit, filter_dict=filter_dict)
    return [
        {
            "id": r.id,
            "score": round(r.score, 4),
            "table": r.payload.get("table"),
            "primary_key": r.payload.get("primary_key"),
            "text": r.payload.get("text"),
            "fields": r.payload.get("fields"),
        }
        for r in results
    ]


def index_knowledge_document(
    doc_id: str,
    doc_name: str,
    text: str,
    embedder: Callable[[list[str]], list[list[float]]],
    adapter: QdrantAdapter,
    *,
    collection_name: str = "aidream_documents",
    chunk_size: int = 600,
    chunk_overlap: int = 100,
    batch_size: int = 32,
    progress_callback: Callable[..., None] | None = None,
) -> dict[str, Any]:
    """Chunk and vectorize a knowledge document into Qdrant with real-time ETA tracking."""
    chunks = chunk_document_text(text, chunk_size=chunk_size, overlap=chunk_overlap)
    total_chunks = len(chunks)
    if not chunks:
        return {"document_id": doc_id, "chunks_indexed": 0, "collection_name": collection_name}

    start_time = time.time()
    points = []
    chunks_done = 0

    _emit_progress(
        progress_callback,
        {
            "phase": "indexing",
            "document_id": doc_id,
            "name": doc_name,
            "done": 0,
            "total": total_chunks,
            "percent": 0.0,
            "speed": 0.0,
            "eta_seconds": 0.0,
            "elapsed_seconds": 0.0,
            "unit": "bloques",
        },
        0, 1, doc_name
    )

    for start_idx in range(0, total_chunks, batch_size):
        batch = chunks[start_idx : start_idx + batch_size]
        try:
            batch_embeddings = embedder(batch)
        except Exception as exc:
            raise VectorIndexError(f"Embedding generation failed: {exc}") from exc

        if len(batch_embeddings) != len(batch):
            raise VectorIndexError(
                f"Embedder returned {len(batch_embeddings)} vectors for {len(batch)} chunks"
            )

        batch_points = [
            QdrantPoint(
                id=generate_point_id(doc_id, "document", start_idx + i, start_idx + i),
                vector=batch_embeddings[i],
                payload={
                    "document_id": doc_id,
                    "name": doc_name,
                    "chunk_index": start_idx + i,
                    "text": batch[i],
                },
            )
            for i in range(len(batch))
        ]

        adapter.upsert_records(collection_name, batch_points)
        chunks_done += len(batch_points)
        points.extend(batch_points)

        elapsed = max(0.001, time.time() - start_time)
        speed = chunks_done / elapsed
        remaining = max(0, total_chunks - chunks_done)
        eta = (remaining / speed) if speed > 0 else 0.0
        pct = round(min(100.0, (chunks_done / total_chunks) * 100), 1)

        _emit_progress(
            progress_callback,
            {
                "phase": "indexing",
                "document_id": doc_id,
                "name": doc_name,
                "done": chunks_done,
                "total": total_chunks,
                "percent": pct,
                "speed": round(speed, 1),
                "eta_seconds": round(eta, 1),
                "elapsed_seconds": round(elapsed, 1),
                "unit": "bloques",
            },
            chunks_done, 1, doc_name
        )

    elapsed = max(0.001, time.time() - start_time)
    speed = chunks_done / elapsed
    _emit_progress(
        progress_callback,
        {
            "phase": "completed",
            "document_id": doc_id,
            "name": doc_name,
            "done": chunks_done,
            "total": total_chunks,
            "percent": 100.0,
            "speed": round(speed, 1),
            "eta_seconds": 0.0,
            "elapsed_seconds": round(elapsed, 1),
            "unit": "bloques",
        },
        chunks_done, 1, doc_name
    )

    return {
        "document_id": doc_id,
        "name": doc_name,
        "chunks_indexed": len(points),
        "collection_name": collection_name,
        "elapsed_seconds": round(elapsed, 1),
    }


def search_knowledge_documents(
    query: str,
    embedder: Callable[[list[str]], list[list[float]]],
    adapter: QdrantAdapter,
    *,
    collection_name: str = "aidream_documents",
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Search vectorized knowledge documents for semantic relevance."""
    if not query.strip():
        return []
    if not adapter.collection_exists(collection_name):
        return []

    q_vecs = embedder([query])
    if not q_vecs:
        return []

    results = adapter.search(collection_name, q_vecs[0], limit=limit)
    return [
        {
            "id": r.id,
            "score": round(r.score, 4),
            "document_id": r.payload.get("document_id"),
            "name": r.payload.get("name"),
            "chunk_index": r.payload.get("chunk_index"),
            "text": r.payload.get("text"),
        }
        for r in results
    ]
