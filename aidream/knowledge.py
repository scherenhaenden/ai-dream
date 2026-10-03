"""Small local full-text document index backed by SQLite FTS5."""
from __future__ import annotations

from datetime import datetime, timezone
from contextlib import contextmanager
import re
from pathlib import Path
import sqlite3
import threading
import uuid

from aidream.document_input import (
    MAX_DOCUMENT_BYTES,
    MAX_DOCUMENT_CHARS,
    MAX_TOTAL_DOCUMENT_CHARS,
    DocumentInputError,
    load_document_bytes,
)

MAX_KNOWLEDGE_DOCUMENTS = 100
MAX_KNOWLEDGE_QUERY_CHARS = 256
MAX_KNOWLEDGE_QUERY_TERMS = 16
MAX_KNOWLEDGE_RESULTS = 20
MAX_DOCUMENT_NAME_CHARS = 255
_ID_RE = re.compile(r"[a-f0-9]{32}\Z")


class KnowledgeError(ValueError):
    """Invalid or unavailable local knowledge-index operation."""


class KnowledgeLimitError(KnowledgeError):
    """An upload or local index bound was exceeded."""


class SQLiteKnowledgeIndex:
    """Persist extracted text and a lexical FTS5 index under the supplied app-data path."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path).expanduser().absolute()
        self._schema_lock = threading.Lock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        parent = self.db_path.parent
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.db_path.is_symlink():
            raise KnowledgeError("Knowledge database path must not be a symbolic link")
        connection = sqlite3.connect(self.db_path, timeout=5.0)
        try:
            if not self._initialized:
                with self._schema_lock:
                    if not self._initialized:
                        connection.executescript("""
                            CREATE TABLE IF NOT EXISTS knowledge_documents (
                                id TEXT PRIMARY KEY,
                                name TEXT NOT NULL,
                                media_type TEXT NOT NULL,
                                size_bytes INTEGER NOT NULL,
                                char_count INTEGER NOT NULL,
                                truncated INTEGER NOT NULL,
                                created_at TEXT NOT NULL,
                                text TEXT NOT NULL
                            );
                            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                                document_id UNINDEXED, name, text, tokenize='unicode61'
                            );
                        """)
                        self._initialized = True
            connection.execute("PRAGMA foreign_keys = ON")
            return connection
        except sqlite3.Error:
            connection.close()
            raise

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _metadata(row) -> dict:
        return {"id": row[0], "name": row[1], "media_type": row[2], "size_bytes": row[3],
                "char_count": row[4], "truncated": bool(row[5]), "created_at": row[6]}

    def list_documents(self) -> dict:
        try:
            with self._connection() as connection:
                rows = connection.execute(
                    "SELECT id,name,media_type,size_bytes,char_count,truncated,created_at "
                    "FROM knowledge_documents ORDER BY created_at DESC,id DESC LIMIT ?",
                    (MAX_KNOWLEDGE_DOCUMENTS,),
                ).fetchall()
                total = connection.execute(
                    "SELECT COUNT(*),COALESCE(SUM(char_count),0) FROM knowledge_documents"
                ).fetchone()
        except sqlite3.OperationalError as exc:
            raise KnowledgeError("SQLite FTS5 is unavailable for the local knowledge index") from exc
        return {"documents": [self._metadata(row) for row in rows],
                "count": total[0], "indexed_chars": total[1],
                "max_documents": MAX_KNOWLEDGE_DOCUMENTS,
                "max_document_chars": MAX_DOCUMENT_CHARS,
                "max_indexed_chars": MAX_TOTAL_DOCUMENT_CHARS}

    def add_document(self, name: str, data: bytes) -> dict:
        if not isinstance(name, str) or len(name) > MAX_DOCUMENT_NAME_CHARS:
            raise KnowledgeError(f"Document name must be at most {MAX_DOCUMENT_NAME_CHARS} characters")
        if len(data) > MAX_DOCUMENT_BYTES:
            raise KnowledgeLimitError(f"Document exceeds the {MAX_DOCUMENT_BYTES} byte limit")
        try:
            document = load_document_bytes(name, data)
        except DocumentInputError as exc:
            raise KnowledgeError(str(exc)) from exc
        if "\x00" in document.text:
            raise KnowledgeError("Document text contains a NUL character")

        doc_id = uuid.uuid4().hex
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            with self._connection() as connection:
                count, chars = connection.execute(
                    "SELECT COUNT(*),COALESCE(SUM(char_count),0) FROM knowledge_documents"
                ).fetchone()
                if count >= MAX_KNOWLEDGE_DOCUMENTS:
                    raise KnowledgeLimitError(f"Knowledge index is limited to {MAX_KNOWLEDGE_DOCUMENTS} documents")
                if chars + len(document.text) > MAX_TOTAL_DOCUMENT_CHARS:
                    raise KnowledgeLimitError(
                        f"Knowledge index text is limited to {MAX_TOTAL_DOCUMENT_CHARS} characters"
                    )
                connection.execute(
                    "INSERT INTO knowledge_documents(id,name,media_type,size_bytes,char_count,truncated,created_at,text) "
                    "VALUES(?,?,?,?,?,?,?,?)",
                    (doc_id, document.name, document.media_type, document.size_bytes,
                     len(document.text), int(document.truncated), created_at, document.text),
                )
                connection.execute(
                    "INSERT INTO knowledge_fts(document_id,name,text) VALUES(?,?,?)",
                    (doc_id, document.name, document.text),
                )
                row = connection.execute(
                    "SELECT id,name,media_type,size_bytes,char_count,truncated,created_at "
                    "FROM knowledge_documents WHERE id=?", (doc_id,),
                ).fetchone()
        except sqlite3.OperationalError as exc:
            raise KnowledgeError("SQLite FTS5 is unavailable for the local knowledge index") from exc
        return self._metadata(row)

    def add_sqlite_document(self, name: str, size_bytes: int, text: str, doc_id: str | None = None) -> dict:
        if not isinstance(name, str) or len(name) > MAX_DOCUMENT_NAME_CHARS:
            raise KnowledgeError(f"Document name must be at most {MAX_DOCUMENT_NAME_CHARS} characters")
        if "\x00" in text:
            raise KnowledgeError("Document text contains a NUL character")

        doc_id = doc_id or uuid.uuid4().hex
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            with self._connection() as connection:
                connection.execute(
                    "INSERT OR REPLACE INTO knowledge_documents(id,name,media_type,size_bytes,char_count,truncated,created_at,text) "
                    "VALUES(?,?,?,?,?,?,?,?)",
                    (doc_id, name, "application/x-sqlite3", int(size_bytes),
                     len(text), 0, created_at, text),
                )
                connection.execute(
                    "DELETE FROM knowledge_fts WHERE document_id=?", (doc_id,)
                )
                connection.execute(
                    "INSERT INTO knowledge_fts(document_id,name,text) VALUES(?,?,?)",
                    (doc_id, name, text),
                )
                row = connection.execute(
                    "SELECT id,name,media_type,size_bytes,char_count,truncated,created_at "
                    "FROM knowledge_documents WHERE id=?", (doc_id,),
                ).fetchone()
        except sqlite3.OperationalError as exc:
            raise KnowledgeError("SQLite FTS5 is unavailable for the local knowledge index") from exc
        return self._metadata(row)

    def get_document(self, doc_id: str) -> dict | None:
        if not isinstance(doc_id, str) or not _ID_RE.fullmatch(doc_id):
            raise KnowledgeError("Invalid knowledge document id")
        try:
            with self._connection() as connection:
                row = connection.execute(
                    "SELECT id,name,media_type,size_bytes,char_count,truncated,created_at,text "
                    "FROM knowledge_documents WHERE id=?", (doc_id,),
                ).fetchone()
                if row is None:
                    return None
                return {**self._metadata(row[:7]), "text": row[7]}
        except sqlite3.OperationalError as exc:
            raise KnowledgeError("SQLite FTS5 is unavailable for the local knowledge index") from exc

    def delete_document(self, doc_id: str) -> bool:
        if not isinstance(doc_id, str) or not _ID_RE.fullmatch(doc_id):
            raise KnowledgeError("Invalid knowledge document id")
        try:
            with self._connection() as connection:
                row = connection.execute(
                    "SELECT id,name,text FROM knowledge_documents WHERE id=?", (doc_id,)
                ).fetchone()
                if row is None:
                    return False
                connection.execute(
                    "DELETE FROM knowledge_fts WHERE document_id=? AND name=? AND text=?",
                    (row[0], row[1], row[2]),
                )
                connection.execute("DELETE FROM knowledge_documents WHERE id=?", (doc_id,))
            return True
        except sqlite3.OperationalError as exc:
            raise KnowledgeError("SQLite FTS5 is unavailable for the local knowledge index") from exc

    def search(self, query: str, limit: int = 10) -> list[dict]:
        if not isinstance(query, str) or len(query) > MAX_KNOWLEDGE_QUERY_CHARS:
            raise KnowledgeError(f"query must be at most {MAX_KNOWLEDGE_QUERY_CHARS} characters")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_KNOWLEDGE_RESULTS:
            raise KnowledgeError(f"limit must be from 1 to {MAX_KNOWLEDGE_RESULTS}")
        terms = re.findall(r"[^\W_]+", query, flags=re.UNICODE)
        if len(terms) > MAX_KNOWLEDGE_QUERY_TERMS:
            raise KnowledgeError(f"query may contain at most {MAX_KNOWLEDGE_QUERY_TERMS} terms")
        if not terms:
            return []
        fts_query = " AND ".join('"' + term.replace('"', '""') + '"' for term in terms)
        try:
            with self._connection() as connection:
                rows = connection.execute(
                    "SELECT d.id,d.name,d.media_type,d.size_bytes,d.char_count,d.truncated,d.created_at,"
                    "snippet(knowledge_fts,2,'[',']',' … ',18) "
                    "FROM knowledge_fts JOIN knowledge_documents AS d ON d.id=knowledge_fts.document_id "
                    "WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts) LIMIT ?",
                    (fts_query, limit),
                ).fetchall()
        except sqlite3.OperationalError as exc:
            raise KnowledgeError("SQLite FTS5 is unavailable for the local knowledge index") from exc
        return [{**self._metadata(row[:7]), "snippet": row[7][:1200]} for row in rows]
