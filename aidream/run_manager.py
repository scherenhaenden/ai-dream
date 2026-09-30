"""Bounded process-local orchestration run lifecycle and event journal."""
from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass, field
import threading
import time
import uuid
import inspect
from typing import Any, Callable, Mapping


class RunNotFound(KeyError):
    """No retained run has the requested identifier."""


class RunStateError(ValueError):
    """A run cannot perform the requested state transition."""


class RunCancelled(Exception):
    """Raised by an executor when it cooperatively observes cancellation."""


_TERMINAL = {"succeeded", "failed", "cancelled"}
_STATES = {"queued", "running", *_TERMINAL}


@dataclass
class _Run:
    id: str
    skill_id: str
    skill_version: str
    plan: Mapping[str, Any]
    created_at: float
    cancel_event: threading.Event = field(default_factory=threading.Event)
    state: str = "queued"
    started_at: float | None = None
    completed_at: float | None = None
    current_nodes: tuple[str, ...] = ()
    outputs: tuple[Any, ...] = ()
    error: Mapping[str, Any] | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    next_sequence: int = 1
    future: Future | None = None
    cancel_callback: Callable[[], None] | None = None
    context: Any = field(default=None, repr=False)


class RunManager:
    """Runs validated immutable plans with bounded concurrency and event history.

    Planning/validation and node execution are injected; this manager never
    chooses a model or starts a runtime itself.
    """

    def __init__(self, *, executor: Callable[..., Any], artifact_store=None, release_leases=None,
                 max_active_runs: int = 4, max_retained_runs: int = 64,
                 max_events_per_run: int = 512, workers: int = 4, clock=time.time):
        for name, value in (("max_active_runs", max_active_runs), ("max_retained_runs", max_retained_runs),
                            ("max_events_per_run", max_events_per_run), ("workers", workers)):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if max_active_runs > max_retained_runs:
            raise ValueError("max_active_runs cannot exceed max_retained_runs")
        if not callable(executor):
            raise TypeError("executor must be callable")
        self._executor = executor
        self._artifact_store = artifact_store
        self._release_leases = release_leases
        self._max_active = max_active_runs
        self._max_retained = max_retained_runs
        self._max_events = max_events_per_run
        self._clock = clock
        self._lock = threading.RLock()
        self._changed = threading.Condition(self._lock)
        self._runs: dict[str, _Run] = {}
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ai-dream-run")
        self._closed = False

    def create(self, *, skill_id: str, skill_version: str, plan: Mapping[str, Any],
               cancel_callback: Callable[[], None] | None = None, context: Any = None) -> dict[str, Any]:
        if not isinstance(skill_id, str) or not skill_id or len(skill_id) > 256:
            raise ValueError("skill_id must be bounded non-empty text")
        if not isinstance(skill_version, str) or not skill_version or len(skill_version) > 64:
            raise ValueError("skill_version must be bounded non-empty text")
        if not isinstance(plan, Mapping):
            raise ValueError("plan must be an object")
        # The plan is detached, JSON-compatible and never returned mutable.
        immutable_plan = _freeze_mapping(plan)
        with self._changed:
            self._ensure_open()
            self._prune_locked()
            if sum(run.state not in _TERMINAL for run in self._runs.values()) >= self._max_active:
                raise RunStateError("active run limit reached")
            run_id = uuid.uuid4().hex
            run = _Run(run_id, skill_id, skill_version, immutable_plan, self._clock(),
                       cancel_callback=cancel_callback, context=context)
            self._runs[run_id] = run
            self._prune_locked()
            self._emit_locked(run, "run.created", {"skill_id": skill_id, "skill_version": skill_version})
            self._emit_locked(run, "plan.resolved", {"plan": _thaw(immutable_plan)})
            run.future = self._pool.submit(self._execute, run_id)
            return self._snapshot_locked(run)

    def _execute(self, run_id: str) -> None:
        with self._changed:
            run = self._require_locked(run_id)
            if run.cancel_event.is_set():
                self._finish_locked(run, "cancelled")
                return
            run.state = "running"
            run.started_at = self._clock()
            self._emit_locked(run, "run.started", {})
        try:
            arguments = {
                "plan": _thaw(run.plan), "cancel_event": run.cancel_event,
                "emit": lambda event, data=None: self._emit(run_id, event, data or {}),
            }
            try:
                signature = inspect.signature(self._executor)
                if "run_id" in signature.parameters or any(
                    parameter.kind == inspect.Parameter.VAR_KEYWORD
                    for parameter in signature.parameters.values()
                ):
                    arguments["run_id"] = run_id
            except (TypeError, ValueError):
                pass
            if run.context is not None:
                arguments["context"] = run.context
            outputs = self._executor(**arguments)
            if outputs is None:
                outputs = []
            if not isinstance(outputs, (list, tuple)):
                raise RunStateError("executor outputs must be a list or tuple")
            outputs = self._persist_output_artifacts(run_id, list(outputs))
            with self._changed:
                run = self._require_locked(run_id)
                if run.cancel_event.is_set():
                    self._finish_locked(run, "cancelled")
                else:
                    run.outputs = tuple(deepcopy(outputs))
                    self._emit_locked(run, "run.completed", {"outputs": list(run.outputs)})
                    self._finish_locked(run, "succeeded")
        except (RunCancelled,):
            with self._changed:
                run = self._require_locked(run_id)
                self._finish_locked(run, "cancelled")
        except BaseException as exc:
            with self._changed:
                run = self._require_locked(run_id)
                if run.state not in _TERMINAL:
                    run.error = {"kind": "internal_error", "message": str(exc)[:512] or type(exc).__name__}
                    self._emit_locked(run, "run.failed", dict(run.error))
                    self._finish_locked(run, "failed")

    def get(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            return self._snapshot_locked(self._require_locked(run_id))

    def list_runs(self) -> list[dict[str, Any]]:
        """Return retained run summaries in stable creation order."""
        with self._lock:
            return [self._snapshot_locked(run) for run in self._runs.values()]

    def events(self, run_id: str, *, after: int = 0) -> list[dict[str, Any]]:
        if isinstance(after, bool) or not isinstance(after, int) or after < 0:
            raise ValueError("after sequence must be a non-negative integer")
        with self._lock:
            run = self._require_locked(run_id)
            return [deepcopy(item) for item in run.events if item["sequence"] > after]

    def wait_events(self, run_id: str, *, after: int = 0, timeout: float | None = None) -> list[dict[str, Any]]:
        with self._changed:
            run = self._require_locked(run_id)
            if not any(item["sequence"] > after for item in run.events) and run.state not in _TERMINAL:
                self._changed.wait(timeout=max(0.0, timeout) if timeout is not None else None)
            return [deepcopy(item) for item in run.events if item["sequence"] > after]

    def cancel(self, run_id: str) -> dict[str, Any]:
        callback = None
        with self._changed:
            run = self._require_locked(run_id)
            if run.state in _TERMINAL:
                return self._snapshot_locked(run)
            run.cancel_event.set()
            callback = run.cancel_callback
            self._emit_locked(run, "run.cancelling", {})
            if run.state == "queued":
                self._finish_locked(run, "cancelled")
        if callback:
            try:
                callback()
            except Exception:
                pass
        return self.get(run_id)

    def _emit(self, run_id: str, event_type: str, data: Mapping[str, Any]) -> None:
        with self._changed:
            self._emit_locked(self._require_locked(run_id), event_type, data)

    def _emit_locked(self, run: _Run, event_type: str, data: Mapping[str, Any]) -> None:
        if not isinstance(event_type, str) or not event_type or len(event_type) > 80:
            raise ValueError("event type must be bounded non-empty text")
        safe_data = _json_value(data)
        event = {"run_id": run.id, "sequence": run.next_sequence,
                 "timestamp": self._clock(), "type": event_type, "data": safe_data}
        run.next_sequence += 1
        run.events.append(event)
        if len(run.events) > self._max_events:
            del run.events[:len(run.events) - self._max_events]
        self._changed.notify_all()

    def _finish_locked(self, run: _Run, state: str) -> None:
        if state not in _TERMINAL:
            raise ValueError("finish state must be terminal")
        if run.state in _TERMINAL:
            return
        run.state = state
        run.completed_at = self._clock()
        run.context = None
        self._emit_locked(run, "run." + state, {})
        if self._artifact_store is not None:
            try:
                # Successful output envelopes live for the store's session TTL.
                # Failed/cancelled runs have no usable outputs, so release all
                # run-owned bytes immediately.
                if state == "succeeded":
                    self._artifact_store.delete_owner("run", run.id, lifetime="ephemeral")
                else:
                    self._artifact_store.delete_owner("run", run.id)
            except Exception:
                pass
        if self._release_leases is not None:
            try:
                self._release_leases(run.id)
            except Exception:
                pass
        self._prune_locked()
        self._changed.notify_all()

    def _snapshot_locked(self, run: _Run) -> dict[str, Any]:
        return {"id": run.id, "skill_id": run.skill_id, "skill_version": run.skill_version,
                "plan": _thaw(run.plan), "state": run.state, "created_at": run.created_at,
                "started_at": run.started_at, "completed_at": run.completed_at,
                "current_nodes": list(run.current_nodes), "outputs": deepcopy(list(run.outputs)),
                "error": deepcopy(run.error), "last_sequence": run.next_sequence - 1}

    def _require_locked(self, run_id: str) -> _Run:
        if not isinstance(run_id, str) or run_id not in self._runs:
            raise RunNotFound(run_id)
        return self._runs[run_id]

    def _prune_locked(self) -> None:
        terminal = [run_id for run_id, run in self._runs.items() if run.state in _TERMINAL]
        while len(self._runs) > self._max_retained and terminal:
            self._runs.pop(terminal.pop(0), None)

    def _ensure_open(self) -> None:
        if self._closed:
            raise RunStateError("run manager is closed")

    def set_artifact_store(self, artifact_store) -> None:
        """Attach the shared bounded artifact store before accepting binary outputs."""
        if artifact_store is None or not callable(getattr(artifact_store, "put", None)):
            raise TypeError("artifact_store must provide put()")
        with self._changed:
            self._ensure_open()
            if any(run.state not in _TERMINAL for run in self._runs.values()):
                raise RunStateError("artifact store cannot change while runs are active")
            self._artifact_store = artifact_store

    def _persist_output_artifacts(self, run_id: str, outputs: list[Any]) -> list[Any]:
        """Replace binary typed outputs with owner-scoped artifact envelopes."""
        from aidream.artifacts.contracts import ARTIFACT_KINDS

        def visit(value: Any, depth: int = 0) -> Any:
            if depth > 8:
                raise RunStateError("run output nesting is too deep")
            if isinstance(value, list):
                return [visit(item, depth + 1) for item in value[:128]]
            if not isinstance(value, Mapping):
                return value
            clean = {str(key): item for key, item in value.items()}
            kind = clean.get("kind")
            if kind in {"image", "audio", "document", "video", "screen_frame"}:
                payload_key = next((key for key in ("content_bytes", "bytes", "data")
                                    if isinstance(clean.get(key), (bytes, bytearray, memoryview))), None)
                if payload_key is not None:
                    if self._artifact_store is None:
                        raise RunStateError("binary run outputs require the shared artifact store")
                    payload = clean.pop(payload_key)
                    media_type = clean.pop("media_type", None)
                    name = clean.pop("name", None)
                    metadata = clean.pop("metadata", {})
                    # Binary payloads never enter run JSON, SSE, or retained events.
                    clean.pop("content", None)
                    if not isinstance(media_type, str) or not isinstance(name, str):
                        raise RunStateError("binary outputs require a media_type and filename")
                    if not isinstance(metadata, Mapping):
                        raise RunStateError("binary output metadata must be an object")
                    envelope = self._artifact_store.put(
                        payload, kind=kind, media_type=media_type, name=name,
                        owner_type="run", owner_id=run_id, lifetime="session",
                        metadata=metadata,
                    )
                    self._emit(run_id, "artifact.produced", {
                        "artifact": envelope, "artifact_id": envelope["id"],
                        "kind": envelope["kind"], "name": envelope["name"],
                    })
                    return {**visit(clean, depth + 1), "artifact": envelope}
                # Already materialized artifacts remain references, but verify
                # that ownership cannot be spoofed across run boundaries.
                envelope = clean.get("artifact")
                if isinstance(envelope, Mapping) and envelope.get("owner") != {"type": "run", "id": run_id}:
                    raise RunStateError("run outputs cannot reference artifacts owned by another scope")
                if not isinstance(envelope, Mapping) and any(key in clean for key in ("content_bytes", "bytes", "base64")):
                    raise RunStateError("binary output payload must be bytes and stored as an artifact")
                if not isinstance(envelope, Mapping) and any(
                    isinstance(clean.get(key), (str, bytes, bytearray, memoryview))
                    for key in ("data", "content")
                ):
                    raise RunStateError("binary output data must be bytes and stored as an artifact")
            return {key: visit(item, depth + 1) for key, item in clean.items()}

        normalized = [visit(item) for item in outputs]
        unknown = set()
        for item in normalized:
            if isinstance(item, Mapping) and item.get("kind") is not None and item.get("kind") not in ARTIFACT_KINDS:
                unknown.add(str(item.get("kind")))
        if unknown:
            raise RunStateError("run output has unsupported artifact kind")
        return normalized

    def close(self, *, wait: bool = True) -> None:
        with self._changed:
            if self._closed:
                return
            self._closed = True
            active = [run for run in self._runs.values() if run.state not in _TERMINAL]
            for run in active:
                run.cancel_event.set()
                self._emit_locked(run, "run.cancelling", {"reason": "manager_shutdown"})
        for run in active:
            if run.cancel_callback:
                try: run.cancel_callback()
                except Exception: pass
        self._pool.shutdown(wait=wait, cancel_futures=True)
        with self._changed:
            for run in active:
                # A non-waiting shutdown cannot claim an executing runtime
                # has stopped. Keep its run and leases alive until _execute
                # observes cancellation and completes cleanup. Queued futures
                # cancelled by shutdown never enter _execute, so finalize
                # those here (and any remaining runs after a waiting shutdown).
                future_was_cancelled = run.future is not None and run.future.cancelled()
                if run.state not in _TERMINAL and (wait or future_was_cancelled):
                    self._finish_locked(run, "cancelled")


def _json_value(value: Any, depth: int = 0) -> Any:
    if depth > 16:
        raise ValueError("run data exceeds nesting limit")
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        import math
        if not math.isfinite(value): raise ValueError("run data must be finite")
        return value
    if isinstance(value, Mapping):
        if len(value) > 1024: raise ValueError("run object has too many fields")
        if any(not isinstance(key, str) or len(key) > 128 for key in value): raise ValueError("run keys must be bounded text")
        return {key: _json_value(item, depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        if len(value) > 4096: raise ValueError("run array has too many values")
        return [_json_value(item, depth + 1) for item in value]
    raise ValueError("run data must be JSON-compatible")


def _freeze_mapping(value: Mapping[str, Any]) -> Mapping[str, Any]:
    return _json_value(value)


def _thaw(value: Any) -> Any:
    return deepcopy(value)


__all__ = ["RunCancelled", "RunManager", "RunNotFound", "RunStateError"]
