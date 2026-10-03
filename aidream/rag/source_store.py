"""Storage and lifecycle management for SQLite knowledge sources.

Handles streaming ingestion, schema profiling, schema card generation,
and query execution over retained local SQLite databases.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from typing import Any
import uuid

from aidream.rag.sqlite_inspector import (
    MAX_SQLITE_FILE_BYTES,
    SQLiteInspectorError,
    SQLiteProfile,
    compute_file_sha256,
    generate_schema_card,
    inspect_sqlite_database,
    is_sqlite_file,
    safe_sqlite_query,
)


class SourceStoreError(ValueError):
    """Raised on invalid source storage operations."""


class SQLiteSourceStore:
    """Manages uploaded SQLite databases and their profiles."""

    def __init__(self, base_dir: str | Path, *, knowledge_index=None):
        self.base_dir = Path(base_dir).expanduser().resolve()
        self.sources_dir = self.base_dir / "sources"
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.knowledge_index = knowledge_index

    def save_sqlite_source(
        self,
        file_name: str,
        source_stream_or_path: Any,
        *,
        source_id: str | None = None,
        register_schema_card: bool = True,
    ) -> dict[str, Any]:
        """Ingest a SQLite file from a path or stream in bounded chunks and profile it."""
        sid = source_id or uuid.uuid4().hex
        source_dir = self.sources_dir / sid
        source_dir.mkdir(parents=True, exist_ok=True)
        target_path = source_dir / "database.sqlite"

        # Stream chunked copy
        total_bytes = 0
        try:
            if isinstance(source_stream_or_path, (str, Path)):
                src_path = Path(source_stream_or_path).expanduser().resolve(strict=True)
                with open(src_path, "rb") as src, open(target_path, "wb") as dst:
                    while chunk := src.read(65536):
                        total_bytes += len(chunk)
                        if total_bytes > MAX_SQLITE_FILE_BYTES:
                            raise SourceStoreError(
                                f"File exceeds maximum allowed size of {MAX_SQLITE_FILE_BYTES // (1024 * 1024)} MiB"
                            )
                        dst.write(chunk)
            elif hasattr(source_stream_or_path, "read"):
                with open(target_path, "wb") as dst:
                    while chunk := source_stream_or_path.read(65536):
                        total_bytes += len(chunk)
                        if total_bytes > MAX_SQLITE_FILE_BYTES:
                            raise SourceStoreError(
                                f"File exceeds maximum allowed size of {MAX_SQLITE_FILE_BYTES // (1024 * 1024)} MiB"
                            )
                        dst.write(chunk)
            elif isinstance(source_stream_or_path, (bytes, bytearray)):
                if len(source_stream_or_path) > MAX_SQLITE_FILE_BYTES:
                    raise SourceStoreError("File exceeds maximum allowed size")
                target_path.write_bytes(source_stream_or_path)
                total_bytes = len(source_stream_or_path)
            else:
                raise SourceStoreError("Unsupported source_stream_or_path input")

            if not is_sqlite_file(target_path):
                raise SourceStoreError("Supplied content is not a valid SQLite database file")

            # Profile database
            profile = inspect_sqlite_database(target_path)
            # Override filename with provided name
            profile.file_name = file_name
            schema_card = generate_schema_card(profile)

            # Register schema card to knowledge index if provided
            knowledge_doc_id = None
            if register_schema_card and self.knowledge_index is not None:
                try:
                    doc_name = f"{Path(file_name).stem}_schema.md"
                    doc = self.knowledge_index.add_document(
                        doc_name,
                        schema_card.encode("utf-8"),
                    )
                    knowledge_doc_id = doc.get("id")
                except Exception:
                    # Non-fatal if knowledge index bounds exceeded
                    pass

            meta = {
                "source_id": sid,
                "file_name": file_name,
                "size_bytes": total_bytes,
                "sha256": profile.sha256,
                "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "profile": profile.to_dict(),
                "schema_card": schema_card,
                "knowledge_doc_id": knowledge_doc_id,
            }

            meta_file = source_dir / "metadata.json"
            meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
            return meta
        except Exception:
            # Clean up on failure
            if source_dir.exists():
                shutil.rmtree(source_dir, ignore_errors=True)
            raise

    def list_sources(self) -> list[dict[str, Any]]:
        """List all stored SQLite sources and their metadata."""
        results = []
        if not self.sources_dir.exists():
            return results
        for item in sorted(self.sources_dir.iterdir()):
            if item.is_dir():
                meta_file = item / "metadata.json"
                if meta_file.is_file():
                    try:
                        data = json.loads(meta_file.read_text(encoding="utf-8"))
                        results.append(data)
                    except Exception:
                        pass
        return results

    def get_source(self, source_id: str) -> dict[str, Any] | None:
        """Retrieve metadata for a specific source."""
        source_dir = self.sources_dir / source_id
        meta_file = source_dir / "metadata.json"
        if not meta_file.is_file():
            return None
        return json.loads(meta_file.read_text(encoding="utf-8"))

    def get_database_path(self, source_id: str) -> Path | None:
        """Return the filesystem path to the stored SQLite database."""
        source_dir = self.sources_dir / source_id
        db_path = source_dir / "database.sqlite"
        if db_path.is_file():
            return db_path
        return None

    def update_source_meta(self, source_id: str, updates: Mapping[str, Any]) -> dict[str, Any]:
        """Update metadata fields for a stored SQLite source."""
        source_dir = self.sources_dir / source_id
        meta_file = source_dir / "metadata.json"
        if not meta_file.is_file():
            raise SourceStoreError(f"Database source {source_id} not found")
        data = json.loads(meta_file.read_text(encoding="utf-8"))
        data.update(updates)
        tmp = meta_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(meta_file)
        return data

    def delete_source(self, source_id: str) -> bool:
        """Remove a stored SQLite source and its registered schema card."""
        source_dir = self.sources_dir / source_id
        if not source_dir.exists():
            return False
        meta = self.get_source(source_id)
        if meta and meta.get("knowledge_doc_id") and self.knowledge_index is not None:
            try:
                self.knowledge_index.delete_document(meta["knowledge_doc_id"])
            except Exception:
                pass
        shutil.rmtree(source_dir, ignore_errors=True)
        return True

    def query_source(self, source_id: str, sql: str, max_rows: int = 100) -> dict[str, Any]:
        """Execute a safe read-only SQL query on the stored source."""
        db_path = self.get_database_path(source_id)
        if db_path is None:
            raise SourceStoreError(f"Database source {source_id} not found")
        return safe_sqlite_query(db_path, sql, max_rows=max_rows)
