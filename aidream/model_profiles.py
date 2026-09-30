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
    "threads_batch", "continuous_batching", "numa", "kv_cache_type_k",
    "kv_cache_type_v", "flash_attention", "unified_kv_cache", "offload_kv_cache",
    "mmap", "keep_model_in_memory", "fit",
}
_GENERATION_KEYS = {
    "system_prompt", "reasoning", "temperature", "max_tokens", "stop_strings",
    "top_p", "top_k", "min_p", "repeat_penalty", "seed", "structured_output",
}
_PROFILE_CLASSES = {
    "safe/default", "balanced", "fast", "max-context", "low-vram",
    "multi-gpu", "capability-specific", "user", "verified", "portable",
    "hardware-bound", "adapted",
}
_VERIFICATION_STATUSES = {"verified", "supported", "probable", "unknown", "failed"}
_CAPABILITY_ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+\Z")
_HARDWARE_SIGNATURE = re.compile(r"hw_[a-f0-9]{16,64}\Z")
_COMPANION_ARTIFACT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_PROFILE_KEYS = {
    "id", "model_id", "name", "runtime_id", "backend_name", "placement", "load",
    "generation", "purpose", "companion_artifacts", "hardware_signature", "profile_class",
    "verification", "verification_summary", "created_at", "updated_at",
}
_VERIFICATION_KEYS = {"status", "runtime_version", "verified_at", "hardware_signature", "details"}
_PROFILE_DEFAULTS = {
    "purpose": [],
    "companion_artifacts": [],
    "hardware_signature": None,
    "profile_class": "user",
    "verification": None,
}


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
    if "verification" in profile and "verification_summary" in profile:
        raise ValueError("provide verification or verification_summary, not both")
    # `verification_summary` was used by an intermediate schema. Accept it as
    # an input/read alias, but always return and persist the documented field.
    if "verification_summary" in profile:
        profile["verification"] = profile.pop("verification_summary")
    # Profiles written before the orchestration fields were introduced stay
    # readable. Defaults are added in memory and become durable on next write.
    for key, default in _PROFILE_DEFAULTS.items():
        if key not in profile:
            profile[key] = _copy_json(default)
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

    purpose = profile["purpose"]
    if (not isinstance(purpose, list) or len(purpose) > 32
            or any(not isinstance(item, str) or len(item) > 128 or not _CAPABILITY_ID.fullmatch(item)
                   for item in purpose)):
        raise ValueError("purpose must be a list of at most 32 namespaced capability IDs")
    if len(purpose) != len(set(purpose)):
        raise ValueError("purpose capability IDs must be unique")
    profile["purpose"] = list(purpose)

    companion_artifacts = profile["companion_artifacts"]
    if (not isinstance(companion_artifacts, list) or len(companion_artifacts) > 32
            or any(not isinstance(item, str) or not _COMPANION_ARTIFACT_ID.fullmatch(item)
                   for item in companion_artifacts)):
        raise ValueError("companion_artifacts must be a list of at most 32 opaque artifact IDs")
    if len(companion_artifacts) != len(set(companion_artifacts)):
        raise ValueError("companion_artifacts IDs must be unique")
    profile["companion_artifacts"] = list(companion_artifacts)

    hardware_signature = profile["hardware_signature"]
    if hardware_signature is not None and (
            not isinstance(hardware_signature, str) or not _HARDWARE_SIGNATURE.fullmatch(hardware_signature)):
        raise ValueError("hardware_signature must be None or an opaque hw_ hash")

    profile_class = profile["profile_class"]
    if not isinstance(profile_class, str) or profile_class not in _PROFILE_CLASSES:
        raise ValueError("profile_class must be one of the supported profile categories")

    verification = profile["verification"]
    if verification is not None:
        if not isinstance(verification, Mapping):
            raise ValueError("verification must be an object or None")
        unknown = set(verification) - _VERIFICATION_KEYS
        if unknown:
            raise ValueError("unsupported verification field(s): " + ", ".join(sorted(map(str, unknown))))
        summary = dict(verification)
        status = summary.get("status")
        if not isinstance(status, str) or status not in _VERIFICATION_STATUSES:
            raise ValueError("verification.status must be a supported verification status")
        for key, max_length in (("runtime_version", 128), ("hardware_signature", 128), ("details", 512)):
            item = summary.get(key)
            if item is not None and (
                    not isinstance(item, str) or not item.strip() or len(item) > max_length
                    or not item.isprintable()):
                raise ValueError(f"verification.{key} must be bounded printable text or None")
        summary_signature = summary.get("hardware_signature")
        if summary_signature is not None and not _HARDWARE_SIGNATURE.fullmatch(summary_signature):
            raise ValueError("verification.hardware_signature must be an opaque hw_ hash")
        verified_at = summary.get("verified_at")
        if verified_at is not None:
            if not isinstance(verified_at, str) or len(verified_at) > 40:
                raise ValueError("verification.verified_at must be a bounded ISO timestamp")
            try:
                parsed = datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValueError("verification.verified_at must be a bounded ISO timestamp") from exc
            if parsed.tzinfo is None:
                raise ValueError("verification.verified_at must include a timezone")
        if status == "verified" and (not summary.get("runtime_version") or not verified_at):
            raise ValueError("verified summaries require runtime_version and verified_at")
        profile["verification"] = _copy_json(summary)

    if profile_class == "hardware-bound" and hardware_signature is None:
        raise ValueError("hardware-bound profiles require hardware_signature")
    if profile_class == "verified" and (
            verification is None or verification.get("status") != "verified"):
        raise ValueError("verified profiles require a verified verification object")
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
        if "verification" in changes and "verification_summary" in changes:
            raise ValueError("provide verification or verification_summary, not both")
        records = self._read()
        for index, current in enumerate(records):
            if current["id"] == identity:
                updated = dict(current)
                normalized_changes = dict(changes)
                if "verification_summary" in normalized_changes:
                    normalized_changes["verification"] = normalized_changes.pop("verification_summary")
                for key, value in normalized_changes.items():
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
