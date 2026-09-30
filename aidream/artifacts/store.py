"""Private, bounded storage for temporary orchestration artifacts.

Artifact bytes stay in private files and cross process boundaries only through
opaque IDs and validated metadata envelopes. Persistent artifacts belong in a
separate durable store and are deliberately rejected here.
"""
from __future__ import annotations

import os
import secrets
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Mapping

from .contracts import ArtifactEnvelope, ArtifactKind, ArtifactLifetime, validate_artifact_envelope


class ArtifactStoreError(Exception):
    """Base error for artifact storage operations."""


class ArtifactNotFoundError(ArtifactStoreError):
    """The requested artifact is missing, expired, or owned elsewhere."""


class ArtifactLimitError(ArtifactStoreError):
    """An artifact or store quota would be exceeded."""


class ArtifactStore:
    """A process-local temporary artifact store with owner-scoped cleanup.

    ``root`` is created as a private directory (0700). The caller may specify
    an empty parent directory for tests; the store creates and owns a child
    directory beneath it. Limits apply to stored content, not JSON metadata.
    """

    def __init__(
        self,
        root: str | os.PathLike[str] | None = None,
        *,
        max_artifact_bytes: int = 32 * 1024 * 1024,
        max_total_bytes: int = 256 * 1024 * 1024,
        max_artifacts: int = 128,
        ephemeral_ttl_seconds: float = 60 * 60,
        session_ttl_seconds: float = 24 * 60 * 60,
        clock=time.time,
    ) -> None:
        for name, value in (("max_artifact_bytes", max_artifact_bytes), ("max_total_bytes", max_total_bytes), ("max_artifacts", max_artifacts)):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        for name, value in (("ephemeral_ttl_seconds", ephemeral_ttl_seconds), ("session_ttl_seconds", session_ttl_seconds)):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
                raise ValueError(f"{name} must be positive")
        self.max_artifact_bytes = max_artifact_bytes
        self.max_total_bytes = max_total_bytes
        self.max_artifacts = max_artifacts
        self._ttls = {"ephemeral": float(ephemeral_ttl_seconds), "session": float(session_ttl_seconds)}
        self._clock = clock
        self._lock = threading.RLock()
        self._records: dict[str, tuple[ArtifactEnvelope, Path, float]] = {}
        parent = Path(root) if root is not None else self._default_parent()
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            os.chmod(parent, 0o700)
        except OSError:
            pass
        self._root = Path(tempfile.mkdtemp(prefix="artifacts-", dir=parent))
        os.chmod(self._root, 0o700)
        self._closed = False

    @staticmethod
    def _default_parent() -> Path:
        runtime = os.environ.get("XDG_RUNTIME_DIR")
        if runtime and Path(runtime).is_absolute() and os.access(runtime, os.W_OK | os.X_OK):
            return Path(runtime) / "ai-dream"
        return Path(tempfile.gettempdir()) / f"ai-dream-{os.getuid()}"

    @property
    def root(self) -> Path:
        """Internal root for diagnostics only; never include it in an envelope."""
        return self._root

    def put(
        self,
        content: bytes | bytearray | memoryview,
        *,
        kind: ArtifactKind,
        media_type: str,
        name: str,
        owner_type: str,
        owner_id: str,
        lifetime: ArtifactLifetime = "ephemeral",
        metadata: Mapping[str, object] | None = None,
    ) -> ArtifactEnvelope:
        if lifetime == "persistent":
            raise ValueError("persistent artifacts require a durable artifact store")
        if lifetime not in self._ttls:
            raise ValueError("unsupported temporary artifact lifetime")
        if not isinstance(content, (bytes, bytearray, memoryview)):
            raise TypeError("artifact content must be bytes-like")
        data = bytes(content)
        if len(data) > self.max_artifact_bytes:
            raise ArtifactLimitError("artifact exceeds per-artifact byte limit")
        now = self._clock()
        with self._lock:
            self._ensure_open()
            self._cleanup_expired_locked(now)
            if len(self._records) >= self.max_artifacts:
                raise ArtifactLimitError("artifact count limit reached")
            used = sum(row[0]["size_bytes"] for row in self._records.values())
            if used + len(data) > self.max_total_bytes:
                raise ArtifactLimitError("artifact store byte limit reached")
            artifact_id = "art_" + secrets.token_urlsafe(18).replace("-", "_")
            key = secrets.token_hex(24)
            path = self._root / key
            envelope = validate_artifact_envelope({
                "schema_version": 1,
                "id": artifact_id,
                "kind": kind,
                "media_type": media_type,
                "name": name,
                "storage": {"type": "run-local" if lifetime == "ephemeral" else "session", "key": key},
                "size_bytes": len(data),
                "lifetime": lifetime,
                "owner": {"type": owner_type, "id": owner_id},
                "metadata": dict(metadata or {}),
            })
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            fd = os.open(path, flags, 0o600)
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
            except BaseException:
                try:
                    path.unlink()
                except OSError:
                    pass
                raise
            self._records[artifact_id] = (envelope, path, now + self._ttls[lifetime])
            return envelope

    def metadata(self, artifact_id: str, *, owner_type: str | None = None, owner_id: str | None = None) -> ArtifactEnvelope:
        with self._lock:
            row = self._get_locked(artifact_id, owner_type, owner_id)
            return validate_artifact_envelope(row[0])

    def list_owner(self, owner_type: str, owner_id: str) -> list[ArtifactEnvelope]:
        """Return detached metadata envelopes for one owner, never blob paths."""
        with self._lock:
            self._ensure_open()
            self._cleanup_expired_locked(self._clock())
            return [validate_artifact_envelope(row[0]) for row in self._records.values()
                    if row[0]["owner"] == {"type": owner_type, "id": owner_id}]

    def read(self, artifact_id: str, *, owner_type: str | None = None, owner_id: str | None = None) -> bytes:
        with self._lock:
            _, path, _ = self._get_locked(artifact_id, owner_type, owner_id)
            try:
                return path.read_bytes()
            except FileNotFoundError as exc:
                self._records.pop(artifact_id, None)
                raise ArtifactNotFoundError("artifact content is unavailable") from exc

    def delete(self, artifact_id: str, *, owner_type: str | None = None, owner_id: str | None = None) -> bool:
        with self._lock:
            row = self._records.get(artifact_id)
            if row is None:
                return False
            self._check_owner(row[0], owner_type, owner_id)
            self._remove_locked(artifact_id, row)
            return True

    def delete_owner(self, owner_type: str, owner_id: str, *, lifetime: str | None = None) -> int:
        """Delete artifacts for an owner; call on run cancellation/completion."""
        with self._lock:
            self._ensure_open()
            targets = [(key, row) for key, row in self._records.items()
                       if row[0]["owner"] == {"type": owner_type, "id": owner_id}
                       and (lifetime is None or row[0]["lifetime"] == lifetime)]
            for key, row in targets:
                self._remove_locked(key, row)
            return len(targets)

    def cleanup_expired(self) -> int:
        with self._lock:
            self._ensure_open()
            return self._cleanup_expired_locked(self._clock())

    def _cleanup_expired_locked(self, now: float) -> int:
        targets = [(key, row) for key, row in self._records.items() if row[2] <= now]
        for key, row in targets:
            self._remove_locked(key, row)
        return len(targets)

    def _get_locked(self, artifact_id: str, owner_type: str | None, owner_id: str | None):
        self._ensure_open()
        self._cleanup_expired_locked(self._clock())
        row = self._records.get(artifact_id)
        if row is None:
            raise ArtifactNotFoundError("artifact not found")
        self._check_owner(row[0], owner_type, owner_id)
        return row

    @staticmethod
    def _check_owner(envelope: ArtifactEnvelope, owner_type: str | None, owner_id: str | None) -> None:
        owner = envelope["owner"]
        if (owner_type is not None and owner["type"] != owner_type) or (owner_id is not None and owner["id"] != owner_id):
            raise ArtifactNotFoundError("artifact not found")

    def _remove_locked(self, artifact_id: str, row) -> None:
        self._records.pop(artifact_id, None)
        try:
            row[1].unlink()
        except FileNotFoundError:
            pass

    def _ensure_open(self) -> None:
        if self._closed:
            raise ArtifactStoreError("artifact store is closed")

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._records.clear()
            shutil.rmtree(self._root, ignore_errors=True)

    def __enter__(self) -> "ArtifactStore":
        self._ensure_open()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


__all__ = ["ArtifactLimitError", "ArtifactNotFoundError", "ArtifactStore", "ArtifactStoreError"]
