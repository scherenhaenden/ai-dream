"""Typed capability and artifact vocabulary for orchestration contracts.

These immutable value objects validate normalized identifiers and evidence
fields. They do not validate component schemas or prove a route is runnable.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import re
from typing import Any, Mapping


class StringEnum(str, Enum):
    """String-valued enum compatible with the project's Python 3.10 floor."""


class CapabilityId(StringEnum):
    TEXT_GENERATE = "text.generate"
    TEXT_CHAT = "text.chat"
    TEXT_REASON = "text.reason"
    TEXT_SUMMARIZE = "text.summarize"
    TEXT_TRANSLATE = "text.translate"
    TEXT_CLASSIFY = "text.classify"
    TEXT_EXTRACT = "text.extract"
    CODE_GENERATE = "code.generate"
    CODE_REVIEW = "code.review"
    CODE_EXPLAIN = "code.explain"
    CODE_TOOL_CALL = "code.tool-call"
    MATH_SOLVE = "math.solve"
    VISION_UNDERSTAND = "vision.understand"
    VISION_SCREEN = "vision.screen"
    VISION_VIDEO_UNDERSTAND = "vision.video-understand"
    OCR_EXTRACT = "ocr.extract"
    DOCUMENT_PARSE = "document.parse"
    DOCUMENT_LAYOUT = "document.layout"
    DOCUMENT_RENDER = "document.render"
    EMBEDDING_CREATE = "embedding.create"
    RERANK_SCORE = "rerank.score"
    RETRIEVAL_SEARCH = "retrieval.search"
    MEMORY_STORE = "memory.store"
    MEMORY_RETRIEVE = "memory.retrieve"
    AUDIO_TRANSCRIBE = "audio.transcribe"
    AUDIO_SYNTHESIZE = "audio.synthesize"
    AUDIO_UNDERSTAND = "audio.understand"
    AUDIO_DIARIZE = "audio.diarize"
    AUDIO_PROSODY = "audio.prosody"
    MUSIC_UNDERSTAND = "music.understand"
    MUSIC_GENERATE = "music.generate"
    IMAGE_GENERATE = "image.generate"
    IMAGE_EDIT = "image.edit"
    IMAGE_INPAINT = "image.inpaint"
    VIDEO_GENERATE = "video.generate"
    VIDEO_EDIT = "video.edit"
    MESH_GENERATE = "mesh.generate"
    COMPUTER_CONTROL = "computer.control"
    BROWSER_CONTROL = "browser.control"
    PHONE_CONTROL = "phone.control"
    TOOL_CALL = "tool.call"
    STRUCTURED_GENERATE = "structured.generate"


class ArtifactKind(StringEnum):
    TEXT = "text"
    CHAT_MESSAGES = "chat_messages"
    JSON = "json"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    DOCUMENT = "document"
    EMBEDDING_BATCH = "embedding_batch"
    RERANK_CANDIDATES = "rerank_candidates"
    FILE_REFERENCE = "file_reference"
    SCREEN_FRAME = "screen_frame"
    TOOL_RESULT = "tool_result"
    MODEL_REFERENCE = "model_reference"


class EvidenceSource(StringEnum):
    VERIFIED_RUN = "verified_run"
    RUNTIME_PROBE = "runtime_probe"
    MODEL_METADATA = "model_metadata"
    BUNDLED_MANIFEST = "bundled_manifest"
    HUB_METADATA = "hub_metadata"
    USER_OVERRIDE = "user_override"
    FILENAME_HINT = "filename_hint"
    UNKNOWN = "unknown"


class EvidenceStatus(StringEnum):
    VERIFIED = "verified"
    SUPPORTED = "supported"
    PROBABLE = "probable"
    UNKNOWN = "unknown"
    FAILED = "failed"


