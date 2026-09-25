"""Local, offline conversation history stored as atomic JSON session files."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any
import uuid


_SESSION_ID = re.compile(r"[a-f0-9]{32}\Z")
_ROLES = {"user", "assistant", "system"}


def default_chat_dir() -> Path:
    root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return root / "ai-dream" / "chats"


class ChatStore:
    """Persist conversations locally; session updates replace files atomically."""
    def __init__(self, directory: str | Path | None = None):
        self.directory = Path(directory) if directory else default_chat_dir()
        self.directory.mkdir(parents=True, exist_ok=True)

    def create(self, title: str = "New chat") -> dict[str, Any]:
        if not isinstance(title, str):
            raise ValueError("title must be text")
        now = _now()
        session = {"id": uuid.uuid4().hex, "title": title.strip() or "New chat",
                   "created_at": now, "updated_at": now, "messages": []}
        self._write(session)
        return session

    def list_sessions(self) -> list[dict[str, Any]]:
        sessions = []
        for path in self.directory.glob("*.json"):
            try:
                item = json.loads(path.read_text(encoding="utf-8"))
                if (isinstance(item, dict) and _SESSION_ID.fullmatch(str(item.get("id", "")))
                        and path.name == f"{item['id']}.json"
                        and isinstance(item.get("title"), str) and isinstance(item.get("messages"), list)
                        and all(_valid_message(message) for message in item["messages"])):
                    sessions.append(item)
            except (OSError, ValueError, TypeError):
                continue
        return sorted(sessions, key=lambda x: x.get("updated_at", ""), reverse=True)

    def load(self, session_id: str) -> dict[str, Any]:
        path = self._path(session_id)
        try:
            item = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Chat session file contains invalid JSON") from exc
        if (not isinstance(item, dict) or item.get("id") != session_id
                or not isinstance(item.get("title"), str) or not isinstance(item.get("messages"), list)
                or not all(_valid_message(message) for message in item["messages"])):
            raise ValueError("Invalid chat session")
        return item

    def append(self, session_id: str, role: str, content: str) -> dict[str, Any]:
        if role not in _ROLES:
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

    def rename(self, session_id: str, title: str) -> dict[str, Any]:
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Chat title cannot be empty")
        session = self.load(session_id)
        session["title"] = title.strip()[:120]
        session["updated_at"] = _now()
        self._write(session)
        return session

    def delete(self, session_id: str) -> None:
        self._path(session_id).unlink()
        self._fsync_directory(self.directory)

    def export(self, session_id: str, destination: str | Path) -> Path:
        """Export a readable Markdown transcript atomically to the chosen path."""
        session = self.load(session_id)
        target = Path(destination).expanduser().resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"# {session['title']}", "", f"Created: {session.get('created_at', '')}", ""]
        labels = {"user": "You", "assistant": "Assistant", "system": "System"}
        for message in session["messages"]:
            lines.extend((f"## {labels[message['role']]}", "", message["content"], ""))
        self._atomic_write(target, "\n".join(lines).rstrip() + "\n")
        return target

    def _path(self, session_id: str) -> Path:
        if not isinstance(session_id, str) or not _SESSION_ID.fullmatch(session_id):
            raise ValueError("Invalid session id")
        return self.directory / f"{session_id}.json"

    def _write(self, session: dict[str, Any]) -> None:
        path = self._path(session.get("id"))
        payload = json.dumps(session, ensure_ascii=False, indent=2) + "\n"
        self._atomic_write(path, payload)

    @classmethod
    def _atomic_write(cls, target: Path, content: str) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".ai-dream-", suffix=".tmp", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
            cls._fsync_directory(target.parent)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        """Persist rename metadata where the platform/filesystem supports it."""
        try:
            fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        except OSError:
            return
        try:
            os.fsync(fd)
        except OSError:
            pass
        finally:
            os.close(fd)


def _valid_message(message: Any) -> bool:
    return (isinstance(message, dict) and message.get("role") in _ROLES
            and isinstance(message.get("content"), str))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
