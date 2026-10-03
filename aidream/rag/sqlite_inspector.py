"""Safe SQLite file inspection, schema profiling, schema card generation, and read-only query execution.

Guaranteed immutable, bounded, and hardened against malicious databases or runaway queries.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
import hashlib
import os
from pathlib import Path
import re
import sqlite3
from typing import Any

SQLITE_MAGIC = b"SQLite format 3\x00"
MAX_SQLITE_FILE_BYTES = 512 * 1024 * 1024  # 512 MiB limit for database sources
MAX_SAMPLE_VALUES = 5
MAX_SAMPLE_CHAR_LENGTH = 80
MAX_QUERY_ROWS = 500
DEFAULT_STEP_BUDGET = 200_000

# Patterns for sensitive columns to exclude from sample extraction
SENSITIVE_COLUMN_PATTERN = re.compile(
    r"(?:password|secret|token|apikey|api_key|auth|credential|credit_card|card_number|cvv|ssn)",
    re.IGNORECASE,
)

# Allowlisted SQLite functions for read-only user queries
SAFE_SQLITE_FUNCTIONS = frozenset({
    "abs", "round", "count", "min", "max", "sum", "total", "avg",
    "upper", "lower", "length", "substr", "substring", "trim", "ltrim", "rtrim",
    "coalesce", "ifnull", "nullif", "strftime", "date", "time", "datetime",
    "julianday", "typeof", "instr", "replace", "hex", "random", "like", "glob",
    "concat", "concat_ws", "char", "unicode", "quote", "zeroblob"
})


class SQLiteInspectorError(Exception):
    """Raised when SQLite inspection or query fails."""


class SQLiteSecurityError(SQLiteInspectorError):
    """Raised when an unauthorized query operation is attempted."""


@dataclass
class ColumnProfile:
    name: str
    data_type: str
    nullable: bool
    is_primary_key: bool
    pk_position: int = 0
    default_value: Any = None
    samples: list[str] = field(default_factory=list)


@dataclass
class ForeignKeyProfile:
    from_column: str
    target_table: str
    target_column: str
    on_update: str = "NO ACTION"
    on_delete: str = "NO ACTION"


@dataclass
class TableProfile:
    name: str
    is_view: bool = False
    columns: list[ColumnProfile] = field(default_factory=list)
    primary_keys: list[str] = field(default_factory=list)
    foreign_keys: list[ForeignKeyProfile] = field(default_factory=list)
    row_count: int | None = None
    row_count_exact: bool = True
    budget_exceeded: bool = False


@dataclass
class SQLiteProfile:
    file_name: str
    file_size_bytes: int
    sha256: str
    is_wal_mode: bool = False
    wal_sidecar_present: bool = False
    user_version: int = 0
    application_id: int = 0
    tables: list[TableProfile] = field(default_factory=list)
    views: list[TableProfile] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def is_sqlite_file(path_or_bytes: str | Path | bytes) -> bool:
    """Return True if the input starts with the 16-byte SQLite magic header."""
    try:
        if isinstance(path_or_bytes, bytes):
            return path_or_bytes.startswith(SQLITE_MAGIC)
        path = Path(path_or_bytes).expanduser().resolve()
        if not path.is_file():
            return False
        with open(path, "rb") as f:
            header = f.read(16)
            return header == SQLITE_MAGIC
    except Exception:
        return False


def compute_file_sha256(path: str | Path, chunk_size: int = 65536) -> str:
    """Compute SHA-256 in chunked buffers to avoid unbounded memory consumption."""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()


def _sanitize_sample(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, (bytes, bytearray, memoryview)):
        return f"<blob: {len(val)} bytes>"
    s = str(val).strip().replace("\n", " ").replace("\r", "")
    if len(s) > MAX_SAMPLE_CHAR_LENGTH:
        return s[:MAX_SAMPLE_CHAR_LENGTH] + "..."
    return s


def _safe_quote_identifier(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def open_readonly_connection(
    path: str | Path,
    step_budget: int = DEFAULT_STEP_BUDGET,
) -> sqlite3.Connection:
    """Open a hardened, read-only SQLite connection with strict VM-step limits."""
    resolved = Path(path).expanduser().resolve(strict=True)
    if not resolved.is_file():
        raise SQLiteInspectorError(f"File not found: {resolved}")
    if resolved.stat().st_size > MAX_SQLITE_FILE_BYTES:
        raise SQLiteInspectorError(f"Database exceeds maximum size of {MAX_SQLITE_FILE_BYTES // (1024 * 1024)} MiB")

    uri = f"file:{resolved.as_posix()}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    except sqlite3.Error as exc:
        raise SQLiteInspectorError(f"Could not open SQLite database: {exc}") from exc

    conn.execute("PRAGMA query_only = ON;")
    conn.execute("PRAGMA trusted_schema = OFF;")

    if step_budget > 0:
        steps_remaining = [step_budget]

        def _step_handler():
            steps_remaining[0] -= 100
            if steps_remaining[0] <= 0:
                return 1  # Abort query
            return 0

        conn.set_progress_handler(_step_handler, 100)

    return conn


def inspect_sqlite_database(
    path: str | Path,
    *,
    sample_limit: int = MAX_SAMPLE_VALUES,
    step_budget: int = DEFAULT_STEP_BUDGET,
) -> SQLiteProfile:
    """Dynamically discover tables, columns, relations, row counts and sample values."""
    resolved = Path(path).expanduser().resolve(strict=True)
    if not is_sqlite_file(resolved):
        raise SQLiteInspectorError("File is not a valid SQLite database (missing SQLite magic header)")

    file_size = resolved.stat().st_size
    sha256 = compute_file_sha256(resolved)

    # Inspect WAL mode from header bytes 18 & 19
    is_wal = False
    try:
        with open(resolved, "rb") as f:
            f.seek(18)
            wal_bytes = f.read(2)
            is_wal = (wal_bytes == b"\x02\x02")
    except Exception:
        pass

    wal_sidecar = (
        resolved.with_name(resolved.name + "-wal").is_file()
        or resolved.with_name(resolved.stem + ".db-wal").is_file()
    )

    conn = open_readonly_connection(resolved, step_budget=step_budget)
    try:
        user_version = 0
        application_id = 0
        try:
            uv = conn.execute("PRAGMA user_version").fetchone()
            if uv:
                user_version = uv[0]
            ai = conn.execute("PRAGMA application_id").fetchone()
            if ai:
                application_id = ai[0]
        except Exception:
            pass

        # Query all non-internal tables and views
        schema_query = """
            SELECT type, name, sql
            FROM sqlite_schema
            WHERE name NOT LIKE 'sqlite_%'
              AND name NOT LIKE '%_content'
              AND name NOT LIKE '%_segdir'
              AND name NOT LIKE '%_segments'
              AND name NOT LIKE '%_stat'
              AND name NOT LIKE '%_docsize'
              AND name NOT LIKE '%_config'
              AND name NOT LIKE '%_data'
              AND name NOT LIKE '%_idx'
            ORDER BY name;
        """
        try:
            objects = conn.execute(schema_query).fetchall()
        except sqlite3.OperationalError:
            # Fallback for older SQLite versions
            schema_query = schema_query.replace("sqlite_schema", "sqlite_master")
            objects = conn.execute(schema_query).fetchall()

        table_profiles: list[TableProfile] = []
        view_profiles: list[TableProfile] = []

        for obj_type, obj_name, _sql in objects:
            is_view = (obj_type == "view")
            quoted_name = _safe_quote_identifier(obj_name)

            # Columns
            cols: list[ColumnProfile] = []
            primary_keys: list[str] = []
            try:
                col_rows = conn.execute(f"PRAGMA table_info({quoted_name})").fetchall()
                for _cid, col_name, data_type, notnull, dflt_value, pk in col_rows:
                    is_pk = pk > 0
                    if is_pk:
                        primary_keys.append(col_name)
                    cols.append(ColumnProfile(
                        name=col_name,
                        data_type=data_type.upper() if data_type else "TEXT",
                        nullable=not bool(notnull),
                        is_primary_key=is_pk,
                        pk_position=pk,
                        default_value=dflt_value,
                        samples=[],
                    ))
            except Exception:
                pass

            # Foreign Keys
            fks: list[ForeignKeyProfile] = []
            if not is_view:
                try:
                    fk_rows = conn.execute(f"PRAGMA foreign_key_list({quoted_name})").fetchall()
                    for _id, _seq, target_tbl, from_col, to_col, on_upd, on_del, _match in fk_rows:
                        fks.append(ForeignKeyProfile(
                            from_column=from_col or "",
                            target_table=target_tbl,
                            target_column=to_col or "",
                            on_update=on_upd or "NO ACTION",
                            on_delete=on_del or "NO ACTION",
                        ))
                except Exception:
                    pass

            # Row count
            row_count: int | None = None
            row_count_exact = True
            budget_exceeded = False
            try:
                cnt_row = conn.execute(f"SELECT COUNT(*) FROM {quoted_name}").fetchone()
                if cnt_row:
                    row_count = cnt_row[0]
            except sqlite3.OperationalError:
                # Step budget or timeout reached
                row_count_exact = False
                budget_exceeded = True
            except Exception:
                row_count_exact = False

            # Column samples (categorical sample values for non-sensitive columns)
            if sample_limit > 0 and row_count != 0 and not budget_exceeded:
                for col in cols:
                    if SENSITIVE_COLUMN_PATTERN.search(col.name):
                        continue
                    quoted_col = _safe_quote_identifier(col.name)
                    sample_query = (
                        f"SELECT DISTINCT {quoted_col} FROM {quoted_name} "
                        f"WHERE {quoted_col} IS NOT NULL AND {quoted_col} != '' "
                        f"LIMIT {sample_limit}"
                    )
                    try:
                        sample_rows = conn.execute(sample_query).fetchall()
                        col.samples = [_sanitize_sample(r[0]) for r in sample_rows]
                    except Exception:
                        pass

            tbl_profile = TableProfile(
                name=obj_name,
                is_view=is_view,
                columns=cols,
                primary_keys=primary_keys,
                foreign_keys=fks,
                row_count=row_count,
                row_count_exact=row_count_exact,
                budget_exceeded=budget_exceeded,
            )

            if is_view:
                view_profiles.append(tbl_profile)
            else:
                table_profiles.append(tbl_profile)

        return SQLiteProfile(
            file_name=resolved.name,
            file_size_bytes=file_size,
            sha256=sha256,
            is_wal_mode=is_wal,
            wal_sidecar_present=wal_sidecar,
            user_version=user_version,
            application_id=application_id,
            tables=table_profiles,
            views=view_profiles,
        )
    finally:
        conn.close()


def generate_schema_card(profile: SQLiteProfile) -> str:
    """Render a structured Markdown Schema Card suitable for LLM context or knowledge index."""
    size_mb = profile.file_size_bytes / (1024 * 1024)
    lines: list[str] = [
        f"# Database Schema: {profile.file_name}",
        f"- **File Size**: {size_mb:.2f} MiB ({profile.file_size_bytes:,} bytes)",
        f"- **SHA-256**: `{profile.sha256}`",
        f"- **Tables**: {len(profile.tables)}",
        f"- **Views**: {len(profile.views)}",
    ]
    if profile.is_wal_mode:
        lines.append("- **Journal Mode**: WAL")

    lines.append("")
    lines.append("## Tables")

    for tbl in profile.tables:
        count_str = f"{tbl.row_count:,} rows" if tbl.row_count is not None else "unknown rows"
        if not tbl.row_count_exact:
            count_str += " (budget limit reached)"
        lines.append(f"### Table `{tbl.name}` ({count_str})")

        if tbl.columns:
            lines.append("| Column | Type | Constraints | Sample Values |")
            lines.append("|---|---|---|---|")
            for c in tbl.columns:
                constraints = []
                if c.is_primary_key:
                    constraints.append("PK" if not c.pk_position or c.pk_position == 1 else f"PK({c.pk_position})")
                if not c.nullable:
                    constraints.append("NOT NULL")
                if c.default_value is not None:
                    constraints.append(f"DEFAULT {c.default_value}")
                constr_str = ", ".join(constraints) if constraints else "-"
                sample_str = ", ".join(f'"{s}"' if " " in s else s for s in c.samples[:3]) if c.samples else "-"
                lines.append(f"| `{c.name}` | `{c.data_type}` | {constr_str} | {sample_str} |")
        else:
            lines.append("*No columns detected.*")

        if tbl.foreign_keys:
            lines.append("\n**Foreign Keys:**")
            for fk in tbl.foreign_keys:
                lines.append(f"- `{fk.from_column}` -> `{fk.target_table}({fk.target_column})`")

        lines.append("")

    if profile.views:
        lines.append("## Views")
        for v in profile.views:
            lines.append(f"### View `{v.name}`")
            if v.columns:
                lines.append("| Column | Type |")
                lines.append("|---|---|")
                for c in v.columns:
                    lines.append(f"| `{c.name}` | `{c.data_type}` |")
            lines.append("")

    return "\n".join(lines).strip()


def safe_sqlite_query(
    path: str | Path,
    sql: str,
    *,
    max_rows: int = MAX_QUERY_ROWS,
    step_budget: int = DEFAULT_STEP_BUDGET,
) -> dict[str, Any]:
    """Execute a guarded read-only SELECT query against the SQLite database.

    Enforces:
    - Authorizer callback denying modifications, pragmas, attach, extensions.
    - Read-only connection mode.
    - VM-step execution budget.
    - Row count bounding.
    """
    clean_sql = sql.strip().rstrip(";")
    if not clean_sql:
        raise SQLiteInspectorError("SQL query is empty")

    # Reject multiple statements (separated by semicolon)
    if ";" in clean_sql:
        raise SQLiteSecurityError("Only a single SQL statement is permitted")

    conn = open_readonly_connection(path, step_budget=step_budget)
    try:
        # Enforce strict authorizer
        def _authorizer(action_code, arg1, arg2, db_name, trigger_name):
            if action_code in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ):
                return sqlite3.SQLITE_OK
            if action_code == sqlite3.SQLITE_FUNCTION:
                func_name = (arg2 or "").lower()
                if func_name in SAFE_SQLITE_FUNCTIONS:
                    return sqlite3.SQLITE_OK
                return sqlite3.SQLITE_DENY
            # Deny everything else
            return sqlite3.SQLITE_DENY

        conn.set_authorizer(_authorizer)

        cursor = conn.cursor()
        try:
            cursor.execute(clean_sql)
        except sqlite3.DatabaseError as exc:
            if "not authorized" in str(exc).lower():
                raise SQLiteSecurityError(f"Query was blocked by security authorizer: {exc}") from exc
            raise SQLiteInspectorError(f"Query error: {exc}") from exc

        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = []
        truncated = False

        for row in cursor:
            if len(rows) >= max_rows:
                truncated = True
                break
            rows.append(list(row))

        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "sql": clean_sql,
        }
    finally:
        conn.close()
