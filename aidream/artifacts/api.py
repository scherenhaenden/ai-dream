"""Control-plane operations over the bounded temporary ArtifactStore.

This layer is transport-neutral: an HTTP handler can pass a bounded raw body
to ``create`` and write ``content`` as a binary response without encoding the
blob in JSON. Public results contain validated envelopes, never filesystem
paths or bytes embedded in metadata.
"""
from __future__ import annotations

import re
from collections.abc import Mapping

from .contracts import ArtifactEnvelope, ArtifactKind, ArtifactLifetime
from .store import ArtifactLimitError, ArtifactNotFoundError, ArtifactStore, ArtifactStoreError

_OWNER_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
_OWNER_TYPES = frozenset({"run", "session", "user"})
_TEMP_LIFETIMES = frozenset({"ephemeral", "session"})


class ArtifactAPIError(Exception):
    """Transport-neutral error with an HTTP-compatible status and safe code."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def to_dict(self) -> dict[str, dict[str, str]]:
        return {"error": {"code": self.code, "message": self.message}}


class ArtifactAPI:
    """Bounded upload and owner-scoped artifact metadata/content operations."""

    def __init__(self, store: ArtifactStore):
        if not isinstance(store, ArtifactStore):
            raise TypeError("store must be an ArtifactStore")
        self.store = store

    def create(
        self,
        content: bytes | bytearray | memoryview,
        *,
        kind: ArtifactKind,
        media_type: str,
        name: str,
        owner_type: str,
        owner_id: str,
        lifetime: ArtifactLifetime = "session",
        metadata: Mapping[str, object] | None = None,
    ) -> ArtifactEnvelope:
        self._validate_owner(owner_type, owner_id)
        if not isinstance(lifetime, str) or lifetime not in _TEMP_LIFETIMES:
            raise ArtifactAPIError(400, "invalid_lifetime", "Only ephemeral or session artifacts can be uploaded to temporary storage")
        if not isinstance(content, (bytes, bytearray, memoryview)):
            raise ArtifactAPIError(400, "invalid_content", "Artifact body must be raw bytes")
        size = len(content)
        if size > self.store.max_artifact_bytes:
            raise ArtifactAPIError(413, "artifact_too_large", "Artifact upload exceeds the per-artifact byte limit")
        try:
            return self.store.put(
                content,
                kind=kind,
                media_type=media_type,
                name=name,
                owner_type=owner_type,
                owner_id=owner_id,
                lifetime=lifetime,
                metadata=metadata,
            )
        except ArtifactLimitError as exc:
            raise ArtifactAPIError(413, "artifact_limit", str(exc)) from exc
        except (ValueError, TypeError) as exc:
            raise ArtifactAPIError(400, "invalid_artifact", str(exc)) from exc
        except ArtifactStoreError as exc:
            raise ArtifactAPIError(503, "artifact_store_unavailable", "Temporary artifact storage is unavailable") from exc

    def list(self, *, owner_type: str, owner_id: str) -> list[ArtifactEnvelope]:
        self._validate_owner(owner_type, owner_id)
        try:
            return self.store.list_owner(owner_type, owner_id)
        except ArtifactStoreError as exc:
            raise ArtifactAPIError(503, "artifact_store_unavailable", "Temporary artifact storage is unavailable") from exc

    def metadata(self, artifact_id: str, *, owner_type: str, owner_id: str) -> ArtifactEnvelope:
        self._validate_owner(owner_type, owner_id)
        try:
            return self.store.metadata(artifact_id, owner_type=owner_type, owner_id=owner_id)
        except ArtifactNotFoundError as exc:
            raise ArtifactAPIError(404, "artifact_not_found", "Artifact not found") from exc
        except ArtifactStoreError as exc:
            raise ArtifactAPIError(503, "artifact_store_unavailable", "Temporary artifact storage is unavailable") from exc

    def content(self, artifact_id: str, *, owner_type: str, owner_id: str) -> tuple[ArtifactEnvelope, bytes]:
        """Return metadata and raw content separately for an HTTP binary response."""
        envelope = self.metadata(artifact_id, owner_type=owner_type, owner_id=owner_id)
        try:
            return envelope, self.store.read(artifact_id, owner_type=owner_type, owner_id=owner_id)
        except ArtifactNotFoundError as exc:
            raise ArtifactAPIError(404, "artifact_not_found", "Artifact not found") from exc
        except ArtifactStoreError as exc:
            raise ArtifactAPIError(503, "artifact_store_unavailable", "Temporary artifact storage is unavailable") from exc

    def delete(self, artifact_id: str, *, owner_type: str, owner_id: str) -> None:
        self._validate_owner(owner_type, owner_id)
        try:
            deleted = self.store.delete(artifact_id, owner_type=owner_type, owner_id=owner_id)
        except ArtifactNotFoundError as exc:
            raise ArtifactAPIError(404, "artifact_not_found", "Artifact not found") from exc
        except ArtifactStoreError as exc:
            raise ArtifactAPIError(503, "artifact_store_unavailable", "Temporary artifact storage is unavailable") from exc
        if not deleted:
            raise ArtifactAPIError(404, "artifact_not_found", "Artifact not found")

    @staticmethod
    def _validate_owner(owner_type: str, owner_id: str) -> None:
        if not isinstance(owner_type, str) or owner_type not in _OWNER_TYPES:
            raise ArtifactAPIError(400, "invalid_owner", "Unsupported artifact owner type")
        if not isinstance(owner_id, str) or not _OWNER_ID.fullmatch(owner_id):
            raise ArtifactAPIError(400, "invalid_owner", "Artifact owner ID is malformed")


__all__ = ["ArtifactAPI", "ArtifactAPIError"]
