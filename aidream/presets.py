"""Local persistence for validated chat/model parameter presets."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Mapping
import uuid


_PRESET_ID = re.compile(r"[a-f0-9]{32}\Z")
_DEVICE_NAME = re.compile(r"[A-Za-z0-9_.:, -]{1,128}\Z")
_SPLIT = re.compile(r"\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?){0,31}\Z")
_SCHEMA_TYPES = {"object", "array", "string", "number", "integer", "boolean", "null"}
_SCHEMA_KEYS = {
    "type", "properties", "required", "additionalProperties", "items", "enum",
    "minimum", "maximum", "minLength", "maxLength", "description", "title", "format",
}
_SETTING_KEYS = {
    "system_prompt", "reasoning", "temperature", "max_tokens", "stop_strings",
    "context_size", "threads", "batch_size", "placement", "structured_output",
}
_DEFAULT_SETTINGS: dict[str, Any] = {
    "system_prompt": "",
    "reasoning": False,
    "temperature": 0.7,
    "max_tokens": None,
    "stop_strings": [],
    "context_size": None,
    "threads": None,
    "batch_size": None,
    "placement": {},
    "structured_output": None,
}


def default_presets_path() -> Path:
    """Return the per-user XDG data file used for chat presets."""
    xdg = os.environ.get("XDG_DATA_HOME")
    root = Path(xdg).expanduser() if xdg and Path(xdg).expanduser().is_absolute() else Path.home() / ".local" / "share"
    return root / "ai-dream" / "presets.json"


class PresetStore:
    """Create, list, load, rename, and delete validated local presets."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        self.path = Path(path).expanduser() if path is not None else default_presets_path()

    def create(self, name: str, settings: Mapping[str, Any] | None = None) -> dict[str, Any]:
        preset_name = _validate_name(name)
        normalized = _validate_settings({} if settings is None else settings)
        presets = self._read()
        now = _now()
        preset = {"id": uuid.uuid4().hex, "name": preset_name, "created_at": now,
                  "updated_at": now, "settings": normalized}
        presets.append(preset)
        self._write(presets)
        return _copy_json(preset)

    def list_presets(self) -> list[dict[str, Any]]:
        """Return presets ordered by most recently updated."""
        ordered = sorted(self._read(), key=lambda item: (item["updated_at"], item["name"].casefold()),
                         reverse=True)
        return [_copy_json(preset) for preset in ordered]

    def load(self, preset_id: str) -> dict[str, Any]:
        identity = _validate_id(preset_id)
        for preset in self._read():
            if preset["id"] == identity:
                return _copy_json(preset)
        raise KeyError(f"Preset not found: {identity}")

    def rename(self, preset_id: str, name: str) -> dict[str, Any]:
        identity = _validate_id(preset_id)
        preset_name = _validate_name(name)
        presets = self._read()
        for preset in presets:
            if preset["id"] == identity:
                preset["name"] = preset_name
                preset["updated_at"] = _now()
                self._write(presets)
                return _copy_json(preset)
        raise KeyError(f"Preset not found: {identity}")

    def delete(self, preset_id: str) -> None:
        identity = _validate_id(preset_id)
        presets = self._read()
        remaining = [preset for preset in presets if preset["id"] != identity]
        if len(remaining) == len(presets):
            raise KeyError(f"Preset not found: {identity}")
        self._write(remaining)

    def _read(self) -> list[dict[str, Any]]:
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        except OSError as exc:
            raise ValueError(f"Could not read preset store: {exc}") from exc
        try:
            data = json.loads(text, parse_constant=_reject_json_constant)
        except (ValueError, TypeError) as exc:
            raise ValueError("Preset store contains invalid JSON") from exc
        if (not isinstance(data, dict) or set(data) != {"version", "presets"}
                or isinstance(data.get("version"), bool) or data.get("version") != 1):
            raise ValueError("Unsupported or invalid preset store format")
        records = data.get("presets")
        if not isinstance(records, list) or len(records) > 10_000:
            raise ValueError("Preset store has an invalid preset list")
        validated = []
        seen: set[str] = set()
        for record in records:
            preset = _validate_record(record)
            if preset["id"] in seen:
                raise ValueError("Preset store contains duplicate IDs")
            seen.add(preset["id"])
            validated.append(preset)
        return validated

    def _write(self, presets: list[dict[str, Any]]) -> None:
        # Re-validate before serialization so callers cannot bypass the schema.
        records = [_validate_record(item) for item in presets]
        payload = json.dumps({"version": 1, "presets": records}, ensure_ascii=False,
                             indent=2, allow_nan=False) + "\n"
        _atomic_write(self.path, payload)


