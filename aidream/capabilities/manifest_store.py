"""In-memory layered model manifest store with field-level provenance."""
from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Iterable, Mapping

from .contracts import Evidence, EvidenceSource, EvidenceStatus
from .manifests import ModelManifest


_LAYER_ORDER = ("observed", "curated", "generated", "user_override")


def _plain(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_plain(item) for item in value]
    return value


def _merge(base: dict[str, Any], overlay: Mapping[str, Any], *, path: str,
           layer: str, evidence: Evidence, provenance: dict[str, FieldProvenance]) -> dict[str, Any]:
    for key in sorted(overlay):
        value = _plain(overlay[key])
        child_path = f"{path}.{key}" if path else key
        old = base.get(key)
        # Provenance is one evidence record. A higher-layer empty record means
        # explicitly unknown; it must not inherit an older source/status pair.
        if key == "provenance":
            base[key] = value
            provenance[child_path] = FieldProvenance(layer, evidence)
        elif isinstance(old, dict) and isinstance(value, Mapping):
            _merge(old, value, path=child_path, layer=layer, evidence=evidence, provenance=provenance)
        elif isinstance(value, Mapping) and value:
            child: dict[str, Any] = {}
            base[key] = child
            _merge(child, value, path=child_path, layer=layer, evidence=evidence, provenance=provenance)
        else:
            base[key] = value
            provenance[child_path] = FieldProvenance(layer, evidence)
    return base


def _overlay_evidence(value: Mapping[str, Any]) -> Evidence:
    raw = value.get("provenance")
    if isinstance(raw, Evidence):
        return raw
    if isinstance(raw, Mapping):
        if not raw:
            return Evidence(EvidenceSource.UNKNOWN, EvidenceStatus.UNKNOWN)
        return Evidence.from_mapping(raw)
    return Evidence(EvidenceSource.UNKNOWN, EvidenceStatus.UNKNOWN)


def _as_mapping(value: ModelManifest | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(value, ModelManifest):
        return value.to_dict()
    if not isinstance(value, Mapping):
        raise TypeError("manifest layer entries must be ModelManifest values or mappings")
    return _plain(value)


@dataclass(frozen=True, slots=True)
class FieldProvenance:
    """Layer and claim evidence responsible for a manifest field value."""

    layer: str
    evidence: Evidence

    def to_dict(self) -> dict[str, Any]:
        return {
            "layer": self.layer,
            "source": self.evidence.source.value,
            "status": self.evidence.status.value,
            "confidence": self.evidence.confidence.value if self.evidence.confidence else None,
            "verified_at": self.evidence.verified_at,
        }


class ModelManifestStore:
    """Immutable merged view over observed and curated manifest layers.

    Layer precedence is observed < curated < generated < user override. Mapping
    overlays may be partial; list values replace atomically and object values
    merge recursively. The store is rebuilt when source state changes.
    """

    __slots__ = ("_manifests", "_provenance")

    def __init__(
        self,
        *,
        observed: Iterable[ModelManifest | Mapping[str, Any]] = (),
        curated: Iterable[ModelManifest | Mapping[str, Any]] = (),
        generated: Iterable[ModelManifest | Mapping[str, Any]] = (),
        user_overrides: Iterable[ModelManifest | Mapping[str, Any]] = (),
    ) -> None:
        layers = {
            "observed": observed,
            "curated": curated,
            "generated": generated,
            "user_override": user_overrides,
        }
        merged: dict[str, dict[str, Any]] = {}
        field_sources: dict[str, dict[str, FieldProvenance]] = {}
        model_keys: dict[str, str] = {}

        for layer in _LAYER_ORDER:
            seen: set[str] = set()
            for item in layers[layer]:
                incoming = _as_mapping(item)
                manifest_id = incoming.get("id")
                if not isinstance(manifest_id, str) or not manifest_id:
                    raise ValueError(f"{layer} manifest entries require a non-empty id")
                if manifest_id in seen:
                    raise ValueError(f"duplicate manifest id in {layer} layer: {manifest_id}")
                seen.add(manifest_id)

                model_key = incoming.get("model_key")
                if model_key is not None:
                    previous = model_keys.get(manifest_id)
                    if previous is not None and previous != model_key:
                        raise ValueError(f"model_key conflicts across layers for manifest {manifest_id}")
                    model_keys[manifest_id] = model_key

                evidence = _overlay_evidence(incoming)
                target = merged.setdefault(manifest_id, {})
                sources = field_sources.setdefault(manifest_id, {})
                _merge(target, incoming, path="", layer=layer, evidence=evidence, provenance=sources)

        manifests: dict[str, ModelManifest] = {}
        for manifest_id, value in merged.items():
            parsed = ModelManifest.from_mapping(value)
            if parsed.id != manifest_id:
                raise ValueError("manifest ID changed during layer merge")
            manifests[manifest_id] = parsed

        self._manifests = MappingProxyType(dict(sorted(manifests.items())))
        self._provenance = MappingProxyType({
            manifest_id: MappingProxyType(dict(sorted(sources.items())))
            for manifest_id, sources in sorted(field_sources.items())
        })

    @classmethod
    def from_layers(
        cls,
        *,
        observed: Iterable[ModelManifest | Mapping[str, Any]] = (),
        curated: Iterable[ModelManifest | Mapping[str, Any]] = (),
        generated: Iterable[ModelManifest | Mapping[str, Any]] = (),
        user_overrides: Iterable[ModelManifest | Mapping[str, Any]] = (),
    ) -> ModelManifestStore:
        return cls(observed=observed, curated=curated, generated=generated, user_overrides=user_overrides)

    def list_manifests(self) -> tuple[ModelManifest, ...]:
        """Return manifests sorted by stable manifest ID."""
        return tuple(self._manifests.values())

    def get(self, manifest_id: str) -> ModelManifest | None:
        """Return a manifest by ID, or ``None`` when it is not registered."""
        return self._manifests.get(manifest_id)

    def provenance_for(
        self,
        manifest_id: str,
        field_path: str | None = None,
    ) -> Mapping[str, FieldProvenance]:
        """Return immutable field-to-layer provenance for one manifest.

        When ``field_path`` is given, return that exact field and all nested
        fields below it. Paths use dotted object keys; lists are atomic fields.
        """
        fields = self._provenance.get(manifest_id, MappingProxyType({}))
        if field_path is None:
            return fields
        if not isinstance(field_path, str) or not field_path:
            raise ValueError("field_path must be non-empty text or None")
        prefix = field_path + "."
        return MappingProxyType({
            path: source for path, source in fields.items()
            if path == field_path or path.startswith(prefix)
        })


__all__ = ["FieldProvenance", "ModelManifestStore"]
