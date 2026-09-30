"""Typed, bounded metadata contracts for orchestration artifacts.

This module defines JSON metadata only. It deliberately does not read, write,
or resolve artifact bytes or storage keys.
"""
from __future__ import annotations

import json
import math
import re
from typing import Literal, TypedDict


ArtifactKind = Literal[
    "text", "chat_messages", "json", "image", "audio", "video", "document",
    "embedding_batch", "rerank_candidates", "file_reference", "screen_frame",
    "tool_result", "model_reference",
]
ArtifactLifetime = Literal["ephemeral", "session", "persistent"]
ArtifactStorageType = Literal["run-local", "session", "persistent"]
ArtifactOwnerType = Literal["run", "session", "user"]

ARTIFACT_KINDS: frozenset[str] = frozenset({
    "text", "chat_messages", "json", "image", "audio", "video", "document",
    "embedding_batch", "rerank_candidates", "file_reference", "screen_frame",
    "tool_result", "model_reference",
})
ARTIFACT_LIFETIMES: frozenset[str] = frozenset({"ephemeral", "session", "persistent"})
ARTIFACT_STORAGE_TYPES: frozenset[str] = frozenset({"run-local", "session", "persistent"})

MAX_ARTIFACT_ID_LENGTH = 80
MAX_MEDIA_TYPE_LENGTH = 127
MAX_ARTIFACT_NAME_LENGTH = 255
MAX_STORAGE_KEY_LENGTH = 512
MAX_OWNER_ID_LENGTH = 128
MAX_METADATA_KEYS = 32
MAX_METADATA_DEPTH = 4
MAX_METADATA_STRING_LENGTH = 1024
MAX_METADATA_ARRAY_ITEMS = 64
MAX_METADATA_BYTES = 8192
MAX_ARTIFACT_SIZE_BYTES = (1 << 63) - 1

_ID_RE = re.compile(r"art_[A-Za-z0-9_-]{1,75}\Z")
_MEDIA_TYPE_RE = re.compile(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+\Z")
_OPAQUE_KEY_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,511}\Z")
_OWNER_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
_METADATA_KEY_RE = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,63}\Z")


class ArtifactStorage(TypedDict):
    """Opaque storage reference; never a host filesystem path."""

    type: ArtifactStorageType
    key: str


class ArtifactOwner(TypedDict):
    type: ArtifactOwnerType
    id: str


class ArtifactEnvelope(TypedDict):
    """Public metadata envelope. Binary content is always stored separately."""

    schema_version: int
    id: str
    kind: ArtifactKind
    media_type: str
    name: str
    storage: ArtifactStorage
    size_bytes: int
    lifetime: ArtifactLifetime
    owner: ArtifactOwner
    metadata: dict[str, object]