def _validate_name(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("preset name must be text")
    value = value.strip()
    if not value or len(value) > 100 or not value.isprintable():
        raise ValueError("preset name must contain 1 to 100 printable characters")
    return value


def _validate_id(value: Any) -> str:
    if not isinstance(value, str) or not _PRESET_ID.fullmatch(value):
        raise ValueError("invalid preset id")
    return value


def _optional_int(value: Any, name: str, maximum: int) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer from 1 to {maximum}, or None")
    return value


def _validate_settings(settings: Any) -> dict[str, Any]:
    if not isinstance(settings, Mapping):
        raise ValueError("settings must be an object")
    extra = set(settings) - _SETTING_KEYS
    if extra:
        raise ValueError(f"unsupported setting(s): {', '.join(sorted(map(str, extra)))}")
    result = dict(_DEFAULT_SETTINGS)
    result.update(settings)

    prompt = result["system_prompt"]
    if not isinstance(prompt, str) or len(prompt) > 16_384 or "\x00" in prompt:
        raise ValueError("system_prompt must be text of at most 16384 characters")
    if not isinstance(result["reasoning"], bool):
        raise ValueError("reasoning must be a boolean")
    temperature = result["temperature"]
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)) or not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise ValueError("temperature must be a finite number from 0 to 2")
    result["temperature"] = float(temperature)
    result["max_tokens"] = _optional_int(result["max_tokens"], "max_tokens", 1_000_000)
    result["context_size"] = _optional_int(result["context_size"], "context_size", 2_000_000)
    result["threads"] = _optional_int(result["threads"], "threads", 1024)
    result["batch_size"] = _optional_int(result["batch_size"], "batch_size", 65_536)

    stops = result["stop_strings"]
    if not isinstance(stops, list) or len(stops) > 16:
        raise ValueError("stop_strings must be a list of at most 16 strings")
    normalized_stops = []
    for stop in stops:
        if not isinstance(stop, str) or not stop.strip() or len(stop) > 256 or "\x00" in stop:
            raise ValueError("each stop string must contain 1 to 256 characters")
        normalized_stops.append(stop)
    result["stop_strings"] = normalized_stops
    result["placement"] = _validate_placement(result["placement"])
    schema = result["structured_output"]
    if schema is not None:
        _validate_schema(schema)
        if len(json.dumps(schema, ensure_ascii=False, allow_nan=False)) > 32_768:
            raise ValueError("structured_output schema cannot exceed 32768 characters")
        result["structured_output"] = _copy_json(schema)
    return result


