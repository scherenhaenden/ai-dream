"""Atomic local persistence for semantic capability selection preferences."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Mapping

from .contracts import validate_capability_id


_STORE_VERSION = 1
_MAX_STORE_BYTES = 1024 * 1024
_MAX_CAPABILITIES = 256
_MAX_MODEL_ID_LENGTH = 256
_MODEL_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,255}\Z")
_PROFILE_ID_RE = re.compile(r"[a-f0-9]{32}\Z")
_PREFERENCE_KEYS = {"model_id", "profile_id"}
_SELECTION_KEYS = {"mode", "prefer_verified", "prefer_loaded", "resource_headroom_percent",
                   "unknown_resource_policy", "eviction_policy", "assisted_planner_enabled"}
_DEFAULTS: dict[str, Any] = {
    "capability_preferences": {},
    "selection_defaults": {
        "mode": "auto",
        "prefer_verified": True,
        "prefer_loaded": True,
        "resource_headroom_percent": 10,
        "unknown_resource_policy": "allow",
        "eviction_policy": "lru",
        "assisted_planner_enabled": False,
    },
}


def default_capability_preferences_path() -> Path:
    """Return the XDG config file for semantic capability preferences."""
    xdg = os.environ.get("XDG_CONFIG_HOME")
    root = Path(xdg).expanduser() if xdg and Path(xdg).expanduser().is_absolute() else Path.home() / ".config"
    return root / "ai-dream" / "capability-preferences.json"


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def _validate_preference(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("capability preference must be an object")
    extra = set(value) - _PREFERENCE_KEYS
    if extra:
        raise ValueError("unsupported capability preference field(s): " + ", ".join(sorted(map(str, extra))))
    if not value:
        raise ValueError("capability preference must select a model_id or profile_id")
    result: dict[str, str] = {}
    if "model_id" in value:
        model_id = value["model_id"]
        if (not isinstance(model_id, str) or len(model_id) > _MAX_MODEL_ID_LENGTH
                or not _MODEL_ID_RE.fullmatch(model_id)):
            raise ValueError("model_id must be a bounded opaque model identifier")
        result["model_id"] = model_id
    if "profile_id" in value:
        profile_id = value["profile_id"]
        if not isinstance(profile_id, str) or not _PROFILE_ID_RE.fullmatch(profile_id):
            raise ValueError("profile_id must be a 32-character profile identifier")
        result["profile_id"] = profile_id
    return result


def _validate_capability_preferences(value: Any, *, allow_removals: bool = False) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("capability_preferences must be an object")
    if len(value) > _MAX_CAPABILITIES:
        raise ValueError(f"capability_preferences may contain at most {_MAX_CAPABILITIES} entries")
    result: dict[str, Any] = {}
    for raw_id, preference in value.items():
        try:
            capability_id = validate_capability_id(raw_id)
        except (TypeError, ValueError) as exc:
            raise ValueError("capability_preferences contains an invalid capability ID") from exc
        if preference is None and allow_removals:
            result[capability_id] = None
        else:
            result[capability_id] = _validate_preference(preference)
    return result


def _validate_selection_defaults(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("selection_defaults must be an object")
    extra = set(value) - _SELECTION_KEYS
    if extra:
        raise ValueError("unsupported selection_defaults field(s): " + ", ".join(sorted(map(str, extra))))
    defaults = dict(_DEFAULTS["selection_defaults"])
    defaults.update(value)
    mode = defaults["mode"]
    if not isinstance(mode, str) or mode not in {"auto", "guided", "manual"}:
        raise ValueError("selection_defaults.mode must be 'auto', 'guided', or 'manual'")
    eviction_policy = defaults["eviction_policy"]
    if not isinstance(eviction_policy, str) or eviction_policy not in {"lru", "never"}:
        raise ValueError("selection_defaults.eviction_policy must be 'lru' or 'never'")
    if not isinstance(defaults["assisted_planner_enabled"], bool):
        raise ValueError("selection_defaults.assisted_planner_enabled must be a boolean")
    unknown_resource_policy = defaults["unknown_resource_policy"]
    if not isinstance(unknown_resource_policy, str) or unknown_resource_policy not in {"allow", "reject"}:
        raise ValueError("selection_defaults.unknown_resource_policy must be 'allow' or 'reject'")
    for key in ("prefer_verified", "prefer_loaded"):
        if not isinstance(defaults[key], bool):
            raise ValueError(f"selection_defaults.{key} must be a boolean")
    headroom = defaults["resource_headroom_percent"]
    if isinstance(headroom, bool) or not isinstance(headroom, int) or not 0 <= headroom <= 100:
        raise ValueError("selection_defaults.resource_headroom_percent must be an integer from 0 to 100")
    return defaults


def _validate_store(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("capability preferences store must be an object")
    expected = {"version", "capability_preferences", "selection_defaults"}
    if set(value) != expected:
        missing, extra = expected - set(value), set(value) - expected
        if missing:
            raise ValueError("capability preferences store missing fields: " + ", ".join(sorted(missing)))
        raise ValueError("unsupported capability preferences store field(s): " + ", ".join(sorted(map(str, extra))))
    version = value["version"]
    if isinstance(version, bool) or version != _STORE_VERSION:
        raise ValueError("unsupported capability preferences store version")
    return {
        "version": _STORE_VERSION,
        "capability_preferences": _validate_capability_preferences(value["capability_preferences"]),
        "selection_defaults": _validate_selection_defaults(value["selection_defaults"]),
    }


class CapabilityPreferenceStore:
    """Versioned XDG JSON store for preferred models/profiles per capability."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        self.path = Path(path).expanduser() if path is not None else default_capability_preferences_path()

    def get(self) -> dict[str, Any]:
        """Return detached preferences, including defaults for a missing file."""
        stored = self._read()
        if stored is None:
            return _json_copy(_DEFAULTS)
        return _json_copy({key: stored[key] for key in ("capability_preferences", "selection_defaults")})

    def patch(self, changes: Mapping[str, Any]) -> dict[str, Any]:
        """Merge validated capability preferences and selection defaults.

        A `None` value in a capability preference patch removes that capability
        selection. Omitted keys retain their current values.
        """
        if not isinstance(changes, Mapping):
            raise ValueError("capability preferences patch must be an object")
        extra = set(changes) - {"capability_preferences", "selection_defaults"}
        if extra:
            raise ValueError("unsupported capability preferences field(s): " + ", ".join(sorted(map(str, extra))))
        current = self._read() or {
            "version": _STORE_VERSION,
            **_json_copy(_DEFAULTS),
        }
        if "capability_preferences" in changes:
            patch = _validate_capability_preferences(changes["capability_preferences"], allow_removals=True)
            preferences = dict(current["capability_preferences"])
            for capability_id, preference in patch.items():
                if preference is None:
                    preferences.pop(capability_id, None)
                else:
                    preferences[capability_id] = preference
            current["capability_preferences"] = _validate_capability_preferences(preferences)
        if "selection_defaults" in changes:
            incoming_defaults = changes["selection_defaults"]
            if not isinstance(incoming_defaults, Mapping):
                raise ValueError("selection_defaults must be an object")
            merged_defaults = dict(current["selection_defaults"])
            merged_defaults.update(incoming_defaults)
            current["selection_defaults"] = _validate_selection_defaults(merged_defaults)
        self._write(current)
        return self.get()

    def set_capability_preference(self, capability_id: str, preference: Mapping[str, Any] | None) -> dict[str, Any]:
        """Set or clear one capability's model/profile selection."""
        return self.patch({"capability_preferences": {capability_id: preference}})

    def _read(self) -> dict[str, Any] | None:
        try:
            if self.path.stat().st_size > _MAX_STORE_BYTES:
                raise ValueError("capability preferences store exceeds the size limit")
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except (OSError, UnicodeError) as exc:
            raise ValueError(f"Could not read capability preferences: {exc}") from exc
        try:
            payload = json.loads(text, parse_constant=_reject_json_constant)
        except (ValueError, TypeError) as exc:
            raise ValueError("capability preferences store contains invalid JSON") from exc
        return _validate_store(payload)

    def _write(self, value: Mapping[str, Any]) -> None:
        store = _validate_store(value)
        payload = json.dumps(store, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        encoded = payload.encode("utf-8")
        if len(encoded) > _MAX_STORE_BYTES:
            raise ValueError("capability preferences store exceeds the size limit")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent,
        )
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            try:
                directory = os.open(self.path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            except OSError:
                pass
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


__all__ = ["CapabilityPreferenceStore", "default_capability_preferences_path"]