def validate_artifact_envelope(value: object) -> ArtifactEnvelope:
    """Validate and return a detached artifact envelope.

    This rejects unsafe or unbounded metadata before it crosses a component or
    API boundary. It does not verify that the referenced storage object exists.
    """
    if not isinstance(value, dict):
        raise ValueError("artifact envelope must be an object")
    required = {
        "schema_version", "id", "kind", "media_type", "name", "storage",
        "size_bytes", "lifetime", "owner", "metadata",
    }
    if set(value) != required:
        missing, extra = required - set(value), set(value) - required
        if missing:
            raise ValueError(f"artifact envelope missing fields: {', '.join(sorted(missing))}")
        raise ValueError(f"artifact envelope has unsupported fields: {', '.join(sorted(map(str, extra)))}")

    if value["schema_version"] != 1 or isinstance(value["schema_version"], bool):
        raise ValueError("unsupported artifact schema_version")
    artifact_id = value["id"]
    if not isinstance(artifact_id, str) or len(artifact_id) > MAX_ARTIFACT_ID_LENGTH or not _ID_RE.fullmatch(artifact_id):
        raise ValueError("artifact id must be a bounded art_ identifier")
    kind = value["kind"]
    if not isinstance(kind, str) or kind not in ARTIFACT_KINDS:
        raise ValueError("unsupported artifact kind")
    media_type = value["media_type"]
    if not isinstance(media_type, str) or len(media_type) > MAX_MEDIA_TYPE_LENGTH or not _MEDIA_TYPE_RE.fullmatch(media_type):
        raise ValueError("media_type must be a valid bounded type/subtype")
    name = value["name"]
    if (not isinstance(name, str) or not name or len(name) > MAX_ARTIFACT_NAME_LENGTH
            or not name.isprintable() or "/" in name or "\\" in name or name in {".", ".."}):
        raise ValueError("artifact name must be a printable filename without a path")
    size = value["size_bytes"]
    if isinstance(size, bool) or not isinstance(size, int) or not 0 <= size <= MAX_ARTIFACT_SIZE_BYTES:
        raise ValueError("size_bytes must be a non-negative bounded integer")

    lifetime = value["lifetime"]
    if not isinstance(lifetime, str) or lifetime not in ARTIFACT_LIFETIMES:
        raise ValueError("unsupported artifact lifetime")
    storage = _validate_storage(value["storage"])
    owner = _validate_owner(value["owner"])
    metadata = value["metadata"]
    if not isinstance(metadata, dict) or len(metadata) > MAX_METADATA_KEYS:
        raise ValueError(f"metadata must be an object with at most {MAX_METADATA_KEYS} keys")
    clean_metadata = _validate_json_object(metadata)
    encoded = json.dumps(clean_metadata, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_METADATA_BYTES:
        raise ValueError(f"metadata exceeds {MAX_METADATA_BYTES} encoded bytes")

    # Return a detached envelope so callers cannot mutate validated nested data.
    return {
        "schema_version": 1,
        "id": artifact_id,
        "kind": kind,  # type: ignore[typeddict-item]
        "media_type": media_type,
        "name": name,
        "storage": storage,
        "size_bytes": size,
        "lifetime": lifetime,  # type: ignore[typeddict-item]
        "owner": owner,
        "metadata": clean_metadata,
    }


def _validate_storage(value: object) -> ArtifactStorage:
    if not isinstance(value, dict) or set(value) != {"type", "key"}:
        raise ValueError("storage must contain exactly type and key")
    storage_type, key = value["type"], value["key"]
    if not isinstance(storage_type, str) or storage_type not in ARTIFACT_STORAGE_TYPES:
        raise ValueError("unsupported artifact storage type")
    if not isinstance(key, str) or len(key) > MAX_STORAGE_KEY_LENGTH or not _OPAQUE_KEY_RE.fullmatch(key):
        raise ValueError("storage key must be a bounded opaque key, not a path")
    return {"type": storage_type, "key": key}  # type: ignore[typeddict-item]


def _validate_owner(value: object) -> ArtifactOwner:
    if not isinstance(value, dict) or set(value) != {"type", "id"}:
        raise ValueError("owner must contain exactly type and id")
    owner_type, owner_id = value["type"], value["id"]
    if owner_type not in {"run", "session", "user"}:
        raise ValueError("unsupported artifact owner type")
    if not isinstance(owner_id, str) or len(owner_id) > MAX_OWNER_ID_LENGTH or not _OWNER_ID_RE.fullmatch(owner_id):
        raise ValueError("owner id must be bounded text")
    return {"type": owner_type, "id": owner_id}  # type: ignore[typeddict-item]


def _validate_json_object(value: dict[object, object]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not _METADATA_KEY_RE.fullmatch(key):
            raise ValueError("metadata keys must be bounded identifier-like strings")
        result[key] = _validate_json_value(item, depth=1)
    return result


def _validate_json_value(value: object, *, depth: int) -> object:
    if depth > MAX_METADATA_DEPTH:
        raise ValueError("metadata nesting is too deep")
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("metadata numbers must be finite")
        return value
    if isinstance(value, str):
        if len(value) > MAX_METADATA_STRING_LENGTH or not value.isprintable():
            raise ValueError("metadata strings must be printable and bounded")
        return value
    if isinstance(value, list):
        if len(value) > MAX_METADATA_ARRAY_ITEMS:
            raise ValueError("metadata arrays contain too many items")
        return [_validate_json_value(item, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        if len(value) > MAX_METADATA_KEYS:
            raise ValueError("nested metadata object contains too many keys")
        nested: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str) or not _METADATA_KEY_RE.fullmatch(key):
                raise ValueError("metadata keys must be bounded identifier-like strings")
            nested[key] = _validate_json_value(item, depth=depth + 1)
        return nested
    raise ValueError("metadata values must be JSON-compatible primitives, arrays, or objects")
