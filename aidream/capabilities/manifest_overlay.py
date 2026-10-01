"""Atomic persistence for user-owned model manifest metadata overlays."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
import threading
from typing import Any, Mapping


_VERSION = 1
_MAX_BYTES = 1024 * 1024
_MAX_MANIFESTS = 4096
_MANIFEST_ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+\Z")
_EDITABLE_FIELDS = frozenset({
    "display_name", "description", "family", "variant", "modalities",
    "defaults", "ui", "resource_hints",
})
_USER_PROVENANCE = {
    "source": "user_override", "status": "unknown",
    "details": "User metadata override; not runtime verification evidence.",
}


def default_manifest_overlay_path() -> Path:
    config_home = os.environ.get("XDG_CONFIG_HOME")
    root = Path(config_home).expanduser() if config_home and Path(config_home).expanduser().is_absolute() else Path.home() / ".config"
    return root / "ai-dream" / "model-manifest-overrides.json"


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


class UserManifestOverlayStore:
    """Versioned XDG store for editable descriptive metadata, never verification."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        self.path = Path(path).expanduser() if path is not None else default_manifest_overlay_path()
        self._lock = threading.RLock()

    def list_overrides(self) -> tuple[dict[str, Any], ...]:
        with self._lock:
            stored = self._read()
            return tuple(_json_copy(stored["overrides"][key]) for key in sorted(stored["overrides"]))

    def get(self, manifest_id: str) -> dict[str, Any] | None:
        _validate_manifest_id(manifest_id)
        with self._lock:
            item = self._read()["overrides"].get(manifest_id)
            return None if item is None else _json_copy(item)

    def patch(self, manifest_id: str, changes: Mapping[str, Any]) -> dict[str, Any] | None:
        _validate_manifest_id(manifest_id)
        with self._lock:
            stored = self._read()
            updated, item = self._apply_patch(stored, manifest_id, changes)
            self._write(updated)
            return item

    def preview(self, manifest_id: str, changes: Mapping[str, Any]) -> dict[str, Any] | None:
        """Validate and compute a patch without changing the persistent file."""
        _validate_manifest_id(manifest_id)
        with self._lock:
            updated, item = self._apply_patch(self._read(), manifest_id, changes)
            return item

    @staticmethod
    def _apply_patch(stored: dict[str, Any], manifest_id: str,
                     changes: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
        if not isinstance(changes, Mapping):
            raise ValueError("manifest metadata patch must be an object")
        if set(changes) == {"reset"} and changes["reset"] is True:
            stored["overrides"].pop(manifest_id, None)
            return stored, None
        extra = set(changes) - _EDITABLE_FIELDS
        if extra:
            raise ValueError("unsupported user manifest metadata field(s): " + ", ".join(sorted(map(str, extra))))
        if not changes:
            raise ValueError("manifest metadata patch must include at least one editable field")
        current = stored["overrides"].get(manifest_id, {"id": manifest_id})
        for field, value in changes.items():
            if value is None:
                current.pop(field, None)
            else:
                current[field] = _merge_json(current.get(field), _json_copy(value))
        current["id"] = manifest_id
        if len(current) == 1:
            stored["overrides"].pop(manifest_id, None)
            return stored, None
        # This evidence describes the user-authored overlay only. Capability
        # evidence stays in its original layer and is never promoted here.
        current["provenance"] = dict(_USER_PROVENANCE)
        stored["overrides"][manifest_id] = current
        return stored, _json_copy(current)

    def _read(self) -> dict[str, Any]:
        try:
            stat = self.path.stat()
            if stat.st_size > _MAX_BYTES:
                raise ValueError("model manifest overrides exceed the size limit")
            payload = json.loads(self.path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
        except FileNotFoundError:
            return {"version": _VERSION, "overrides": {}}
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"Could not read model manifest overrides: {exc}") from exc
        if (not isinstance(payload, dict) or set(payload) != {"version", "overrides"}
                or type(payload["version"]) is not int or payload["version"] != _VERSION
                or not isinstance(payload["overrides"], dict)
                or len(payload["overrides"]) > _MAX_MANIFESTS):
            raise ValueError("model manifest overrides store has an unsupported shape or version")
        clean = {}
        for manifest_id, override in payload["overrides"].items():
            _validate_manifest_id(manifest_id)
            if not isinstance(override, dict) or override.get("id") != manifest_id:
                raise ValueError("model manifest override entry is invalid")
            if set(override) - (_EDITABLE_FIELDS | {"id", "provenance"}):
                raise ValueError("model manifest override contains a protected field")
            if len(override) > 1 and override.get("provenance") != _USER_PROVENANCE:
                raise ValueError("model manifest override contains invalid user provenance")
            clean[manifest_id] = override
        return {"version": _VERSION, "overrides": clean}

    def _write(self, value: Mapping[str, Any]) -> None:
        payload = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        encoded = payload.encode("utf-8")
        if len(encoded) > _MAX_BYTES:
            raise ValueError("model manifest overrides exceed the size limit")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent)
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


def _validate_manifest_id(value: Any) -> None:
    if not isinstance(value, str) or len(value) > 256 or not _MANIFEST_ID.fullmatch(value):
        raise ValueError("invalid model manifest ID")


def _reject_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def _merge_json(old: Any, new: Any) -> Any:
    if isinstance(old, dict) and isinstance(new, Mapping):
        result = _json_copy(old)
        for key, value in new.items():
            result[key] = _merge_json(result.get(key), value)
        return result
    return new


__all__ = ["UserManifestOverlayStore", "default_manifest_overlay_path"]