def _validate_placement(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("placement must be an object")
    extra = set(value) - {"gpu_layers", "device", "tensor_split"}
    if extra:
        raise ValueError(f"unsupported placement setting(s): {', '.join(sorted(map(str, extra)))}")
    result: dict[str, Any] = {}
    if "gpu_layers" in value:
        layers = value["gpu_layers"]
        if isinstance(layers, bool) or not isinstance(layers, int) or not 0 <= layers <= 2048:
            raise ValueError("gpu_layers must be an integer from 0 to 2048")
        result["gpu_layers"] = layers
    if "device" in value:
        device = value["device"]
        if not isinstance(device, str) or not _DEVICE_NAME.fullmatch(device.strip()):
            raise ValueError("device must be a short device identifier")
        result["device"] = device.strip()
    if "tensor_split" in value:
        split = value["tensor_split"]
        if not isinstance(split, str) or not _SPLIT.fullmatch(split):
            raise ValueError("tensor_split must be comma-separated positive numbers")
        numbers = [float(part) for part in split.split(",")]
        if not all(math.isfinite(number) and number > 0 for number in numbers):
            raise ValueError("tensor_split values must be positive and finite")
        result["tensor_split"] = split
    return result


def _validate_schema(schema: Any, *, depth: int = 0, budget: list[int] | None = None) -> None:
    if budget is None:
        budget = [0]
    budget[0] += 1
    if depth > 16 or budget[0] > 1024:
        raise ValueError("structured_output schema is too deeply nested or too large")
    if not isinstance(schema, dict) or not schema:
        raise ValueError("structured_output must be a non-empty JSON Schema object")
    unknown = set(schema) - _SCHEMA_KEYS
    if unknown:
        raise ValueError(f"unsupported JSON Schema keyword(s): {', '.join(sorted(map(str, unknown)))}")
    if "type" in schema:
        kind = schema["type"]
        if not isinstance(kind, str) or kind not in _SCHEMA_TYPES:
            raise ValueError("JSON Schema type is unsupported")
    if "properties" in schema:
        props = schema["properties"]
        if not isinstance(props, dict) or len(props) > 64:
            raise ValueError("JSON Schema properties must be an object with at most 64 entries")
        for key, nested in props.items():
            if not isinstance(key, str) or not key or len(key) > 128:
                raise ValueError("JSON Schema property names must be 1 to 128 characters")
            _validate_schema(nested, depth=depth + 1, budget=budget)
    if "required" in schema:
        required = schema["required"]
        props = schema.get("properties", {})
        if (not isinstance(required, list) or len(required) > 64
                or any(not isinstance(key, str) or key not in props for key in required)
                or len(set(required)) != len(required)):
            raise ValueError("JSON Schema required must contain unique property names")
    if "additionalProperties" in schema:
        extra = schema["additionalProperties"]
        if isinstance(extra, dict):
            _validate_schema(extra, depth=depth + 1, budget=budget)
        elif not isinstance(extra, bool):
            raise ValueError("additionalProperties must be boolean or a schema object")
    if "items" in schema:
        _validate_schema(schema["items"], depth=depth + 1, budget=budget)
    if "enum" in schema:
        options = schema["enum"]
        if not isinstance(options, list) or not 1 <= len(options) <= 128:
            raise ValueError("JSON Schema enum must contain 1 to 128 values")
        for option in options:
            if (option is not None and not isinstance(option, (str, int, float, bool))) or (
                isinstance(option, float) and not math.isfinite(option)
            ) or (isinstance(option, str) and len(option) > 2048):
                raise ValueError("JSON Schema enum values must be bounded JSON scalars")
    for key in ("minimum", "maximum"):
        if key in schema and (isinstance(schema[key], bool) or not isinstance(schema[key], (int, float))
                              or not math.isfinite(schema[key])):
            raise ValueError(f"JSON Schema {key} must be a finite number")
    for key in ("minLength", "maxLength"):
        if key in schema and (isinstance(schema[key], bool) or not isinstance(schema[key], int)
                              or not 0 <= schema[key] <= 1_000_000):
            raise ValueError(f"JSON Schema {key} must be a non-negative integer")
    for key in ("description", "title", "format"):
        if key in schema and (not isinstance(schema[key], str) or len(schema[key]) > 512):
            raise ValueError(f"JSON Schema {key} must be short text")


def _validate_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"id", "name", "created_at", "updated_at", "settings"}:
        raise ValueError("invalid preset record")
    identity = _validate_id(value["id"])
    name = _validate_name(value["name"])
    for field in ("created_at", "updated_at"):
        stamp = value[field]
        if not isinstance(stamp, str) or len(stamp) > 40:
            raise ValueError(f"invalid preset {field}")
        try:
            parsed = datetime.fromisoformat(stamp)
            if parsed.tzinfo is None:
                raise ValueError("timezone required")
        except ValueError as exc:
            raise ValueError(f"invalid preset {field}") from exc
    settings = _validate_settings(value["settings"])
    return {"id": identity, "name": name, "created_at": value["created_at"],
            "updated_at": value["updated_at"], "settings": settings}


def _copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON numeric constant: {value}")


def _atomic_write(target: Path, content: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".ai-dream-preset-", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        try:
            directory_fd = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        except OSError:
            return
        try:
            os.fsync(directory_fd)
        except OSError:
            pass
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
