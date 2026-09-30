"""Deterministic, evidence-aware capability route selection (resolver v1)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

from .contracts import ArtifactType, EvidenceStatus, validate_capability_id
from .registry import artifact_types_compatible


@dataclass(frozen=True, slots=True)
class RouteCandidate:
    """A normalized route snapshot; no runtime invocation is performed here."""

    id: str
    capability_id: str
    model_id: str
    runtime_id: str
    inputs: tuple[ArtifactType, ...]
    outputs: tuple[ArtifactType, ...]
    profile_id: str | None = None
    features: frozenset[str] = frozenset()
    evidence_status: str = EvidenceStatus.UNKNOWN.value
    loaded: bool = False
    priority: int = 0
    required_memory_bytes: int | None = None
    available_memory_bytes: int | None = None
    dependencies_available: bool = True
    available: bool = True
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("id", "model_id", "runtime_id"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value or len(value) > 512:
                raise ValueError(f"route {name} must be bounded non-empty text")
        object.__setattr__(self, "capability_id", validate_capability_id(self.capability_id))
        if any(not isinstance(item, ArtifactType) for item in (*self.inputs, *self.outputs)):
            raise TypeError("route input/output declarations must be ArtifactType values")
        if not isinstance(self.features, (set, frozenset)) or any(not isinstance(item, str) for item in self.features):
            raise ValueError("route features must be strings")
        if self.evidence_status not in {item.value for item in EvidenceStatus}:
            raise ValueError("unsupported route evidence status")
        for name in ("loaded", "dependencies_available", "available"):
            if not isinstance(getattr(self, name), bool):
                raise ValueError(f"route {name} must be boolean")
        for name in ("required_memory_bytes", "available_memory_bytes"):
            value = getattr(self, name)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                raise ValueError(f"route {name} must be a non-negative integer or None")
        if isinstance(self.priority, bool) or not isinstance(self.priority, int):
            raise ValueError("route priority must be an integer")
        if self.profile_id is not None and (not isinstance(self.profile_id, str) or not self.profile_id or len(self.profile_id) > 512):
            raise ValueError("route profile_id must be bounded non-empty text or None")


@dataclass(frozen=True, slots=True)
class ResolutionRequest:
    capability_id: str
    input: ArtifactType
    output: ArtifactType | None = None
    required_features: frozenset[str] = frozenset()
    mode: str = "auto"
    pinned_model_id: str | None = None
    pinned_profile_id: str | None = None
    preferred_model_id: str | None = None
    preferred_profile_id: str | None = None
    prefer_verified: bool = True
    prefer_loaded: bool = True
    resource_headroom_percent: int = 10
    unknown_resource_policy: str = "allow"

    def __post_init__(self) -> None:
        object.__setattr__(self, "capability_id", validate_capability_id(self.capability_id))
        if not isinstance(self.input, ArtifactType) or (self.output is not None and not isinstance(self.output, ArtifactType)):
            raise TypeError("resolution input/output must be ArtifactType values")
        if self.mode not in {"auto", "guided", "manual"}:
            raise ValueError("mode must be auto, guided, or manual")
        if self.mode == "manual" and not self.pinned_model_id:
            raise ValueError("manual mode requires a pinned model_id")
        for name in ("pinned_model_id", "pinned_profile_id", "preferred_model_id", "preferred_profile_id"):
            value = getattr(self, name)
            if value is not None and (not isinstance(value, str) or not value or len(value) > 512):
                raise ValueError(f"{name} must be bounded non-empty text or None")
        if not isinstance(self.required_features, (set, frozenset)) or any(
            not isinstance(item, str) or not item or len(item) > 256 for item in self.required_features
        ):
            raise ValueError("required_features must be a set of bounded non-empty strings")
        if not isinstance(self.prefer_verified, bool) or not isinstance(self.prefer_loaded, bool):
            raise ValueError("selection preferences must be boolean")
        if isinstance(self.resource_headroom_percent, bool) or not isinstance(self.resource_headroom_percent, int) or not 0 <= self.resource_headroom_percent <= 100:
            raise ValueError("resource_headroom_percent must be an integer from 0 to 100")
        if not isinstance(self.unknown_resource_policy, str) or self.unknown_resource_policy not in {"allow", "reject"}:
            raise ValueError("unknown_resource_policy must be 'allow' or 'reject'")


@dataclass(frozen=True, slots=True)
class Resolution:
    selected: RouteCandidate | None
    alternatives: tuple[RouteCandidate, ...]
    why: tuple[Mapping[str, Any], ...]

    def to_dict(self) -> dict[str, Any]:
        def route(candidate: RouteCandidate) -> dict[str, Any]:
            return {"id": candidate.id, "capability_id": candidate.capability_id,
                    "model_id": candidate.model_id, "profile_id": candidate.profile_id,
                    "runtime_id": candidate.runtime_id}
        return {"route": route(self.selected) if self.selected else None,
                "alternatives": [route(item) for item in self.alternatives],
                "why": [dict(item) for item in self.why]}


def resolve_route(request: ResolutionRequest, candidates: Iterable[RouteCandidate]) -> Resolution:
    """Filter hard incompatibilities then rank remaining routes deterministically.

    A manual pin is a hard constraint. Candidate order never influences the result.
    """
    rows = tuple(candidates)
    if any(not isinstance(item, RouteCandidate) for item in rows):
        raise TypeError("candidates must contain RouteCandidate values")
    route_ids = [item.id for item in rows]
    if len(route_ids) != len(set(route_ids)):
        raise ValueError("candidate route IDs must be unique")
    why: list[dict[str, Any]] = []
    eligible: list[RouteCandidate] = []
    for route in sorted(rows, key=lambda item: (item.id, item.model_id, item.runtime_id)):
        reasons: list[str] = []
        if route.capability_id != request.capability_id: reasons.append("capability_mismatch")
        if not any(artifact_types_compatible(request.input, item) for item in route.inputs): reasons.append("input_type_mismatch")
        if request.output and not any(artifact_types_compatible(request.output, item) for item in route.outputs): reasons.append("output_type_mismatch")
        missing_features = sorted(request.required_features - route.features)
        if missing_features: reasons.append("missing_features:" + ",".join(missing_features))
        if route.evidence_status == EvidenceStatus.FAILED.value: reasons.append("capability_evidence_failed")
        if not route.available: reasons.append("route_unavailable")
        if not route.dependencies_available: reasons.append("missing_dependencies")
        if (route.required_memory_bytes is None or route.available_memory_bytes is None) and request.unknown_resource_policy == "reject":
            reasons.append("resource_estimate_unknown")
        if route.required_memory_bytes is not None and route.available_memory_bytes is not None:
            # Round required headroom up: flooring can approve a route that is
            # fractionally below the configured safety margin.
            numerator = route.required_memory_bytes * (100 + request.resource_headroom_percent)
            needed = (numerator + 99) // 100
            if needed > route.available_memory_bytes: reasons.append("insufficient_resources")
        if request.mode == "manual" and route.model_id != request.pinned_model_id: reasons.append("not_pinned_model")
        if request.pinned_profile_id is not None and route.profile_id != request.pinned_profile_id:
            reasons.append("not_pinned_profile")
        if reasons:
            why.append({"route_id": route.id, "eligible": False, "reasons": reasons})
        else:
            eligible.append(route)
            why.append({"route_id": route.id, "eligible": True, "reasons": ["compatible"]})

    def rank(route: RouteCandidate) -> tuple[Any, ...]:
        return (
            0 if request.prefer_verified and route.evidence_status == EvidenceStatus.VERIFIED.value else 1,
            0 if request.preferred_model_id and route.model_id == request.preferred_model_id else 1,
            0 if request.preferred_profile_id and route.profile_id == request.preferred_profile_id else 1,
            0 if request.prefer_loaded and route.loaded else 1,
            route.priority,
            route.id,
            route.model_id,
            route.runtime_id,
        )

    ordered = tuple(sorted(eligible, key=rank))
    selected = ordered[0] if ordered else None
    for record in why:
        if record["eligible"]:
            record["selected"] = selected is not None and record["route_id"] == selected.id
            candidate = next(item for item in eligible if item.id == record["route_id"])
            record["selection_factors"] = {
                "evidence_status": candidate.evidence_status,
                "verified_preference_met": request.prefer_verified and candidate.evidence_status == EvidenceStatus.VERIFIED.value,
                "model_preference": {"requested": request.preferred_model_id, "candidate": candidate.model_id,
                                      "matched": bool(request.preferred_model_id and candidate.model_id == request.preferred_model_id)},
                "profile_preference": {"requested": request.preferred_profile_id, "candidate": candidate.profile_id,
                                       "matched": bool(request.preferred_profile_id and candidate.profile_id == request.preferred_profile_id)},
                "loaded": candidate.loaded,
                "loaded_preference_enabled": request.prefer_loaded,
                "static_priority": candidate.priority,
                "resource_estimate": {
                    "required_bytes": candidate.required_memory_bytes,
                    "available_bytes": candidate.available_memory_bytes,
                    "unknown_policy": request.unknown_resource_policy,
                },
            }
            record["ranking"] = [
                "verified" if request.prefer_verified else "verification_preference_disabled",
                "semantic_preference", "already_loaded" if request.prefer_loaded else "loaded_preference_disabled",
                "static_priority", "stable_route_id",
            ]
    return Resolution(selected, ordered[1:], tuple(why))


__all__ = ["Resolution", "ResolutionRequest", "RouteCandidate", "resolve_route"]
