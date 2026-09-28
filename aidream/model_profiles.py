"""Persistent model profiles and effective-settings resolution.

Profiles store reusable load and generation defaults. Resolution is pure so
CLI, desktop, HTTP, and browser adapters can share the same precedence rules.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Mapping
import uuid


_PROFILE_ID = re.compile(r"[a-f0-9]{32}\Z")
_PLACEMENT_KEYS = {"gpu_layers", "device", "tensor_split", "split_mode", "main_gpu"}
_LOAD_KEYS = {
    "context_size", "threads", "batch_size", "physical_batch_size", "max_concurrent",
    "threads_batch", "continuous_batching", "numa", "mlock", "kv_cache_type_k",
    "kv_cache_type_v", "flash_attention", "unified_kv_cache", "offload_kv_cache",
    "mmap", "keep_model_in_memory", "fit",
}
_GENERATION_KEYS = {
    "system_prompt", "reasoning", "temperature", "max_tokens", "stop_strings",
    "top_p", "top_k", "min_p", "repeat_penalty", "seed", "structured_output",
}
_PROFILE_KEYS = {"id", "model_id", "name", "runtime_id", "backend_name", "placement", "load", "generation", "created_at", "updated_at"}


def _default_profiles_path() -> Path:
    xdg = os.environ.get("XDG_DATA_HOME")
    root = Path(xdg).expanduser() if xdg and Path(xdg).expanduser().is_absolute() else Path.home() / ".local" / "share"
    return root / "ai-dream" / "model-profiles.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _validate_profile(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("profile must be an object")
    extra = set(value) - _PROFILE_KEYS
    if extra:
        raise ValueError(f"unsupported profile field(s): {', '.join(sorted(map(str, extra)))}")
    profile = dict(value)
    name = profile.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100 or not name.strip().isprintable():
        raise ValueError("profile name must contain 1 to 100 printable characters")
    profile["name"] = name.strip()
    for key, max_length in (("model_id", 256), ("runtime_id", 128), ("backend_name", 128)):
        item = profile.get(key)
        if item is not None and (not isinstance(item, str) or len(item) > max_length or "\x00" in item):
            raise ValueError(f"{key} must be bounded text or None")
    for key, allowed in (("placement", _PLACEMENT_KEYS), ("load", _LOAD_KEYS), ("generation", _GENERATION_KEYS)):
        item = profile.get(key, {})
        if not isinstance(item, Mapping):
            raise ValueError(f"{key} must be an object")
        unknown = set(item) - allowed
        if unknown:
            raise ValueError(f"unsupported {key} setting(s): {', '.join(sorted(map(str, unknown)))}")
        profile[key] = _copy_json(dict(item))
    for key in ("id", "created_at", "updated_at"):
        if key in profile and not isinstance(profile[key], str):
            raise ValueError(f"{key} must be text")
    if "id" in profile and not _PROFILE_ID.fullmatch(profile["id"]):
        raise ValueError("invalid profile id")
    return profile


class ModelProfileStore:
    """Create, read, update, and remove JSON model profiles."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        self.path = Path(path).expanduser() if path is not None else _default_profiles_path()

    def list_profiles(self, model_id: str | None = None) -> list[dict[str, Any]]:
        profiles = self._read()
        if model_id is not None:
            profiles = [item for item in profiles if item.get("model_id") in (None, model_id)]
        profiles.sort(key=lambda item: (item.get("updated_at", ""), item["name"].casefold()), reverse=True)
        return [_copy_json(item) for item in profiles]

    def get(self, profile_id: str) -> dict[str, Any]:
        identity = _validate_id(profile_id)
        for profile in self._read():
            if profile["id"] == identity:
                return _copy_json(profile)
        raise KeyError(f"Model profile not found: {identity}")

    def create(self, profile: Mapping[str, Any]) -> dict[str, Any]:
        data = dict(profile)
        data.pop("id", None)
        data.pop("created_at", None)
        data.pop("updated_at", None)
        normalized = _validate_profile(data)
        now = _now()
        normalized.update(id=uuid.uuid4().hex, created_at=now, updated_at=now)
        records = self._read()
        records.append(normalized)
        self._write(records)
        return _copy_json(normalized)

    def update(self, profile_id: str, changes: Mapping[str, Any]) -> dict[str, Any]:
        identity = _validate_id(profile_id)
        if not isinstance(changes, Mapping) or set(changes) - (_PROFILE_KEYS - {"id", "created_at", "updated_at"}):
            raise ValueError("profile update contains unsupported fields")
        records = self._read()
        for index, current in enumerate(records):
            if current["id"] == identity:
                updated = dict(current)
                for key, value in changes.items():
                    if key in {"placement", "load", "generation"}:
                        merged = dict(updated.get(key, {}))
                        if not isinstance(value, Mapping):
                            raise ValueError(f"{key} must be an object")
                        merged.update(value)
                        updated[key] = merged
                    else:
                        updated[key] = value
                updated["updated_at"] = _now()
                records[index] = _validate_profile(updated)
                self._write(records)
                return _copy_json(records[index])
        raise KeyError(f"Model profile not found: {identity}")

    def delete(self, profile_id: str) -> None:
        identity = _validate_id(profile_id)
        records = self._read()
        remaining = [item for item in records if item["id"] != identity]
        if len(remaining) == len(records):
            raise KeyError(f"Model profile not found: {identity}")
        self._write(remaining)

    def _read(self) -> list[dict[str, Any]]:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, ValueError) as exc:
            raise ValueError(f"Could not read model profiles: {exc}") from exc
        if not isinstance(payload, dict) or payload.get("version") != 1 or set(payload) != {"version", "profiles"}:
            raise ValueError("Unsupported or invalid model profile store")
        records = payload["profiles"]
        if not isinstance(records, list) or len(records) > 10_000:
            raise ValueError("Model profile store has an invalid profile list")
        result = [_validate_profile(item) for item in records]
        ids = [item.get("id") for item in result]
        if any(identity is None for identity in ids) or len(ids) != len(set(ids)):
            raise ValueError("Model profile store contains missing or duplicate IDs")
        return result

    def _write(self, profiles: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"version": 1, "profiles": profiles}, ensure_ascii=False,
                             indent=2, allow_nan=False) + "\n"
        fd, temp_name = tempfile.mkstemp(prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, self.path)
        finally:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass


