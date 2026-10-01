"""Atomic storage for runtime-probed model manifest verification records.

Only a typed result returned by an injected verifier is accepted. This module
never probes, loads, or invokes a model; callers own that bounded operation.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from typing import Any, Callable, Mapping, Protocol

from .contracts import CapabilityDeclaration, EvidenceConfidence, EvidenceSource, EvidenceStatus
from .manifests import ModelManifest

_VERSION = 1
_MAX_BYTES = 1024 * 1024
_MAX_RECORDS = 4096
_MANIFEST_ID = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+\Z")


def default_manifest_verification_path() -> Path:
    root = os.environ.get("XDG_DATA_HOME")
    base = Path(root).expanduser() if root and Path(root).expanduser().is_absolute() else Path.home() / ".local" / "share"
    return base / "ai-dream" / "model-manifest-verifications.json"


def _copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _timestamp(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("verification completed_at must be non-empty ISO timestamp text")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("verification completed_at must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError("verification completed_at must include a timezone")
    return parsed.isoformat()


@dataclass(frozen=True, slots=True)
class ManifestVerificationResult:
    """Verifier output after a bounded probe; this is not built from API input."""

    manifest_id: str
    runtime_id: str
    success: bool
    completed_at: str
    details: str
    capabilities: tuple[CapabilityDeclaration, ...] = ()
    profile: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.manifest_id, str) or len(self.manifest_id) > 256 or not _MANIFEST_ID.fullmatch(self.manifest_id):
            raise ValueError("verification manifest_id is invalid")
        if (not isinstance(self.runtime_id, str) or not self.runtime_id.strip() or len(self.runtime_id) > 128
                or "\x00" in self.runtime_id):
            raise ValueError("verification runtime_id is invalid")
        if type(self.success) is not bool:
            raise ValueError("verification success must be a boolean")
        object.__setattr__(self, "completed_at", _timestamp(self.completed_at))
        if not isinstance(self.details, str) or len(self.details) > 4000:
            raise ValueError("verification details must be text of at most 4000 characters")
        if not isinstance(self.capabilities, (tuple, list)) or len(self.capabilities) > 128:
            raise ValueError("verification capabilities must be a bounded list")
        if any(not isinstance(item, CapabilityDeclaration) for item in self.capabilities):
            raise ValueError("verification capabilities must be typed declarations")
        ids = [item.id for item in self.capabilities]
        if len(ids) != len(set(ids)):
            raise ValueError("verification capability IDs must be unique")
        if self.success:
            if not self.capabilities:
                raise ValueError("successful verification requires at least one probed capability")
            for item in self.capabilities:
                evidence = item.evidence
                if (evidence.source != EvidenceSource.VERIFIED_RUN or evidence.status != EvidenceStatus.VERIFIED
                        or evidence.verified_at != self.completed_at):
                    raise ValueError("verified capabilities require matching verified_run evidence")
            if not isinstance(self.profile, Mapping):
                raise ValueError("successful verification requires the verified profile settings")
            profile = _copy_json(dict(self.profile))
            verification = profile.get("verification")
            if (profile.get("runtime_id") != self.runtime_id or profile.get("profile_class") != "verified"
                    or not isinstance(profile.get("purpose"), list)
                    or not {item.id for item in self.capabilities} <= set(profile["purpose"])
                    or not isinstance(verification, Mapping)
                    or verification.get("status") != "verified"
                    or verification.get("verified_at") != self.completed_at):
                raise ValueError("verified profile must match the runtime, capabilities, and probe record")
            object.__setattr__(self, "profile", profile)
        elif self.capabilities or self.profile is not None:
            raise ValueError("failed verification cannot promote capabilities or a profile")

    def to_dict(self) -> dict[str, Any]:
        return {
            "manifest_id": self.manifest_id,
            "runtime_id": self.runtime_id,
            "success": self.success,
            "completed_at": self.completed_at,
            "details": self.details,
            "capabilities": [_capability_to_dict(item) for item in self.capabilities],
            "profile": _copy_json(self.profile) if self.profile is not None else None,
        }


def _artifact_to_dict(value: Any) -> dict[str, Any]:
    result = {"kind": value.kind.value}
    if value.media_types:
        result["media_types"] = list(value.media_types)
    return result


def _capability_to_dict(item: CapabilityDeclaration) -> dict[str, Any]:
    return {
        "id": item.id,
        "inputs": [_artifact_to_dict(value) for value in item.inputs],
        "outputs": [_artifact_to_dict(value) for value in item.outputs],
        "features": sorted(item.features),
        "evidence": {
            "source": item.evidence.source.value,
            "status": item.evidence.status.value,
            "confidence": item.evidence.confidence.value if item.evidence.confidence else None,
            "verified_at": item.evidence.verified_at,
            "details": item.evidence.details,
        },
    }


class ManifestVerificationStore:
    """Persist latest verifier outcomes; only successful records form overlays."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        self.path = Path(path).expanduser() if path is not None else default_manifest_verification_path()
        self._lock = threading.RLock()

    def record(self, result: ManifestVerificationResult) -> dict[str, Any]:
        if not isinstance(result, ManifestVerificationResult):
            raise TypeError("record requires ManifestVerificationResult from a verifier")
        with self._lock:
            data = self._read()
            data["records"][result.manifest_id] = result.to_dict()
            self._write(data)
            return _copy_json(data["records"][result.manifest_id])

    def get(self, manifest_id: str) -> dict[str, Any] | None:
        with self._lock:
            value = self._read()["records"].get(manifest_id)
            return None if value is None else _copy_json(value)

    def list_records(self) -> tuple[dict[str, Any], ...]:
        with self._lock:
            records = self._read()["records"]
            return tuple(_copy_json(records[key]) for key in sorted(records))

    def generated_overlays(self) -> tuple[dict[str, Any], ...]:
        """Return claims from successful bounded probes for the generated layer."""
        with self._lock:
            records = self._read()["records"]
            overlays = []
            for manifest_id in sorted(records):
                item = records[manifest_id]
                if not item["success"]:
                    continue
                overlays.append({
                    "id": manifest_id,
                    "provenance": {
                        "source": EvidenceSource.VERIFIED_RUN.value,
                        "status": EvidenceStatus.VERIFIED.value,
                        "confidence": EvidenceConfidence.HIGH.value,
                        "verified_at": item["completed_at"],
                        "details": f"Bounded runtime probe succeeded for {item['runtime_id']}: {item['details']}",
                    },
                    "capabilities": item["capabilities"],
                })
            return tuple(overlays)

    def _read(self) -> dict[str, Any]:
        try:
            stat = self.path.stat()
            if stat.st_size > _MAX_BYTES:
                raise ValueError("manifest verification store exceeds the size limit")
            value = json.loads(self.path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
        except FileNotFoundError:
            return {"version": _VERSION, "records": {}}
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"Could not read manifest verification store: {exc}") from exc
        if (not isinstance(value, dict) or set(value) != {"version", "records"}
                or type(value["version"]) is not int or value["version"] != _VERSION
                or not isinstance(value["records"], dict) or len(value["records"]) > _MAX_RECORDS):
            raise ValueError("manifest verification store has an unsupported shape or version")
        clean = {}
        for key, raw in value["records"].items():
            result = _result_from_dict(raw)
            if result.manifest_id != key:
                raise ValueError("manifest verification record key does not match its manifest ID")
            clean[key] = result.to_dict()
        return {"version": _VERSION, "records": clean}

    def _write(self, value: Mapping[str, Any]) -> None:
        encoded = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
        if len(encoded) > _MAX_BYTES:
            raise ValueError("manifest verification store exceeds the size limit")
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


