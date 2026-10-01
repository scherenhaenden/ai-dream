"""Immutable, model-independent registry for capability declarations."""
from __future__ import annotations

from collections.abc import Iterable
from typing import Literal

from .contracts import ArtifactType, CapabilityDeclaration, validate_capability_id


Direction = Literal["input", "output"]


def _artifact_key(value: ArtifactType) -> tuple[str, tuple[str, ...]]:
    return value.kind.value, tuple(sorted(value.media_types))


def _declaration_key(value: CapabilityDeclaration) -> tuple[object, ...]:
    evidence = value.evidence
    return (
        str(value.id),
        tuple(sorted(_artifact_key(item) for item in value.inputs)),
        tuple(sorted(_artifact_key(item) for item in value.outputs)),
        tuple(sorted(value.features)),
        evidence.source.value,
        evidence.status.value,
        evidence.confidence.value if evidence.confidence is not None else "",
        evidence.verified_at or "",
        evidence.details or "",
    )


def artifact_types_compatible(left: ArtifactType, right: ArtifactType) -> bool:
    """Return whether two artifact constraints can describe the same artifact.

    Kinds must match. An empty media-type list is unconstrained; otherwise the
    media type sets must overlap. Wildcards such as ``image/*`` are supported.
    """
    if not isinstance(left, ArtifactType) or not isinstance(right, ArtifactType):
        raise TypeError("artifact compatibility requires ArtifactType values")
    if left.kind != right.kind:
        return False
    if not left.media_types or not right.media_types:
        return True
    return any(_media_types_overlap(a, b) for a in left.media_types for b in right.media_types)


def _media_types_overlap(left: str, right: str) -> bool:
    left_type, _, left_subtype = left.partition("/")
    right_type, _, right_subtype = right.partition("/")
    return (left_type == "*" or right_type == "*" or left_type == right_type) and (
        left_subtype == "*" or right_subtype == "*" or left_subtype == right_subtype
    )


class CapabilityRegistry:
    """Read-only, deterministic snapshot of declared capabilities.

    The registry deliberately has no model/runtime dependencies and exposes no
    mutation methods. Rebuild it when the inventory snapshot changes.
    """

    __slots__ = ("_declarations", "_by_id")

    def __init__(self, declarations: Iterable[CapabilityDeclaration] = ()) -> None:
        items = tuple(declarations)
        if any(not isinstance(item, CapabilityDeclaration) for item in items):
            raise TypeError("registry entries must be CapabilityDeclaration values")
        ordered = tuple(sorted(items, key=_declaration_key))
        by_id: dict[str, list[CapabilityDeclaration]] = {}
        for declaration in ordered:
            by_id.setdefault(str(declaration.id), []).append(declaration)
        self._declarations = ordered
        self._by_id = {key: tuple(values) for key, values in by_id.items()}

    def snapshot(self) -> tuple[CapabilityDeclaration, ...]:
        """Return all declarations in stable order as an immutable tuple."""
        return self._declarations

    def capability_map(self) -> list[dict[str, object]]:
        """Return a compact, deterministic, JSON-ready summary by capability."""
        grouped: dict[str, list[CapabilityDeclaration]] = {}
        for declaration in self._declarations:
            grouped.setdefault(str(declaration.id), []).append(declaration)

        def artifact_rows(declarations: list[CapabilityDeclaration], field: str) -> list[dict[str, object]]:
            values = {
                (artifact.kind.value, tuple(sorted(artifact.media_types)))
                for declaration in declarations
                for artifact in getattr(declaration, field)
            }
            rows = []
            for kind, media_types in sorted(values):
                row: dict[str, object] = {"kind": kind}
                if media_types:
                    row["media_types"] = list(media_types)
                rows.append(row)
            return rows

        result: list[dict[str, object]] = []
        for capability_id in sorted(grouped):
            declarations = grouped[capability_id]
            evidence_values = {
                (
                    declaration.evidence.source.value,
                    declaration.evidence.status.value,
                    declaration.evidence.confidence.value if declaration.evidence.confidence else None,
                    declaration.evidence.verified_at,
                )
                for declaration in declarations
            }
            evidence = [
                {"source": source, "status": status, "confidence": confidence, "verified_at": verified_at}
                for source, status, confidence, verified_at in sorted(
                    evidence_values,
                    key=lambda item: tuple("" if value is None else value for value in item),
                )
            ]
            result.append({
                "id": capability_id,
                "inputs": artifact_rows(declarations, "inputs"),
                "outputs": artifact_rows(declarations, "outputs"),
                "features": sorted({feature for item in declarations for feature in item.features}),
                "evidence": evidence,
            })
        return result

    def find_by_id(self, capability_id: str) -> tuple[CapabilityDeclaration, ...]:
        """Return every declaration for a normalized capability ID."""
        return self._by_id.get(validate_capability_id(capability_id), ())

    def find_compatible(
        self,
        artifact: ArtifactType,
        *,
        direction: Direction = "input",
        capability_id: str | None = None,
    ) -> tuple[CapabilityDeclaration, ...]:
        """Find declarations accepting or producing a compatible artifact.

        ``direction="input"`` searches accepted inputs; ``"output"`` searches
        produced outputs. A capability ID may optionally narrow the search.
        Results retain the registry's deterministic order.
        """
        if not isinstance(artifact, ArtifactType):
            raise TypeError("artifact must be an ArtifactType")
        if direction not in ("input", "output"):
            raise ValueError("direction must be 'input' or 'output'")
        candidates = self.snapshot() if capability_id is None else self.find_by_id(capability_id)
        field = "inputs" if direction == "input" else "outputs"
        return tuple(
            declaration for declaration in candidates
            if any(artifact_types_compatible(artifact, accepted) for accepted in getattr(declaration, field))
        )


__all__ = ["CapabilityRegistry", "Direction", "artifact_types_compatible"]
