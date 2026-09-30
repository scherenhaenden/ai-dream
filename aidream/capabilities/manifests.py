"""Versioned model manifest contracts and validation.

A manifest adds semantic identity and orchestration metadata to discovered
artifacts. It does not imply that the model is runnable or verified.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
import re
from types import MappingProxyType
from typing import Any, Mapping

from .contracts import (
    CapabilityDeclaration,
    Evidence,
    EvidenceSource,
    EvidenceStatus,
    Modality,
    _enum_value,
)


CURRENT_SCHEMA_VERSION = 1
_MAX_ID_LENGTH = 256
_MAX_MODEL_KEY_LENGTH = 512
_MAX_DISPLAY_NAME_LENGTH = 200
_MAX_DESCRIPTION_LENGTH = 4000
_MAX_JSON_DEPTH = 16
_MAX_JSON_NODES = 20_000
_MANIFEST_ID_RE = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+\Z")
_MODEL_KEY_RE = re.compile(r"[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)*\Z")
_ROLE_RE = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")


def _bounded_text(value: Any, field: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum or "\x00" in value:
        raise ValueError(f"{field} must be non-empty text of at most {maximum} characters")
    return value.strip()


def _freeze_json(value: Any, field: str, *, max_nodes: int = _MAX_JSON_NODES) -> Any:
    """Validate bounded JSON data and return a detached immutable copy."""
    remaining = [max_nodes]

    def freeze(item: Any, depth: int) -> Any:
        remaining[0] -= 1
        if remaining[0] < 0 or depth > _MAX_JSON_DEPTH:
            raise ValueError(f"{field} exceeds the JSON structure limits")
        if item is None or isinstance(item, (bool, int)):
            return item
        if isinstance(item, float):
            if not math.isfinite(item):
                raise ValueError(f"{field} contains a non-finite number")
            return item
        if isinstance(item, str):
            if len(item) > _MAX_DESCRIPTION_LENGTH or "\x00" in item:
                raise ValueError(f"{field} contains invalid or oversized text")
            return item
        if isinstance(item, Mapping):
            if any(not isinstance(key, str) or not key or len(key) > 128 for key in item):
                raise ValueError(f"{field} object keys must be bounded non-empty strings")
            return MappingProxyType({key: freeze(item[key], depth + 1) for key in sorted(item)})
        if isinstance(item, (list, tuple)):
            return tuple(freeze(child, depth + 1) for child in item)
        raise ValueError(f"{field} must contain JSON-compatible values")

    return freeze(value, 0)


def _thaw_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw_json(value[key]) for key in sorted(value)}
    if isinstance(value, tuple):
        return [_thaw_json(item) for item in value]
    return value


def _string_list(value: Any, field: str, *, max_items: int = 128, max_length: int = 256) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)) or len(value) > max_items:
        raise ValueError(f"{field} must be a list with at most {max_items} items")
    result = []
    for item in value:
        text = _bounded_text(item, field, max_length)
        result.append(text)
    if len(set(result)) != len(result):
        raise ValueError(f"{field} must not contain duplicates")
    return tuple(result)


@dataclass(frozen=True, slots=True)
class ModelArtifact:
    """Reference to one installed/discovered artifact used by a model."""

    role: str
    artifact_id: str
    optional: bool = False
    extensions: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        role = _bounded_text(self.role, "artifact role", 64)
        if not _ROLE_RE.fullmatch(role):
            raise ValueError("artifact role must be a lowercase identifier")
        object.__setattr__(self, "role", role)
        object.__setattr__(self, "artifact_id", _bounded_text(self.artifact_id, "artifact_id", 512))
        if not isinstance(self.optional, bool):
            raise ValueError("artifact optional must be a boolean")
        if not isinstance(self.extensions, Mapping):
            raise ValueError("artifact extensions must be an object")
        object.__setattr__(self, "extensions", _freeze_json(self.extensions, "artifact extensions"))

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> ModelArtifact:
        if not isinstance(value, Mapping):
            raise ValueError("each artifact must be an object")
        if "model_id" in value and "artifact_id" in value:
            raise ValueError("artifact must specify model_id or artifact_id, not both")
        identity_key = "model_id" if "model_id" in value else "artifact_id"
        if "role" not in value or identity_key not in value:
            raise ValueError("artifact requires role and model_id/artifact_id")
        known = {"role", "model_id", "artifact_id", "optional"}
        return cls(
            role=value["role"],
            artifact_id=value[identity_key],
            optional=value.get("optional", False),
            extensions={key: item for key, item in value.items() if key not in known},
        )

    def to_dict(self) -> dict[str, Any]:
        result = {"role": self.role, "model_id": self.artifact_id, "optional": self.optional}
        result.update(_thaw_json(self.extensions))
        return result


@dataclass(frozen=True, slots=True)
class RuntimeCompatibility:
    runtime_kind: str
    formats: tuple[str, ...] = ()
    required_features: tuple[str, ...] = ()
    preferred: bool = False
    extensions: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "runtime_kind", _bounded_text(self.runtime_kind, "runtime_kind", 128))
        if not isinstance(self.preferred, bool):
            raise ValueError("runtime compatibility preferred must be a boolean")
        object.__setattr__(self, "formats", _string_list(self.formats, "runtime formats"))
        object.__setattr__(self, "required_features", _string_list(self.required_features, "required_features"))
        object.__setattr__(self, "extensions", _freeze_json(self.extensions, "runtime compatibility extensions"))

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> RuntimeCompatibility:
        if not isinstance(value, Mapping) or "runtime_kind" not in value:
            raise ValueError("runtime compatibility entry requires runtime_kind")
        formats = _string_list(value.get("formats", ()), "runtime formats")
        required_features = _string_list(value.get("required_features", ()), "required_features")
        known = {"runtime_kind", "formats", "required_features", "preferred"}
        return cls(
            runtime_kind=value["runtime_kind"],
            formats=formats,
            required_features=required_features,
            preferred=value.get("preferred", False),
            extensions={key: item for key, item in value.items() if key not in known},
        )

    def to_dict(self) -> dict[str, Any]:
        result = {
            "runtime_kind": self.runtime_kind,
            "formats": list(self.formats),
            "required_features": list(self.required_features),
            "preferred": self.preferred,
        }
        result.update(_thaw_json(self.extensions))
        return result


def _parse_record_list(value: Any, field: str, required_key: str) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, (list, tuple)) or len(value) > 1024:
        raise ValueError(f"{field} must be a list with at most 1024 entries")
    result = []
    for item in value:
        if not isinstance(item, Mapping) or required_key not in item:
            raise ValueError(f"each {field} entry must be an object with {required_key}")
        result.append(_freeze_json(item, field))
    return tuple(result)


def _parse_dependencies(value: Any) -> tuple[Mapping[str, Any], ...]:
    records = _parse_record_list(value, "dependencies", "role")
    for record in records:
        role = record["role"]
        if not isinstance(role, str) or not _ROLE_RE.fullmatch(role):
            raise ValueError("dependency role must be a lowercase identifier")
        required = record.get("required", True)
        if not isinstance(required, bool):
            raise ValueError("dependency required must be a boolean")
        if "selector" in record and not isinstance(record["selector"], Mapping):
            raise ValueError("dependency selector must be an object")
    return records


def _parse_resource_hints(value: Any) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("resource_hints must be an object")
    for key in ("ram_bytes_estimate", "vram_bytes_estimate", "disk_working_bytes_estimate"):
        if key in value:
            number = value[key]
            if type(number) is not int or not 0 <= number <= 2**63 - 1:
                raise ValueError(f"resource_hints.{key} must be a non-negative 64-bit integer")
    for key in ("supports_partial_gpu_offload", "supports_multi_gpu"):
        if key in value and not isinstance(value[key], bool):
            raise ValueError(f"resource_hints.{key} must be a boolean")
    if "warmup_cost" in value:
        warmup_cost = value["warmup_cost"]
        if not isinstance(warmup_cost, str) or warmup_cost not in {"low", "medium", "high"}:
            raise ValueError("resource_hints.warmup_cost must be low, medium, or high")
    return _freeze_json(value, "resource_hints")


def _parse_modalities(value: Any) -> Mapping[str, tuple[Modality, ...]]:
    if not isinstance(value, Mapping):
        raise ValueError("modalities must be an object")
    unknown = set(value) - {"inputs", "outputs"}
    if unknown:
        raise ValueError("unsupported modalities field(s): " + ", ".join(sorted(map(str, unknown))))
    parsed: dict[str, tuple[Modality, ...]] = {}
    for direction in ("inputs", "outputs"):
        items = value.get(direction, ())
        if not isinstance(items, (list, tuple)) or len(items) > 64:
            raise ValueError(f"modalities.{direction} must be a list with at most 64 items")
        try:
            parsed[direction] = tuple(Modality(_enum_value(Modality, item, "modality")) for item in items)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"modalities.{direction} contains an unsupported modality") from exc
        if len(set(parsed[direction])) != len(parsed[direction]):
            raise ValueError(f"modalities.{direction} must not contain duplicates")
    return MappingProxyType(parsed)


@dataclass(frozen=True, slots=True)
class ModelManifest:
    """Validated semantic model identity and orchestration metadata."""

    schema_version: int
    id: str
    display_name: str
    artifacts: tuple[ModelArtifact, ...]
    capabilities: tuple[CapabilityDeclaration, ...]
    provenance: Evidence
    model_key: str | None = None
    description: str | None = None
    family: str | None = None
    variant: str | None = None
    modalities: Mapping[str, tuple[Modality, ...]] = field(default_factory=lambda: {"inputs": (), "outputs": ()})
    runtime_compatibility: tuple[RuntimeCompatibility, ...] = ()
    dependencies: tuple[Mapping[str, Any], ...] = ()
    resource_hints: Mapping[str, Any] = field(default_factory=dict)
    defaults: Mapping[str, Any] = field(default_factory=dict)
    ui: Mapping[str, Any] = field(default_factory=dict)
    extensions: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if type(self.schema_version) is not int or self.schema_version != CURRENT_SCHEMA_VERSION:
            raise ValueError(f"unsupported manifest schema_version: {self.schema_version}")
        manifest_id = _bounded_text(self.id, "manifest id", _MAX_ID_LENGTH)
        if not _MANIFEST_ID_RE.fullmatch(manifest_id):
            raise ValueError("manifest id must be a lowercase namespaced identifier")
        object.__setattr__(self, "id", manifest_id)
        if self.model_key is not None:
            model_key = _bounded_text(self.model_key, "model_key", _MAX_MODEL_KEY_LENGTH)
            if not _MODEL_KEY_RE.fullmatch(model_key):
                raise ValueError("model_key must be a stable lowercase semantic key")
            object.__setattr__(self, "model_key", model_key)
        object.__setattr__(self, "display_name", _bounded_text(self.display_name, "display_name", _MAX_DISPLAY_NAME_LENGTH))
        if self.description is not None:
            object.__setattr__(self, "description", _bounded_text(self.description, "description", _MAX_DESCRIPTION_LENGTH))
        for field in ("family", "variant"):
            value = getattr(self, field)
            if value is not None:
                object.__setattr__(self, field, _bounded_text(value, field, 128))
        if not isinstance(self.provenance, Evidence):
            raise ValueError("provenance must be an Evidence value")
        if any(not isinstance(item, ModelArtifact) for item in self.artifacts):
            raise ValueError("artifacts must contain ModelArtifact values")
        if any(not isinstance(item, CapabilityDeclaration) for item in self.capabilities):
            raise ValueError("capabilities must contain CapabilityDeclaration values")
        if len({item.id for item in self.capabilities}) != len(self.capabilities):
            raise ValueError("capability IDs must be unique within a manifest")
        object.__setattr__(self, "artifacts", tuple(self.artifacts))
        object.__setattr__(self, "capabilities", tuple(sorted(self.capabilities, key=lambda item: str(item.id))))
        object.__setattr__(self, "modalities", _parse_modalities(self.modalities))
        if any(not isinstance(item, RuntimeCompatibility) for item in self.runtime_compatibility):
            raise ValueError("runtime_compatibility must contain RuntimeCompatibility values")
        object.__setattr__(self, "runtime_compatibility", tuple(self.runtime_compatibility))
        object.__setattr__(self, "dependencies", _parse_dependencies(self.dependencies))
        object.__setattr__(self, "resource_hints", _parse_resource_hints(self.resource_hints))
        for field in ("resource_hints", "defaults", "ui", "extensions"):
            value = getattr(self, field)
            if not isinstance(value, Mapping):
                raise ValueError(f"{field} must be an object")
            if field != "resource_hints":
                object.__setattr__(self, field, _freeze_json(value, field))

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> ModelManifest:
        if not isinstance(value, Mapping):
            raise ValueError("model manifest must be an object")
        required = {"schema_version", "id", "display_name", "artifacts", "capabilities", "provenance"}
        missing = required - set(value)
        if missing:
            raise ValueError("model manifest missing required field(s): " + ", ".join(sorted(missing)))
        if type(value["schema_version"]) is not int or value["schema_version"] != CURRENT_SCHEMA_VERSION:
            raise ValueError(f"unsupported manifest schema_version: {value['schema_version']}")
        for field in ("artifacts", "capabilities"):
            if not isinstance(value[field], (list, tuple)) or len(value[field]) > 1024:
                raise ValueError(f"{field} must be a list with at most 1024 entries")
        artifacts = tuple(ModelArtifact.from_mapping(item) for item in value["artifacts"])
        capabilities = tuple(
            item if isinstance(item, CapabilityDeclaration) else CapabilityDeclaration.from_mapping(item)
            for item in value["capabilities"]
        )
        provenance = value["provenance"]
        if isinstance(provenance, Evidence):
            evidence = provenance
        elif isinstance(provenance, Mapping):
            evidence = (
                Evidence(EvidenceSource.UNKNOWN, EvidenceStatus.UNKNOWN)
                if not provenance
                else Evidence.from_mapping(provenance)
            )
        else:
            raise ValueError("provenance must be an evidence object")
        compatibility = value.get("runtime_compatibility", ())
        if not isinstance(compatibility, (list, tuple)) or len(compatibility) > 256:
            raise ValueError("runtime_compatibility must be a list with at most 256 entries")
        known = {
            "schema_version", "id", "model_key", "display_name", "description", "family", "variant",
            "artifacts", "capabilities", "modalities", "runtime_compatibility", "dependencies",
            "resource_hints", "defaults", "provenance", "ui",
        }
        return cls(
            schema_version=value["schema_version"],
            id=value["id"],
            display_name=value["display_name"],
            artifacts=artifacts,
            capabilities=capabilities,
            provenance=evidence,
            model_key=value.get("model_key"),
            description=value.get("description"),
            family=value.get("family"),
            variant=value.get("variant"),
            modalities=_parse_modalities(value.get("modalities", {})),
            runtime_compatibility=tuple(RuntimeCompatibility.from_mapping(item) for item in compatibility),
            dependencies=_parse_dependencies(value.get("dependencies", ())),
            resource_hints=value.get("resource_hints", {}),
            defaults=value.get("defaults", {}),
            ui=value.get("ui", {}),
            extensions={key: item for key, item in value.items() if key not in known},
        )

    def to_dict(self) -> dict[str, Any]:
        """Return a detached, stable JSON-ready representation."""
        result: dict[str, Any] = {
            "schema_version": self.schema_version,
            "id": self.id,
            "display_name": self.display_name,
            "artifacts": [item.to_dict() for item in self.artifacts],
            "capabilities": [
                {
                    "id": str(item.id),
                    "inputs": [
                        {"kind": artifact.kind.value, **({"media_types": list(artifact.media_types)} if artifact.media_types else {})}
                        for artifact in item.inputs
                    ],
                    "outputs": [
                        {"kind": artifact.kind.value, **({"media_types": list(artifact.media_types)} if artifact.media_types else {})}
                        for artifact in item.outputs
                    ],
                    "features": sorted(item.features),
                    "evidence": {
                        "source": item.evidence.source.value,
                        "status": item.evidence.status.value,
                        **({"confidence": item.evidence.confidence.value} if item.evidence.confidence else {}),
                        **({"verified_at": item.evidence.verified_at} if item.evidence.verified_at else {}),
                        **({"details": item.evidence.details} if item.evidence.details else {}),
                    },
                }
                for item in self.capabilities
            ],
            "provenance": {
                "source": self.provenance.source.value,
                "status": self.provenance.status.value,
                **({"confidence": self.provenance.confidence.value} if self.provenance.confidence else {}),
                **({"verified_at": self.provenance.verified_at} if self.provenance.verified_at else {}),
                **({"details": self.provenance.details} if self.provenance.details else {}),
            },
            "modalities": {
                direction: [item.value for item in self.modalities[direction]]
                for direction in ("inputs", "outputs")
            },
            "runtime_compatibility": [item.to_dict() for item in self.runtime_compatibility],
            "dependencies": [_thaw_json(item) for item in self.dependencies],
            "resource_hints": _thaw_json(self.resource_hints),
            "defaults": _thaw_json(self.defaults),
            "ui": _thaw_json(self.ui),
        }
        for field in ("description", "family", "variant"):
            field_value = getattr(self, field)
            if field_value is not None:
                result[field] = field_value
        if self.model_key is not None:
            result["model_key"] = self.model_key
        result.update(_thaw_json(self.extensions))
        return result


__all__ = ["CURRENT_SCHEMA_VERSION", "ModelArtifact", "ModelManifest", "RuntimeCompatibility"]
