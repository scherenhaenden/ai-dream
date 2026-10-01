"""Fail-closed adapter for optional, local image generation/edit runtimes.

The adapter accepts an injected backend and never discovers a cloud client,
downloads weights, or loads a model during probing. Backends must explicitly
declare ``local_only is True`` and ``network_access is False``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping
import re
import uuid

from aidream.runtime_adapters import (
    CompatibilityResult, HealthState, PreparedLaunch, RuntimeDescriptor,
    RuntimeFailure, RuntimeHandle, RuntimeOutput, RuntimeRequest,
    RuntimeErrorCode,
)

MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_PROMPT_CHARS = 8_000
_MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
_MIME = {"image/png": (b"\x89PNG\r\n\x1a\n",),
         "image/jpeg": (b"\xff\xd8\xff",),
         "image/webp": (b"RIFF",)}


@dataclass(frozen=True)
class LocalImageModel:
    """Opaque public model identity plus backend-private reference."""
    id: str
    backend_model: Any = field(repr=False, compare=False)


class LocalImageRuntimeAdapter:
    """Normalize a strictly local image backend to the RuntimeAdapter shape.

    Injected backend contract: ``local_only=True``, ``network_access=False``,
    ``capabilities()`` returning generation/edit flags, ``list_models()``,
    ``can_load(model)``, ``load(model, placement, options)``, ``generate_image``
    and optionally ``edit_image``. Image methods return bytes or a mapping with
    ``content_bytes`` and ``media_type``. All content remains in memory.
    """

    kind = "local-image"

    def __init__(self, backend: Any, *, runtime_id: str | None = None):
        self.backend = backend
        self.runtime_id = runtime_id or getattr(backend, "runtime_id", None) or "local-image"
        self._handle: RuntimeHandle | None = None
        self._model: LocalImageModel | None = None

    def _local_contract(self) -> bool:
        return (getattr(self.backend, "local_only", None) is True
                and getattr(self.backend, "network_access", None) is False)

    def _caps(self) -> Mapping[str, Any]:
        if not self._local_contract():
            return {}
        value = self.backend.capabilities()
        if isinstance(value, Mapping):
            return value
        return {name: getattr(value, name, False) for name in
                ("available", "image_generation", "image_editing", "details")}

    @staticmethod
    def _field(model: Any, name: str, default=None):
        return model.get(name, default) if isinstance(model, Mapping) else getattr(model, name, default)

    def list_models(self) -> tuple[LocalImageModel, ...]:
        """Return model identities only; listing must not load or fetch weights."""
        if not self._local_contract():
            return ()
        try:
            values = self.backend.list_models()
        except (OSError, RuntimeError, TypeError, ValueError, AttributeError):
            return ()
        result = []
        if not isinstance(values, (tuple, list)):
            return ()
        for value in values[:256]:
            model_id = self._field(value, "id")
            if not isinstance(model_id, str) or not _MODEL_ID.fullmatch(model_id):
                continue
            result.append(LocalImageModel(model_id, value))
        return tuple(result)

    @classmethod
    def resource_estimates(cls, model: LocalImageModel) -> tuple[int | None, int | None]:
        """Read only explicit nonnegative backend-provided byte estimates."""
        raw = model.backend_model
        hints = cls._field(raw, "resource_hints", {})
        hints = hints if isinstance(hints, Mapping) else {}

        def estimate(*values: Any) -> int | None:
            for value in values:
                if isinstance(value, int) and not isinstance(value, bool) and 0 < value <= (1 << 63) - 1:
                    return value
            return None

        ram = estimate(cls._field(raw, "estimated_ram_bytes"), hints.get("ram_bytes_estimate"))
        vram = estimate(cls._field(raw, "estimated_vram_bytes"), hints.get("vram_bytes_estimate"))
        return ram, vram

    def probe(self) -> RuntimeDescriptor:
        if not self._local_contract():
            return RuntimeDescriptor(self.runtime_id, self.kind, False, frozenset(),
                                     "Backend did not prove local-only, network-disabled execution")
        try:
            caps = self._caps()
            available = bool(caps.get("available"))
            features = set()
            if available and caps.get("image_generation"):
                features.add("image.generate")
            if available and caps.get("image_editing"):
                features.add("image.edit")
            compatible = any(self.supports({"model": model, "required_capability": feature}).compatible
                             for model in self.list_models()
                             for feature in features)
            detail = str(caps.get("details") or "")
            if not available:
                detail = detail or "Local image backend is unavailable"
            elif features and not compatible:
                detail = "No listed local model reports compatibility"
            return RuntimeDescriptor(self.runtime_id, self.kind, available and compatible,
                                     frozenset(features if compatible else ()), detail)
        except (OSError, RuntimeError, TypeError, ValueError, AttributeError):
            return RuntimeDescriptor(self.runtime_id, self.kind, False, frozenset(),
                                     "Local image backend probe failed")

    def supports(self, manifest: Any, profile: Any = None) -> CompatibilityResult:
        if not self._local_contract():
            return CompatibilityResult(False, ("Backend is not confirmed local-only with network disabled",))
        try:
            caps = self._caps()
            operation = self._field(manifest, "required_capability")
            flag = {"image.generate": "image_generation", "image.edit": "image_editing"}.get(operation)
            features = frozenset(name for name, key in
                                 (("image.generate", "image_generation"), ("image.edit", "image_editing"))
                                 if caps.get(key))
            if not caps.get("available") or not flag or not caps.get(flag):
                return CompatibilityResult(False, ("Backend does not advertise this image operation",), features)
            model = self._field(manifest, "model")
            if isinstance(model, LocalImageModel):
                model = model.backend_model
            checker = getattr(self.backend, "can_load", None)
            if checker is None or not checker(model):
                return CompatibilityResult(False, ("Model is incompatible with the local image backend",), features)
            return CompatibilityResult(True, (), features)
        except (OSError, RuntimeError, TypeError, ValueError, AttributeError):
            return CompatibilityResult(False, ("Local image compatibility probe failed",))

    def prepare(self, manifest: Any, profile: Any = None) -> PreparedLaunch:
        result = self.supports(manifest, profile)
        if not result.compatible:
            raise RuntimeFailure(RuntimeErrorCode.INCOMPATIBLE, "; ".join(result.reasons))
        model = self._field(manifest, "model")
        if isinstance(model, LocalImageModel):
            model = model.backend_model
        return PreparedLaunch(self.runtime_id, model,
                              self._field(profile, "placement"),
                              dict(self._field(profile, "load_options", {}) or {}))

    def load(self, prepared: PreparedLaunch) -> RuntimeHandle:
        if prepared.runtime_id != self.runtime_id:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "Prepared launch belongs to another runtime")
        if not self._local_contract():
            raise RuntimeFailure(RuntimeErrorCode.UNAVAILABLE, "Local image backend is unavailable")
        try:
            self.backend.load(prepared.model, prepared.placement, dict(prepared.options))
        except Exception as exc:
            raise RuntimeFailure(RuntimeErrorCode.FAILED, "Local image model could not be loaded", retryable=True) from exc
        self._model = LocalImageModel(str(self._field(prepared.model, "id", "model")), prepared.model)
        self._handle = RuntimeHandle(self.runtime_id, uuid.uuid4().hex)
        return self._handle

    def invoke(self, handle: RuntimeHandle, request: RuntimeRequest) -> RuntimeOutput:
        self._require_handle(handle)
        if request.operation not in {"image.generate", "image.edit"}:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "Unsupported image operation")
        if request.operation == "image.generate":
            prompt = request.inputs.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
                raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "Image prompt must be 1-8000 characters")
            method = getattr(self.backend, "generate_image", None)
            args = (prompt,)
        else:
            image = request.inputs.get("image")
            instruction = request.inputs.get("instruction")
            if not isinstance(image, bytes) or not self._valid_image(image, request.inputs.get("media_type")):
                raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "Edit input must be a supported bounded image")
            if not isinstance(instruction, str) or not instruction.strip() or len(instruction) > MAX_PROMPT_CHARS:
                raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "Edit instruction must be 1-8000 characters")
            method = getattr(self.backend, "edit_image", None)
            args = (image, instruction)
        if method is None:
            raise RuntimeFailure(RuntimeErrorCode.UNAVAILABLE, "Local backend does not implement this operation")
        try:
            result = method(*args, options=dict(request.options))
            if isinstance(result, Mapping):
                content, media_type = result.get("content_bytes"), result.get("media_type")
                name = result.get("name", "generated-image")
            else:
                content, media_type, name = result, "image/png", "generated-image.png"
            if not isinstance(content, bytes) or not self._valid_image(content, media_type):
                raise ValueError("backend returned invalid or oversized image data")
            value = {"kind": "image", "media_type": media_type,
                     "name": self._safe_name(name), "content_bytes": content,
                     "metadata": {"runtime_id": self.runtime_id}}
            return RuntimeOutput(request.operation, value,
                                 {"runtime_id": self.runtime_id, "request_id": request.request_id})
        except RuntimeFailure:
            raise
        except Exception as exc:
            raise RuntimeFailure(RuntimeErrorCode.FAILED, "Local image operation failed", retryable=True) from exc

    @staticmethod
    def _valid_image(content: bytes, media_type: Any) -> bool:
        if len(content) > MAX_IMAGE_BYTES or media_type not in _MIME or not content:
            return False
        signature = _MIME[media_type][0]
        if media_type == "image/webp":
            return len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"
        return content.startswith(signature)

    @staticmethod
    def _safe_name(name: Any) -> str:
        if (not isinstance(name, str) or not name or len(name) > 120 or not name.isprintable()
                or "/" in name or "\\" in name or name in {".", ".."}):
            return "generated-image.png"
        return name

    def cancel(self, handle: RuntimeHandle, request_id: str | None = None) -> bool:
        self._require_handle(handle)
        cancel = getattr(self.backend, "cancel_generation", None)
        if not callable(cancel):
            return False
        # Some providers (including ComfyUI) can safely remove a queued job but
        # cannot interrupt an active one without affecting unrelated work.
        # Do not report cancellation unless the backend confirms it.
        return cancel() is True

    def unload(self, handle: RuntimeHandle) -> None:
        self._require_handle(handle)
        self.backend.unload()
        self._handle = None
        self._model = None

    def health(self, handle: RuntimeHandle | None = None) -> HealthState:
        if handle is not None:
            self._require_handle(handle)
        loaded = self._handle is not None
        return HealthState(loaded, loaded, "Loaded" if loaded else "No image model loaded")

    def _require_handle(self, handle: RuntimeHandle) -> None:
        if handle != self._handle or handle.runtime_id != self.runtime_id:
            raise RuntimeFailure(RuntimeErrorCode.NOT_LOADED, "Runtime handle is not active")
