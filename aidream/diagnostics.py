"""Bounded local diagnostic event log for failures users need to inspect."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import threading
import uuid
from typing import Any


MAX_LOG_BYTES = 512 * 1024
MAX_DETAIL_CHARS = 2000


def default_diagnostics_path() -> Path:
    state_home = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")).expanduser()
    if not state_home.is_absolute():
        state_home = Path.home() / ".local" / "state"
    return state_home / "ai-dream" / "diagnostics.jsonl"


def _clean(value: Any, limit: int = MAX_DETAIL_CHARS) -> str:
    text = str(value)
    text = "".join(char if char in "\t\n" or ord(char) >= 32 else " " for char in text)
    return text[:limit]


def _root_cause(error: BaseException) -> BaseException:
    current = error
    seen: set[int] = set()
    while current.__cause__ is not None and id(current) not in seen:
        seen.add(id(current))
        current = current.__cause__
    return current


class DiagnosticsLog:
    """Append-only local JSONL diagnostics, capped at one active and one rotated file."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        self.path = Path(path) if path is not None else default_diagnostics_path()
        self._lock = threading.Lock()

    def record(self, operation: str, error: BaseException | str, *, incident_id: str | None = None,
               chat_id: str | None = None, error_type: str | None = None,
               sensitive_values: tuple[str, ...] = ()) -> dict[str, Any]:
        cause = _root_cause(error) if isinstance(error, BaseException) else None
        detail_text = str(cause if cause is not None else error)
        for value in sensitive_values:
            if value:
                detail_text = detail_text.replace(value, "[redacted]")
        detail = _clean(detail_text)
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "incident_id": incident_id or uuid.uuid4().hex,
            "level": "error",
            "operation": _clean(operation, 100),
            "error_type": type(cause).__name__ if cause is not None else _clean(error_type or "Error", 100),
            "detail": detail,
        }
        if chat_id:
            event["chat_id"] = _clean(chat_id, 64)
        encoded = (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            try:
                if self.path.stat().st_size + len(encoded) > MAX_LOG_BYTES:
                    rotated = self.path.with_suffix(self.path.suffix + ".1")
                    try:
                        rotated.unlink(missing_ok=True)
                    except OSError:
                        pass
                    os.replace(self.path, rotated)
            except FileNotFoundError:
                pass
            flags = os.O_APPEND | os.O_CREAT | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(self.path, flags, 0o600)
            try:
                os.fchmod(fd, 0o600)
                os.write(fd, encoded)
            finally:
                os.close(fd)
        return event

    def list(self, limit: int = 100) -> list[dict[str, Any]]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
            raise ValueError("limit must be an integer from 1 to 500")
        events: list[dict[str, Any]] = []
        with self._lock:
            for path in (self.path.with_suffix(self.path.suffix + ".1"), self.path):
                try:
                    lines = path.read_text(encoding="utf-8").splitlines()
                except FileNotFoundError:
                    continue
                except (OSError, UnicodeError):
                    continue
                for line in lines:
                    try:
                        item = json.loads(line)
                    except (ValueError, TypeError):
                        continue
                    if isinstance(item, dict) and item.get("level") == "error":
                        events.append(item)
        return events[-limit:][::-1]
