"""Persistent application-wide defaults and read-only XDG locations."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from typing import Any, Mapping


_PATCHABLE_KEYS = {"runtime_defaults", "default_profile_behavior", "keep_last_model_loaded"}
_READ_ONLY_KEYS = {"managed_models_dir", "config_dir", "data_dir"}
_RUNTIME_KEYS = {"runtime_id", "backend_name", "placement", "load"}
_PLACEMENT_TYPES = {
    "gpu_layers": int, "device": str, "tensor_split": str,
    "split_mode": str, "main_gpu": int,
}
_LOAD_TYPES = {
    "context_size": int, "threads": int, "batch_size": int,
    "physical_batch_size": int, "max_concurrent": int,
    "threads_batch": int, "continuous_batching": bool, "numa": str,
    "mlock": bool, "kv_cache_type_k": str, "kv_cache_type_v": str,
    "flash_attention": bool, "unified_kv_cache": bool,
    "offload_kv_cache": bool, "mmap": bool,
    "keep_model_in_memory": bool, "fit": bool,
}


def _xdg_home(variable: str, fallback: Path) -> Path:
    value = os.environ.get(variable)
    candidate = Path(value).expanduser() if value else fallback
    return candidate if candidate.is_absolute() else fallback


def _locations() -> dict[str, str]:
    config_home = _xdg_home("XDG_CONFIG_HOME", Path.home() / ".config")
    data_home = _xdg_home("XDG_DATA_HOME", Path.home() / ".local" / "share")
    config_dir = (config_home / "ai-dream").resolve()
    data_dir = (data_home / "ai-dream").resolve()
    return {
        "managed_models_dir": str((data_dir / "models").resolve()),
        "config_dir": str(config_dir),
        "data_dir": str(data_dir),
    }


def default_settings() -> dict[str, Any]:
    return {
        "runtime_defaults": {"placement": {}, "load": {}},
        "default_profile_behavior": "model",
        "keep_last_model_loaded": False,
        **_locations(),
    }


def _check_int(value: Any, key: str, minimum: int = 1) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{key} must be an integer >= {minimum}")


def _typed_fields(value: Any, allowed: Mapping[str, type], name: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    extra = set(value) - set(allowed)
    if extra:
        raise ValueError(f"unsupported {name} field(s): {', '.join(sorted(map(str, extra)))}")
    result = dict(value)
    for key, item in result.items():
        expected = allowed[key]
        if expected is int:
            _check_int(item, key, 0 if key in {"gpu_layers", "main_gpu"} else 1)
        elif not isinstance(item, expected):
            raise ValueError(f"{name}.{key} must be {expected.__name__}")
        elif expected is str and (not item or len(item) > 256 or "\x00" in item):
            raise ValueError(f"{name}.{key} must be non-empty text of at most 256 characters")
    return result


def _validate_runtime_defaults(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("runtime_defaults must be an object")
    extra = set(value) - _RUNTIME_KEYS
    if extra:
        raise ValueError(f"unsupported runtime_defaults field(s): {', '.join(sorted(map(str, extra)))}")
    result = dict(value)
    for key in ("runtime_id", "backend_name"):
        item = result.get(key)
        if item is not None and (not isinstance(item, str) or not item.strip() or len(item) > 128 or "\x00" in item):
            raise ValueError(f"{key} must be non-empty bounded text or None")
    if "placement" in result:
        result["placement"] = _typed_fields(result["placement"], _PLACEMENT_TYPES, "placement")
    else:
        result["placement"] = {}
    if "load" in result:
        result["load"] = _typed_fields(result["load"], _LOAD_TYPES, "load")
    else:
        result["load"] = {}
    return result


def _validate_mutable(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("settings must be an object")
    extra = set(value) - _PATCHABLE_KEYS
    if extra:
        raise ValueError(f"unsupported settings field(s): {', '.join(sorted(map(str, extra)))}")
    result: dict[str, Any] = {}
    if "runtime_defaults" in value:
        result["runtime_defaults"] = _validate_runtime_defaults(value["runtime_defaults"])
    if "default_profile_behavior" in value:
        behavior = value["default_profile_behavior"]
        if not isinstance(behavior, str) or behavior not in {"model", "global"}:
            raise ValueError("default_profile_behavior must be 'model' or 'global'")
        result["default_profile_behavior"] = behavior
    if "keep_last_model_loaded" in value:
        flag = value["keep_last_model_loaded"]
        if not isinstance(flag, bool):
            raise ValueError("keep_last_model_loaded must be a boolean")
        result["keep_last_model_loaded"] = flag
    return result


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


class AppSettingsStore:
    """Versioned JSON settings store with atomic writes and derived XDG paths."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        if path is None:
            self.path = Path(_locations()["config_dir"]) / "app-settings.json"
        else:
            self.path = Path(path).expanduser()

    def get(self) -> dict[str, Any]:
        defaults = default_settings()
        mutable = self._read()
        defaults.update(mutable)
        return _json_copy(defaults)

    def patch(self, changes: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(changes, Mapping):
            raise ValueError("settings patch must be an object")
        readonly = set(changes) & _READ_ONLY_KEYS
        if readonly:
            raise ValueError(f"read-only settings field(s): {', '.join(sorted(readonly))}")
        patch = _validate_mutable(changes)
        current = self._read()
        if "runtime_defaults" in patch:
            merged = dict(current.get("runtime_defaults", {}))
            incoming = patch["runtime_defaults"]
            for key in ("runtime_id", "backend_name"):
                if key in incoming:
                    merged[key] = incoming[key]
            for category in ("placement", "load"):
                nested = dict(merged.get(category, {}))
                nested.update(incoming[category])
                merged[category] = nested
            current["runtime_defaults"] = _validate_runtime_defaults(merged)
        for key in ("default_profile_behavior", "keep_last_model_loaded"):
            if key in patch:
                current[key] = patch[key]
        self._write(current)
        return self.get()

    def _read(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            raise ValueError(f"Could not read application settings: {exc}") from exc
        if (not isinstance(payload, dict) or set(payload) != {"version", "settings"}
                or isinstance(payload.get("version"), bool) or payload.get("version") != 1):
            raise ValueError("Unsupported or invalid application settings store")
        settings = payload["settings"]
        return _validate_mutable(settings)

    def _write(self, settings: Mapping[str, Any]) -> None:
        normalized = _validate_mutable(settings)
        serialized = json.dumps({"version": 1, "settings": normalized}, ensure_ascii=False,
                                indent=2, allow_nan=False) + "\n"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(serialized)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            try:
                dir_fd = os.open(self.path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            except OSError:
                pass
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
