"""Local, offline conversation history stored as small JSON session files."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any
import uuid


def default_chat_dir() -> Path:
    root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return root / "ai-dream" / "chats"


class ChatStore:
    """Persist conversations locally; each session is an atomic JSON document."""
    def __init__(self, directory: str | Path | None = None):
        self.directory = Path(directory) if directory else default_chat_dir()
        self.directory.mkdir(parents=True, exist_ok=True)

    def create(self, title: str = "New chat") -> dict[str, Any]:
        session = {"id": uuid.uuid4().hex, "title": title.strip() or "New chat",
                   "created_at": _now(), "updated_at": _now(), "messages": []}
        self._write(session)
        return session

    def list_sessions(self) -> list[dict[str, Any]]:
        sessions = []
        for path in self.directory.glob("*.json"):
            try:
                item = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(item, dict) and isinstance(item.get("messages"), list):
                    sessions.append(item)
            except (OSError, ValueError):
                continue
        return sorted(sessions, key=lambda x: x.get("updated_at", ""), reverse=True)

    def load(self, session_id: str) -> dict[str, Any]:
        path = self._path(session_id)
        item = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(item, dict) or item.get("id") != session_id or not isinstance(item.get("messages"), list):
            raise ValueError("Invalid chat session")
        return item

    def append(self, session_id: str, role: str, content: str) -> dict[str, Any]:
        if role not in {"user", "assistant", "system"}:
            raise ValueError("role must be user, assistant, or system")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("message content cannot be empty")
        session = self.load(session_id)
        session["messages"].append({"role": role, "content": content, "created_at": _now()})
        session["updated_at"] = _now()
        if role == "user" and session.get("title") == "New chat":
            session["title"] = content.strip().splitlines()[0][:72]
        self._write(session)
        return session

    def _path(self, session_id: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", session_id):
            raise ValueError("Invalid session id")
        return self.directory / f"{session_id}.json"

    def _write(self, session: dict[str, Any]) -> None:
        path = self._path(session["id"])
        fd, temporary = tempfile.mkstemp(prefix=".chat-", suffix=".tmp", dir=self.directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(session, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