class EvidenceConfidence(StringEnum):
    """Strength assigned to the provenance supporting a capability claim."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class Modality(StringEnum):
    """Coarse modality labels useful to component declarations."""

    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    DOCUMENT = "document"
    STRUCTURED = "structured"
    EMBEDDING = "embedding"
    TOOL = "tool"
    MODEL = "model"
    SCREEN = "screen"


_CAPABILITY_ID_RE = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+\Z")


def validate_capability_id(value: str | CapabilityId) -> str:
    """Return a normalized capability identifier or raise ``ValueError``."""
    if isinstance(value, CapabilityId):
        return value.value
    if not isinstance(value, str) or not _CAPABILITY_ID_RE.fullmatch(value):
        raise ValueError("capability id must be lowercase namespaced text")
    return value


def _enum_value(enum_type: type[StringEnum], value: Any, field: str) -> str:
    if isinstance(value, enum_type):
        return value.value
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    try:
        return enum_type(value).value
    except ValueError as exc:
        raise ValueError(f"unsupported {field}: {value}") from exc


@dataclass(frozen=True, slots=True)
class Evidence:
    """Provenance and confidence status for a capability claim."""

    source: EvidenceSource
    status: EvidenceStatus
    confidence: EvidenceConfidence | None = None
    verified_at: str | None = None
    details: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", EvidenceSource(_enum_value(EvidenceSource, self.source, "evidence source")))
        object.__setattr__(self, "status", EvidenceStatus(_enum_value(EvidenceStatus, self.status, "evidence status")))
        if self.confidence is not None:
            object.__setattr__(self, "confidence", EvidenceConfidence(
                _enum_value(EvidenceConfidence, self.confidence, "evidence confidence")))
        if self.verified_at is not None and (not isinstance(self.verified_at, str) or not self.verified_at.strip()):
            raise ValueError("verified_at must be non-empty text or None")
        if self.details is not None and not isinstance(self.details, str):
            raise ValueError("evidence details must be text or None")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> Evidence:
        if not isinstance(value, Mapping):
            raise ValueError("evidence must be an object")
        extra = set(value) - {"source", "status", "confidence", "verified_at", "details"}
        if extra:
            raise ValueError("unsupported evidence field(s): " + ", ".join(sorted(map(str, extra))))
        if "source" not in value or "status" not in value:
            raise ValueError("evidence requires source and status")
        return cls(**dict(value))


@dataclass(frozen=True, slots=True)
class ArtifactType:
    """Artifact kind plus optional media-type restrictions."""

    kind: ArtifactKind
    media_types: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "kind", ArtifactKind(_enum_value(ArtifactKind, self.kind, "artifact kind")))
        if not isinstance(self.media_types, (tuple, list)) or any(
            not isinstance(item, str) or not item.strip() or "/" not in item
            for item in self.media_types
        ):
            raise ValueError("media_types must contain non-empty media type strings")
        object.__setattr__(self, "media_types", tuple(self.media_types))


@dataclass(frozen=True, slots=True)
class CapabilityDeclaration:
    """A capability with typed IO, optional features, and provenance."""

    id: CapabilityId | str
    inputs: tuple[ArtifactType, ...]
    outputs: tuple[ArtifactType, ...]
    evidence: Evidence
    features: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", validate_capability_id(self.id))
        for field in ("inputs", "outputs"):
            values = getattr(self, field)
            if not isinstance(values, (tuple, list)) or any(not isinstance(item, ArtifactType) for item in values):
                raise ValueError(f"{field} must contain ArtifactType values")
            object.__setattr__(self, field, tuple(values))
        if not isinstance(self.evidence, Evidence):
            raise ValueError("evidence must be an Evidence value")
        if not isinstance(self.features, (set, frozenset, tuple, list)) or any(
            not isinstance(item, str) or not item.strip() for item in self.features
        ):
            raise ValueError("features must contain non-empty strings")
        object.__setattr__(self, "features", frozenset(self.features))

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> CapabilityDeclaration:
        if not isinstance(value, Mapping):
            raise ValueError("capability declaration must be an object")
        extra = set(value) - {"id", "inputs", "outputs", "evidence", "features"}
        if extra:
            raise ValueError("unsupported capability field(s): " + ", ".join(sorted(map(str, extra))))
        if not {"id", "inputs", "outputs", "evidence"}.issubset(value):
            raise ValueError("capability declaration requires id, inputs, outputs, and evidence")

        def parse_artifacts(items: Any, field: str) -> tuple[ArtifactType, ...]:
            if not isinstance(items, (tuple, list)):
                raise ValueError(f"{field} must be a list")
            parsed = []
            for item in items:
                if not isinstance(item, Mapping) or set(item) - {"kind", "media_types"} or "kind" not in item:
                    raise ValueError(f"each {field} item requires kind and optional media_types")
                parsed.append(ArtifactType(item["kind"], tuple(item.get("media_types", ()))))
            return tuple(parsed)

        evidence = value["evidence"]
        return cls(
            id=value["id"],
            inputs=parse_artifacts(value["inputs"], "inputs"),
            outputs=parse_artifacts(value["outputs"], "outputs"),
            evidence=evidence if isinstance(evidence, Evidence) else Evidence.from_mapping(evidence),
            features=frozenset(value.get("features", ())),
        )
