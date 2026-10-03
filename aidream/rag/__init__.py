"""RAG & Database Integration package for AI Dream."""

from aidream.rag.sqlite_inspector import (
    ColumnProfile,
    ForeignKeyProfile,
    SQLiteInspectorError,
    SQLiteProfile,
    SQLiteSecurityError,
    TableProfile,
    compute_file_sha256,
    generate_schema_card,
    inspect_sqlite_database,
    is_sqlite_file,
    open_readonly_connection,
    safe_sqlite_query,
)
from aidream.rag.source_store import SQLiteSourceStore, SourceStoreError

__all__ = [
    "ColumnProfile",
    "ForeignKeyProfile",
    "SQLiteInspectorError",
    "SQLiteProfile",
    "SQLiteSecurityError",
    "SQLiteSourceStore",
    "SourceStoreError",
    "TableProfile",
    "compute_file_sha256",
    "generate_schema_card",
    "inspect_sqlite_database",
    "is_sqlite_file",
    "open_readonly_connection",
    "safe_sqlite_query",
]
