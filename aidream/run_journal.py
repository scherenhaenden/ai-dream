"""Private, bounded durable metadata journal for recent orchestration runs.

The journal stores operational state and event tails only. It never stores
binary artifact bytes, chat prompts, tool arguments, or generated text payloads.
"""
from __future__ import annotations

from copy import deepcopy
import json
import math
import os
from pathlib import Path
import stat
import tempfile
import threading
from typing import Any, Mapping

_VERSION = 2
_MAX_BYTES = 4 * 1024 * 1024
_MAX_RECORDS = 64
_MAX_EVENTS = 512
_MAX_EVENT_BYTES = 16 * 1024


def default_run_journal_path() -> Path:
    state_home = os.environ.get("XDG_STATE_HOME")
    base = Path(state_home).expanduser() if state_home and Path(state_home).expanduser().is_absolute() else Path.home() / ".local" / "state"
    return base / "ai-dream" / "runs.json"


class RunJournalStore:
    """Atomically persist a bounded set of run records for the current OS user."""

    def __init__(self, path: str | os.PathLike[str] | None = None, *,
                 max_bytes: int = _MAX_BYTES, max_records: int = _MAX_RECORDS,
                 max_events_per_run: int = _MAX_EVENTS):
        for name, value in (("max_bytes", max_bytes), ("max_records", max_records),
                            ("max_events_per_run", max_events_per_run)):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        self.max_bytes = max_bytes
        self.max_records = max_records
        self.max_events_per_run = max_events_per_run
        self.path = Path(path) if path is not None else default_run_journal_path()
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.path.parent.is_symlink():
            raise OSError("run journal directory cannot be a symbolic link")
        if os.name != "nt":
            parent_info = self.path.parent.stat()
            if parent_info.st_uid != os.geteuid():
                raise OSError("run journal directory must belong to the current user")
            if parent_info.st_mode & 0o077:
                raise OSError("run journal directory must be private (mode 0700)")
        self._lock = threading.RLock()
        self._records = self._read()

    def records(self) -> list[dict[str, Any]]:
        with self._lock:
            return deepcopy(list(self._records.values()))

    def replace_all(self, records: list[Mapping[str, Any]]) -> None:
        if not isinstance(records, list) or len(records) > self.max_records:
            raise ValueError("run journal record limit reached")
        normalized: dict[str, dict[str, Any]] = {}
        for record in records:
            row = self._validate_record(record)
            normalized[row["id"]] = row
        payload = {"schema_version": _VERSION, "runs": list(normalized.values())}
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False,
                             separators=(",", ":")).encode("utf-8")
        if len(encoded) > self.max_bytes:
            raise ValueError("run journal byte limit reached")
        with self._lock:
            self._atomic_write(encoded)
            self._records = normalized

    def _read(self) -> dict[str, dict[str, Any]]:
        try:
            self.path.lstat()
        except FileNotFoundError:
            return {}
        if self.path.is_symlink():
            raise OSError("run journal cannot be a symbolic link")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.path, flags)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > self.max_bytes:
                raise ValueError("run journal must be a bounded regular file")
            if os.name != "nt" and (info.st_uid != os.geteuid() or info.st_mode & 0o077):
                raise ValueError("run journal must be private to the current user")
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read(self.max_bytes + 1)
        finally:
            os.close(fd)
        if len(raw) > self.max_bytes:
            raise ValueError("run journal byte limit reached")
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("runs"), list):
            raise ValueError("run journal has an invalid envelope")
        version = value.get("schema_version", 1)
        if type(version) is not int or version not in {1, _VERSION}:
            raise ValueError("unsupported run journal schema version")
        if len(value["runs"]) > self.max_records:
            raise ValueError("run journal record limit reached")
        result = {}
        for item in value["runs"]:
            row = dict(item)
            if version == 1:
                # v2 adds an optional chat association. Older operational
                # records remain readable and migrate without guessing one.
                row.setdefault("chat_id", None)
            normalized = self._validate_record(row)
            result[normalized["id"]] = normalized
        if version == 1:
            self._records = result
            self.replace_all(list(result.values()))
            return self._records
        return result

    def _validate_record(self, value: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise ValueError("run journal record must be an object")
        row = deepcopy(dict(value))
        run_id = row.get("id")
        if not isinstance(run_id, str) or len(run_id) != 32 or any(ch not in "0123456789abcdef" for ch in run_id):
            raise ValueError("run journal id is invalid")
        if not isinstance(row.get("skill_id"), str) or not 1 <= len(row["skill_id"]) <= 256:
            raise ValueError("run journal skill id is invalid")
        if not isinstance(row.get("skill_version"), str) or not 1 <= len(row["skill_version"]) <= 64:
            raise ValueError("run journal skill version is invalid")
        if row.get("state") not in {"queued", "running", "succeeded", "failed", "cancelled"}:
            raise ValueError("run journal state is invalid")
        if not isinstance(row.get("plan"), Mapping):
            raise ValueError("run journal plan must be an object")
        for name in ("created_at", "started_at", "completed_at"):
            timestamp = row.get(name)
            if timestamp is not None and (isinstance(timestamp, bool)
                                          or not isinstance(timestamp, (int, float))
                                          or not math.isfinite(timestamp)):
                raise ValueError(f"run journal {name} is invalid")
        current_nodes = row.get("current_nodes", [])
        if (not isinstance(current_nodes, list) or len(current_nodes) > 128
                or any(not isinstance(item, str) or len(item) > 256 for item in current_nodes)):
            raise ValueError("run journal current node list is invalid")
        events = row.get("events")
        if not isinstance(events, list) or len(events) > self.max_events_per_run:
            raise ValueError("run journal event limit reached")
        previous = 0
        for event in events:
            if not isinstance(event, Mapping) or event.get("run_id") != run_id:
                raise ValueError("run journal event owner does not match its run")
            sequence = event.get("sequence")
            if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence <= previous:
                raise ValueError("run journal event sequence is invalid")
            if (not isinstance(event.get("type"), str) or not 1 <= len(event["type"]) <= 80
                    or isinstance(event.get("timestamp"), bool)
                    or not isinstance(event.get("timestamp"), (int, float))
                    or not math.isfinite(event["timestamp"])
                    or not isinstance(event.get("data"), Mapping)):
                raise ValueError("run journal event schema is invalid")
            encoded = json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            if len(encoded) > _MAX_EVENT_BYTES:
                raise ValueError("run journal event exceeds the per-event byte limit")
            _validate_event_ownership(event, run_id)
            previous = sequence
        chat_id = row.get("chat_id")
        if chat_id is not None and (not isinstance(chat_id, str) or len(chat_id) != 32
                                    or any(ch not in "0123456789abcdef" for ch in chat_id)):
            raise ValueError("run journal chat association is invalid")
        row["events"] = events
        next_sequence = row.get("next_sequence", 1)
        if isinstance(next_sequence, bool) or not isinstance(next_sequence, int) or next_sequence < 1:
            raise ValueError("run journal next sequence is invalid")
        row["next_sequence"] = max(next_sequence, previous + 1)
        return row
    def _atomic_write(self, encoded: bytes) -> None:
        fd, temp_name = tempfile.mkstemp(prefix=".runs-", suffix=".tmp", dir=self.path.parent)
        try:
            if os.name != "nt":
                os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, self.path)
            if os.name != "nt":
                directory_fd = os.open(self.path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        except BaseException:
            try:
                os.unlink(temp_name)
            except OSError:
                pass
            raise


def _validate_event_ownership(value: Any, run_id: str, depth: int = 0) -> None:
    if depth > 16:
        raise ValueError("run journal event nesting exceeds its limit")
    if isinstance(value, Mapping):
        owner = value.get("owner")
        if isinstance(owner, Mapping) and owner.get("type") == "run" and owner.get("id") != run_id:
            raise ValueError("run journal event references an artifact owned by another run")
        for item in value.values():
            _validate_event_ownership(item, run_id, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _validate_event_ownership(item, run_id, depth + 1)


__all__ = ["RunJournalStore", "default_run_journal_path"]