def resolve_effective_settings(global_settings: Mapping[str, Any] | None = None,
                               model_settings: Mapping[str, Any] | None = None,
                               chat_settings: Mapping[str, Any] | None = None,
                               request_settings: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Resolve effective settings in order: global < model < chat < request.

    Placement, load, and generation are merged independently and field by
    field. Chat legacy empty/missing settings are treated as empty overrides.
    """
    result: dict[str, Any] = {"backend_name": None, "runtime_id": None,
                              "model_id": None, "placement": {}, "load": {}, "generation": {}}
    for layer in (global_settings, model_settings, chat_settings, request_settings):
        if layer is None:
            continue
        if not isinstance(layer, Mapping):
            raise ValueError("settings layers must be objects")
        source = layer
        if isinstance(layer.get("runtime"), Mapping):
            source = {**layer, **layer["runtime"]}
        for key in ("backend_name", "backend", "runtime_id", "model_id"):
            if key in source and source[key] is not None:
                dest = "backend_name" if key == "backend" else key
                result[dest] = source[key]
        for key in ("placement", "load", "generation"):
            nested = source.get(key, {})
            if nested is None:
                continue
            if not isinstance(nested, Mapping):
                raise ValueError(f"{key} settings must be an object")
            result[key].update(_copy_json(dict(nested)))
    return result


def load_fingerprint(settings: Mapping[str, Any]) -> str:
    """Hash only runtime/backend/model and load-affecting placement/options."""
    if not isinstance(settings, Mapping):
        raise ValueError("settings must be an object")
    material = {key: settings.get(key) for key in ("runtime_id", "backend_name", "model_id")}
    for key in ("placement", "load"):
        value = settings.get(key, {})
        if not isinstance(value, Mapping):
            raise ValueError(f"{key} settings must be an object")
        material[key] = dict(value)
    canonical = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_id(value: str) -> str:
    if not isinstance(value, str) or not _PROFILE_ID.fullmatch(value):
        raise ValueError("invalid profile id")
    return value
