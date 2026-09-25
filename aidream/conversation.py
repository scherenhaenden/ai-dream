"""Local, offline conversation history stored as atomic JSON session files."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import tempfile
from typing import Any
import uuid


_SESSION_ID = re.compile(r"[a-f0-9]{32}\Z")
_ROLES = {"user", "assistant", "system"}
_PRESET_ID = re.compile(r"[a-f0-9]{32}\Z")
_SESSION_SETTING_KEYS = {"backend_name", "model_id", "model_path", "runtime", "generation", "preset_id"}
_PLACEMENT_KEYS = {"gpu_layers", "device", "tensor_split"}
_LOAD_KEYS = {"context_size", "threads", "batch_size", "physical_batch_size", "max_concurrent",
              "unified_kv_cache", "flash_attention", "offload_kv_cache", "keep_model_in_memory", "mmap"}
_GENERATION_KEYS = {"system_prompt", "reasoning", "temperature", "max_tokens", "stop_strings",
                    "context_size", "threads", "batch_size", "placement", "structured_output"}


def _default_session_settings() -> dict[str, Any]:
    return {"backend_name": "", "model_id": "", "model_path": "",
            "runtime": {"placement": {}, "load": {}},
            "generation": {"system_prompt": "", "reasoning": False, "temperature": 0.7,
                           "max_tokens": None, "stop_strings": [], "context_size": None,
                           "threads": None, "batch_size": None, "placement": {},
                           "structured_output": None},
            "preset_id": None}


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
                    _validate_session_settings(item.get("settings", {}))
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
        # Sessions created before settings persistence have no `settings` key.
        # Normalize on read without writing so loading legacy chats stays cheap.
        item["settings"] = _validate_session_settings(item.get("settings", {}))
        return item

    def get_session_settings(self, session_id: str) -> dict[str, Any]:
        """Return validated settings, including defaults for legacy sessions.

        Schema names for UI integration: backend_name, model_id, model_path,
        runtime.placement, runtime.load, generation, and preset_id.
        """
        return self.load(session_id)["settings"]

    def update_session_settings(self, session_id: str, settings: dict[str, Any]) -> dict[str, Any]:
        """Merge and atomically persist a partial session-settings update."""
        if not isinstance(settings, dict):
            raise ValueError("session settings update must be an object")
        session = self.load(session_id)
        current = session["settings"]
        merged = dict(current)
        for key, value in settings.items():
            if key in {"runtime", "generation"}:
                if not isinstance(value, dict):
                    raise ValueError(f"{key} settings must be an object")
                nested = dict(merged[key])
                for nested_key, nested_value in value.items():
                    if nested_key in {"placement", "load"} and key == "runtime":
                        if not isinstance(nested_value, dict):
                            raise ValueError(f"runtime.{nested_key} must be an object")
                        sub = dict(nested.get(nested_key, {}))
                        sub.update(nested_value)
                        nested[nested_key] = sub
                    elif nested_key == "placement" and key == "generation":
                        if not isinstance(nested_value, dict):
                            raise ValueError("generation.placement must be an object")
                        sub = dict(nested.get(nested_key, {}))
                        sub.update(nested_value)
                        nested[nested_key] = sub
                    else:
                        nested[nested_key] = nested_value
                merged[key] = nested
            else:
                merged[key] = value
        session["settings"] = _validate_session_settings(merged)
        session["updated_at"] = _now()
        self._write(session)
        return session["settings"]

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


def _validate_session_settings(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("session settings must be an object")
    extra = set(value) - _SESSION_SETTING_KEYS
    if extra:
        raise ValueError(f"unsupported session setting(s): {', '.join(sorted(map(str, extra)))}")
    result = _default_session_settings()
    result.update(value)
    for key, limit in (("backend_name", 128), ("model_id", 512), ("model_path", 4096)):
        text = result[key]
        if not isinstance(text, str) or len(text) > limit or "\x00" in text:
            raise ValueError(f"{key} must be text of at most {limit} characters")
    runtime = result["runtime"]
    if not isinstance(runtime, dict) or set(runtime) - {"placement", "load"}:
        raise ValueError("runtime must contain only placement and load objects")
    normalized_placement = _validate_placement(runtime.get("placement", {}), "runtime.placement")
    load = runtime.get("load", {})
    if not isinstance(load, dict) or set(load) - _LOAD_KEYS:
        raise ValueError("runtime.load contains unsupported options")
    normalized_load: dict[str, Any] = {}
    for key, maximum in (("context_size", 2_000_000), ("threads", 1024), ("batch_size", 65_536),
                         ("physical_batch_size", 65_536), ("max_concurrent", 1024)):
        if key in load:
            normalized_load[key] = _bounded_int(load[key], key, 1, maximum)
    for key in _LOAD_KEYS - {"context_size", "threads", "batch_size", "physical_batch_size", "max_concurrent"}:
        if key in load:
            if not isinstance(load[key], bool):
                raise ValueError(f"runtime.load.{key} must be boolean")
            normalized_load[key] = load[key]
    result["runtime"] = {"placement": normalized_placement, "load": normalized_load}

    generation = result["generation"]
    if not isinstance(generation, dict) or set(generation) - _GENERATION_KEYS:
        raise ValueError("generation contains unsupported options")
    generation_result = _default_session_settings()["generation"]
    generation_result.update(generation)
    prompt = generation_result["system_prompt"]
    if not isinstance(prompt, str) or len(prompt) > 16_384 or "\x00" in prompt:
        raise ValueError("generation.system_prompt must be text of at most 16384 characters")
    if not isinstance(generation_result["reasoning"], bool):
        raise ValueError("generation.reasoning must be boolean")
    temperature = generation_result["temperature"]
    if (isinstance(temperature, bool) or not isinstance(temperature, (int, float))
            or not math.isfinite(temperature) or not 0 <= temperature <= 2):
        raise ValueError("generation.temperature must be a finite number from 0 to 2")
    generation_result["temperature"] = float(temperature)
    for key, maximum in (("max_tokens", 1_000_000), ("context_size", 2_000_000),
                         ("threads", 1024), ("batch_size", 65_536)):
        if generation_result[key] is not None:
            generation_result[key] = _bounded_int(generation_result[key], f"generation.{key}", 1, maximum)
    stops = generation_result["stop_strings"]
    if not isinstance(stops, list) or len(stops) > 16 or any(
            not isinstance(stop, str) or not stop.strip() or len(stop) > 256 or "\x00" in stop
            for stop in stops):
        raise ValueError("generation.stop_strings must contain at most 16 bounded strings")
    generation_result["stop_strings"] = list(stops)
    gen_placement = generation_result["placement"]
    if not isinstance(gen_placement, dict) or set(gen_placement) - _PLACEMENT_KEYS:
        raise ValueError("generation.placement contains unsupported options")
    # Share placement validation with runtime placement and preserve only declared values.
    generation_result["placement"] = _validate_placement(gen_placement, "generation.placement")
    schema = generation_result["structured_output"]
    if schema is not None:
        if not isinstance(schema, dict):
            raise ValueError("generation.structured_output must be an object or None")
        try:
            encoded = json.dumps(schema, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError("generation.structured_output must be bounded JSON") from exc
        if len(encoded) > 32_768 or _json_depth(schema) > 16:
            raise ValueError("generation.structured_output exceeds size or nesting limits")
    result["generation"] = generation_result
    preset_id = result["preset_id"]
    if preset_id is not None and (not isinstance(preset_id, str) or not _PRESET_ID.fullmatch(preset_id)):
        raise ValueError("preset_id must be a 32-character preset ID or None")
    return result


def _bounded_int(value: Any, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer from {minimum} to {maximum}")
    return value


def _validate_placement(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - _PLACEMENT_KEYS:
        raise ValueError(f"{name} contains unsupported options")
    result: dict[str, Any] = {}
    if "gpu_layers" in value:
        result["gpu_layers"] = _bounded_int(value["gpu_layers"], f"{name}.gpu_layers", 0, 2048)
    if "device" in value:
        result["device"] = _short_text(value["device"], f"{name}.device", 128)
    if "tensor_split" in value:
        split = value["tensor_split"]
        if not isinstance(split, str) or not re.fullmatch(r"\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?){0,31}", split):
            raise ValueError(f"{name}.tensor_split must be a comma-separated list of positive numbers")
        numbers = [float(part) for part in split.split(",")]
        if any(not math.isfinite(number) or number <= 0 for number in numbers):
            raise ValueError(f"{name}.tensor_split values must be positive and finite")
        result["tensor_split"] = split
    return result


def _short_text(value: Any, name: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or "\x00" in value:
        raise ValueError(f"{name} must contain 1 to {maximum} characters")
    return value.strip()


def _json_depth(value: Any, depth: int = 0) -> int:
    if isinstance(value, dict):
        return max([depth] + [_json_depth(key, depth + 1) for key in value]
                   + [_json_depth(item, depth + 1) for item in value.values()])
    if isinstance(value, list):
        return max([depth] + [_json_depth(item, depth + 1) for item in value])
    return depth


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