def _result_from_dict(value: Any) -> ManifestVerificationResult:
    if not isinstance(value, Mapping) or set(value) != {
        "manifest_id", "runtime_id", "success", "completed_at", "details", "capabilities", "profile"
    }:
        raise ValueError("manifest verification record has an invalid shape")
    capabilities = value["capabilities"]
    if not isinstance(capabilities, list):
        raise ValueError("verification capabilities must be a list")
    declarations = tuple(CapabilityDeclaration.from_mapping(item) for item in capabilities)
    return ManifestVerificationResult(
        manifest_id=value["manifest_id"], runtime_id=value["runtime_id"], success=value["success"],
        completed_at=value["completed_at"], details=value["details"], capabilities=declarations,
        profile=value["profile"],
    )


def _reject_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


class ManifestVerifier(Protocol):
    """Bounded local probe for one runtime selected in AI Dream.

    ``runtime_id`` must match an enabled, available local installation or a
    registered local inference backend before ``verify`` is called.
    """

    runtime_id: str
    def verify(self, manifest: ModelManifest) -> ManifestVerificationResult: ...


class RuntimeBoundManifestVerifier:
    """Bind a host supplied bounded probe to one local runtime adapter.

    This is an integration seam, not a built-in capability test: AI Dream has
    no generic way to infer the semantic capabilities of an arbitrary model.
    The callback owns that policy and may invoke the model only when the user
    explicitly requests verification. Construction and ``runtime.probe()``
    must remain side-effect free; the API separately checks that this runtime
    is registered, enabled, and available before calling ``verify``.
    """

    def __init__(self, runtime: Any,
                 probe: Callable[[Any, ModelManifest], ManifestVerificationResult]):
        runtime_id = getattr(runtime, "runtime_id", None)
        if not isinstance(runtime_id, str) or not runtime_id.strip() or len(runtime_id) > 128:
            raise ValueError("runtime adapter must expose a bounded runtime_id")
        if not callable(getattr(runtime, "probe", None)):
            raise TypeError("runtime adapter must expose a read-only probe()")
        if not callable(probe):
            raise TypeError("manifest verification requires an explicit bounded probe callback")
        self.runtime = runtime
        self.runtime_id = runtime_id
        self._probe = probe

    def verify(self, manifest: ModelManifest) -> ManifestVerificationResult:
        descriptor = self.runtime.probe()
        if (getattr(descriptor, "runtime_id", None) != self.runtime_id
                or getattr(descriptor, "available", None) is not True):
            raise RuntimeError("Bound local runtime is unavailable for manifest verification")
        result = self._probe(self.runtime, manifest)
        if not isinstance(result, ManifestVerificationResult):
            raise TypeError("manifest probe must return ManifestVerificationResult")
        if result.manifest_id != manifest.id or result.runtime_id != self.runtime_id:
            raise ValueError("manifest probe returned a result for a different manifest or runtime")
        return result


__all__ = [
    "ManifestVerificationResult", "ManifestVerificationStore", "ManifestVerifier",
    "RuntimeBoundManifestVerifier", "default_manifest_verification_path",
]
