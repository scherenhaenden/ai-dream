"""Normalized orchestration boundary over the existing inference backends.

Adapters are intentionally thin: backend implementations remain responsible
for their native process and CLI details, while orchestration speaks typed,
backend-neutral requests and results.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Protocol
import uuid


class RuntimeErrorCode(str, Enum):
    UNAVAILABLE = "runtime_unavailable"
    INCOMPATIBLE = "incompatible_model"
    INVALID_REQUEST = "invalid_request"
    NOT_LOADED = "model_not_loaded"
    CANCELLED = "cancelled"
    FAILED = "runtime_failed"


@dataclass(frozen=True)
class RuntimeFailure(Exception):
    code: RuntimeErrorCode
    message: str
    retryable: bool = False

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class RuntimeDescriptor:
    runtime_id: str
    kind: str
    available: bool
    features: frozenset[str] = frozenset()
    details: str = ""


@dataclass(frozen=True)
class CompatibilityResult:
    compatible: bool
    reasons: tuple[str, ...] = ()
    features: frozenset[str] = frozenset()


@dataclass(frozen=True)
class PreparedLaunch:
    runtime_id: str
    model: Any = field(repr=False, compare=False)
    placement: Any = field(default=None, repr=False, compare=False)
    options: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True)
class RuntimeHandle:
    runtime_id: str
    token: str


@dataclass(frozen=True)
class HealthState:
    healthy: bool
    loaded: bool
    details: str = ""


@dataclass(frozen=True)
class RuntimeOutput:
    operation: str
    value: Any
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RuntimeRequest:
    operation: str
    inputs: Mapping[str, Any]
    options: Mapping[str, Any] = field(default_factory=dict)
    request_id: str = ""


class RuntimeAdapter(Protocol):
    """Backend-neutral lifecycle and invocation API used by orchestration."""

    def probe(self) -> RuntimeDescriptor: ...
    def supports(self, manifest: Any, profile: Any = None) -> CompatibilityResult: ...
    def prepare(self, manifest: Any, profile: Any = None) -> PreparedLaunch: ...
    def load(self, prepared: PreparedLaunch) -> RuntimeHandle: ...
    def invoke(self, handle: RuntimeHandle, request: RuntimeRequest) -> RuntimeOutput: ...
    def cancel(self, handle: RuntimeHandle, request_id: str | None = None) -> bool: ...
    def unload(self, handle: RuntimeHandle) -> None: ...
    def health(self, handle: RuntimeHandle | None = None) -> HealthState: ...


def _get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(key, default)
    return getattr(value, key, default)


class BackendRuntimeAdapter:
    """Adapt an existing AI Dream backend without changing its engine."""

    kind = "unknown"

    def __init__(self, backend: Any, *, runtime_id: str | None = None):
        self.backend = backend
        self.runtime_id = runtime_id or getattr(backend, "runtime_id", None) or getattr(backend, "name", self.kind)
        self._handle: RuntimeHandle | None = None

    def _features(self) -> frozenset[str]:
        caps = self.backend.capabilities()
        names = {
            "chat_completions": "text.chat",
            "reasoning": "text.reason",
            "continuous_batching": "batch.continuous",
            "device_selection": "placement.device",
            "tensor_split": "placement.tensor_parallel",
            "context_size": "context.configurable",
            "max_concurrent": "requests.concurrent",
        }
        return frozenset(feature for attr, feature in names.items() if getattr(caps, attr, False))

    def probe(self) -> RuntimeDescriptor:
        caps = self.backend.capabilities()
        return RuntimeDescriptor(self.runtime_id, self.kind, bool(caps.available),
                                 self._features(), str(caps.details or ""))

    def supports(self, manifest: Any, profile: Any = None) -> CompatibilityResult:
        descriptor = self.probe()
        if not descriptor.available:
            return CompatibilityResult(False, (descriptor.details or "Runtime is unavailable",))
        model = _get(manifest, "model", manifest)
        try:
            compatible = bool(self.backend.can_load(model))
        except (OSError, TypeError, ValueError, RuntimeError) as exc:
            return CompatibilityResult(False, (str(exc),), descriptor.features)
        reasons = [] if compatible else ["Model format or required files are not supported by this runtime"]
        required = _get(manifest, "required_features", ()) or ()
        if isinstance(required, str):
            required = (required,)
        missing = sorted(set(required) - set(descriptor.features))
        if missing:
            compatible = False
            reasons.append("Runtime does not advertise required feature(s): " + ", ".join(missing))
        return CompatibilityResult(compatible, tuple(reasons), descriptor.features)

    def prepare(self, manifest: Any, profile: Any = None) -> PreparedLaunch:
        model = _get(manifest, "model", manifest)
        if not self.backend.capabilities().available:
            raise RuntimeFailure(RuntimeErrorCode.UNAVAILABLE, "Runtime is unavailable", retryable=True)
        if not self.backend.can_load(model):
            raise RuntimeFailure(RuntimeErrorCode.INCOMPATIBLE, "Model is incompatible with this runtime")
        placement = _get(profile, "placement", None)
        options = _get(profile, "load_options", None) or {}
        try:
            validator = getattr(self.backend, "validate_load", None)
            if validator:
                validator(model, placement, options)
        except ValueError as exc:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, str(exc)) from exc
        except RuntimeError as exc:
            raise RuntimeFailure(RuntimeErrorCode.UNAVAILABLE, str(exc), retryable=True) from exc
        return PreparedLaunch(self.runtime_id, model, placement, dict(options))

    def load(self, prepared: PreparedLaunch) -> RuntimeHandle:
        self._require_runtime(prepared.runtime_id)
        try:
            self.backend.load(prepared.model, prepared.placement, prepared.options)
        except ValueError as exc:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, str(exc)) from exc
        except RuntimeError as exc:
            raise RuntimeFailure(RuntimeErrorCode.FAILED, str(exc), retryable=True) from exc
        self._handle = RuntimeHandle(self.runtime_id, uuid.uuid4().hex)
        return self._handle

    def invoke(self, handle: RuntimeHandle, request: RuntimeRequest) -> RuntimeOutput:
        self._require_handle(handle)
        if request.operation not in {"text.generate", "text.chat"}:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST,
                                 f"Unsupported operation: {request.operation}")
        prompt = request.inputs.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "A non-empty prompt is required")
        options = dict(request.options)
        # Validated image attachments are passed through the existing backend
        # image path. The adapter does not accept paths or load media itself.
        if "images" in request.inputs:
            if "images" in options:
                raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST,
                                     "Provide images in either inputs or options, not both")
            options["images"] = request.inputs["images"]
        try:
            result = self.backend.generate(prompt, options)
        except ValueError as exc:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, str(exc)) from exc
        except Exception as exc:
            # Keep engine exceptions private from the orchestration contract.
            name = type(exc).__name__.lower()
            code = RuntimeErrorCode.CANCELLED if "cancel" in name else RuntimeErrorCode.FAILED
            raise RuntimeFailure(code, str(exc), retryable=code == RuntimeErrorCode.FAILED) from exc
        return RuntimeOutput(request.operation, result,
                             {"runtime_id": self.runtime_id, "request_id": request.request_id})

    def cancel(self, handle: RuntimeHandle, request_id: str | None = None) -> bool:
        self._require_handle(handle)
        cancel = getattr(self.backend, "cancel_generation", None)
        if cancel is None:
            return False
        cancel()
        return True

    def unload(self, handle: RuntimeHandle) -> None:
        self._require_handle(handle)
        self.backend.unload()
        self._handle = None

    def health(self, handle: RuntimeHandle | None = None) -> HealthState:
        if handle is not None:
            self._require_handle(handle)
        status = getattr(self.backend, "status", None)
        if status is not None:
            state = status()
            loaded = bool(state.get("loaded"))
            return HealthState(loaded, loaded, "Loaded" if loaded else "No model loaded")
        if hasattr(self.backend, "_process"):
            process = self.backend._process
            loaded = bool(process is not None and process.poll() is None)
            return HealthState(loaded, loaded, "Loaded" if loaded else "No model loaded")
        loaded = self._handle is not None
        return HealthState(loaded, loaded, "Loaded" if loaded else "No model loaded")

    def _require_runtime(self, runtime_id: str) -> None:
        if runtime_id != self.runtime_id:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "Prepared launch belongs to another runtime")

    def _require_handle(self, handle: RuntimeHandle) -> None:
        if handle != self._handle or handle.runtime_id != self.runtime_id:
            raise RuntimeFailure(RuntimeErrorCode.NOT_LOADED, "Runtime handle is not active")


class LlamaCppRuntimeAdapter(BackendRuntimeAdapter):
    kind = "llama.cpp"


class VLLMRuntimeAdapter(BackendRuntimeAdapter):
    kind = "vllm"


class FakeRuntimeAdapter:
    """Deterministic adapter for contract/lifecycle tests; performs no IO."""

    def __init__(self, *, runtime_id: str = "fake", features: set[str] | frozenset[str] = frozenset(),
                 compatible: bool = True):
        self.runtime_id = runtime_id
        self.features = frozenset(features)
        self.compatible = compatible
        self.loaded = False
        self.cancelled: list[str | None] = []
        self.calls: list[str] = []

    def probe(self) -> RuntimeDescriptor:
        self.calls.append("probe")
        return RuntimeDescriptor(self.runtime_id, "fake", True, self.features)

    def supports(self, manifest: Any, profile: Any = None) -> CompatibilityResult:
        self.calls.append("supports")
        return CompatibilityResult(self.compatible, () if self.compatible else ("not compatible",), self.features)

    def prepare(self, manifest: Any, profile: Any = None) -> PreparedLaunch:
        self.calls.append("prepare")
        if not self.compatible:
            raise RuntimeFailure(RuntimeErrorCode.INCOMPATIBLE, "not compatible")
        return PreparedLaunch(self.runtime_id, manifest)

    def load(self, prepared: PreparedLaunch) -> RuntimeHandle:
        self.calls.append("load")
        if prepared.runtime_id != self.runtime_id:
            raise RuntimeFailure(RuntimeErrorCode.INVALID_REQUEST, "wrong runtime")
        self.loaded = True
        return RuntimeHandle(self.runtime_id, "fake-handle")

    def invoke(self, handle: RuntimeHandle, request: RuntimeRequest) -> RuntimeOutput:
        self.calls.append("invoke")
        self._check(handle)
        if not self.loaded:
            raise RuntimeFailure(RuntimeErrorCode.NOT_LOADED, "not loaded")
        return RuntimeOutput(request.operation, {"echo": dict(request.inputs)})

    def cancel(self, handle: RuntimeHandle, request_id: str | None = None) -> bool:
        self.calls.append("cancel")
        self._check(handle)
        self.cancelled.append(request_id)
        return True

    def unload(self, handle: RuntimeHandle) -> None:
        self.calls.append("unload")
        self._check(handle)
        self.loaded = False

    def health(self, handle: RuntimeHandle | None = None) -> HealthState:
        self.calls.append("health")
        if handle is not None:
            self._check(handle)
        return HealthState(True, self.loaded, "Loaded" if self.loaded else "No model loaded")

    def _check(self, handle: RuntimeHandle) -> None:
        if handle.runtime_id != self.runtime_id or handle.token != "fake-handle":
            raise RuntimeFailure(RuntimeErrorCode.NOT_LOADED, "invalid handle")
