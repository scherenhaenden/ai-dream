"""Conservative, adapter-driven model residency and lease scheduler.

The initial policy serializes all load/unload/pin mutations, reuses idle
residents, and evicts only least-recently-used idle, unpinned models when a
known resource estimate needs room. Unknown measurements remain unknown.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import threading
import time
import uuid
from collections.abc import Collection, Sequence
from typing import Any, Callable, Mapping

from aidream.runtime_adapters import RuntimeAdapter, RuntimeHandle

_ANY_LEASE_OWNER = object()
MAX_RESERVATION_BATCH = 8


class SchedulerErrorCode(str, Enum):
    RUNTIME_UNAVAILABLE = "runtime_unavailable"
    INCOMPATIBLE = "incompatible_model"
    RESOURCE_UNAVAILABLE = "resource_unavailable"
    BUSY = "model_busy"
    INVALID_LEASE = "invalid_lease"
    LIFECYCLE_FAILED = "lifecycle_failed"
    NOT_ALLOWED = "not_allowed"


@dataclass(frozen=True)
class SchedulerError(Exception):
    code: SchedulerErrorCode
    message: str

    def __str__(self) -> str:
        return self.message


@dataclass(frozen=True)
class ResourceSnapshot:
    ram_total_bytes: int | None = None
    ram_available_bytes: int | None = None
    vram_total_bytes: int | None = None
    vram_available_bytes: int | None = None


@dataclass(frozen=True)
class LeaseRequest:
    model_id: str
    runtime_id: str
    manifest: Any
    profile: Any = None
    estimated_ram_bytes: int | None = None
    estimated_vram_bytes: int | None = None
    owner_id: str | None = None
    pin: bool = False
    allow_concurrent: bool = False
    orchestration_owned: bool = False


@dataclass(frozen=True)
class ModelLease:
    lease_id: str
    model_id: str
    profile_id: str | None
    runtime_id: str
    handle: RuntimeHandle
    acquired_at: str


@dataclass
class ResidencyRecord:
    model_id: str
    profile_id: str | None
    runtime_id: str
    handle: RuntimeHandle
    manifest: Any = field(repr=False)
    profile: Any = field(default=None, repr=False)
    estimated_ram_bytes: int | None = None
    estimated_vram_bytes: int | None = None
    pinned: bool = False
    lease_ids: set[str] = field(default_factory=set)
    active_calls: int = 0
    loaded_at: float = field(default_factory=time.monotonic)
    last_used_at: float = field(default_factory=time.monotonic)
    state: str = "idle"
    orchestration_owned: bool = False

    @property
    def lease_count(self) -> int:
        return len(self.lease_ids)


@dataclass(frozen=True)
class SchedulerEvent:
    type: str
    model_id: str
    runtime_id: str
    details: str = ""


class ModelScheduler:
    """Serialize residency changes while allowing safe lease reuse.

    `adapters` maps runtime IDs to the normalized adapter boundary. The
    snapshot callback may return stale/partial observations; fields omitted by
    the host stay unenforced, never treated as zero usage.
    """

    def __init__(self, adapters: Mapping[str, RuntimeAdapter], *,
                 resource_snapshot: Callable[[], ResourceSnapshot] | None = None,
                 ram_headroom_bytes: int = 0, vram_headroom_bytes: int = 0,
                 ram_headroom_ratio: float = 0.10, vram_headroom_ratio: float = 0.10,
                 eviction_policy: str = "lru",
                 keep_last_model_loaded: bool = True,
                 event_callback: Callable[[SchedulerEvent], None] | None = None):
        self.adapters = dict(adapters)
        self.resource_snapshot = resource_snapshot or (lambda: ResourceSnapshot())
        self.ram_headroom_bytes = self._nonnegative(ram_headroom_bytes, "ram_headroom_bytes")
        self.vram_headroom_bytes = self._nonnegative(vram_headroom_bytes, "vram_headroom_bytes")
        self.ram_headroom_ratio = self._ratio(ram_headroom_ratio, "ram_headroom_ratio")
        self.vram_headroom_ratio = self._ratio(vram_headroom_ratio, "vram_headroom_ratio")
        self.eviction_policy = self._eviction_policy(eviction_policy)
        self.keep_last_model_loaded = bool(keep_last_model_loaded)
        self.event_callback = event_callback
        self._records: dict[tuple[str, str, str | None], ResidencyRecord] = {}
        self._leases: dict[str, tuple[ResidencyRecord, str | None]] = {}
        self._mutation_lock = threading.RLock()

    @staticmethod
    def _nonnegative(value: int, name: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"{name} must be a non-negative integer")
        return value

    @staticmethod
    def _ratio(value: float, name: str) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value < 1:
            raise ValueError(f"{name} must be between 0 and 1")
        return float(value)

    @staticmethod
    def _eviction_policy(value: str) -> str:
        if value not in {"lru", "never"}:
            raise ValueError("eviction_policy must be 'lru' or 'never'")
        return value

    def set_eviction_policy(self, value: str) -> None:
        """Change future automatic resource-pressure eviction behavior."""
        policy = self._eviction_policy(value)
        with self._mutation_lock:
            self.eviction_policy = policy

    @staticmethod
    def _profile_id(profile: Any) -> str | None:
        if profile is None:
            return None
        if isinstance(profile, Mapping):
            return profile.get("profile_id") or profile.get("id")
        return getattr(profile, "profile_id", None) or getattr(profile, "id", None)

    def acquire(self, request: LeaseRequest) -> ModelLease:
        if not request.model_id or not request.runtime_id:
            raise ValueError("model_id and runtime_id are required")
        for name in ("estimated_ram_bytes", "estimated_vram_bytes"):
            value = getattr(request, name)
            if value is not None:
                self._nonnegative(value, name)
        key = (request.model_id, request.runtime_id, self._profile_id(request.profile))
        with self._mutation_lock:
            record = self._records.get(key)
            if record is not None:
                if record.lease_count and not request.allow_concurrent:
                    raise SchedulerError(SchedulerErrorCode.BUSY,
                                         "Model already has an active lease and runtime concurrency was not requested")
                if record.lease_count and request.allow_concurrent:
                    descriptor = self._adapter(request.runtime_id).probe()
                    if "requests.concurrent" not in descriptor.features:
                        raise SchedulerError(SchedulerErrorCode.BUSY,
                                             "Runtime does not advertise concurrent requests")
                return self._lease(record, request.owner_id, pin=request.pin)

            adapter = self._adapter(request.runtime_id)
            try:
                descriptor = adapter.probe()
                if not descriptor.available:
                    raise SchedulerError(SchedulerErrorCode.RUNTIME_UNAVAILABLE,
                                         descriptor.details or "Runtime is unavailable")
                compatibility = adapter.supports(request.manifest, request.profile)
                if not compatibility.compatible:
                    raise SchedulerError(SchedulerErrorCode.INCOMPATIBLE,
                                         "; ".join(compatibility.reasons) or "Model is incompatible")
                self._make_runtime_exclusive(request.runtime_id, request.model_id,
                                             multi_resident="models.multi_resident" in descriptor.features)
                self._make_room(request)
                prepared = adapter.prepare(request.manifest, request.profile)
                handle = adapter.load(prepared)
            except SchedulerError:
                raise
            except Exception as exc:
                raise SchedulerError(SchedulerErrorCode.LIFECYCLE_FAILED, str(exc)) from exc
            now = time.monotonic()
            record = ResidencyRecord(request.model_id, key[2], request.runtime_id, handle,
                                     request.manifest, request.profile,
                                     request.estimated_ram_bytes, request.estimated_vram_bytes,
                                     request.pin, loaded_at=now, last_used_at=now, state="ready",
                                     orchestration_owned=request.orchestration_owned)
            self._records[key] = record
            self._emit("model.load.completed", record)
            return self._lease(record, request.owner_id, pin=request.pin)

    def acquire_many(self, requests: Sequence[LeaseRequest]) -> tuple[ModelLease, ...]:
        """Atomically reserve a bounded group of route leases before parallel work.

        The scheduler lock spans all individual acquisitions, so another run
        cannot interleave a competing residency mutation between members of
        this reservation. If any member cannot be reserved, earlier leases are
        released before the original error is re-raised; no route invocation
        should start until this method returns successfully.
        """
        if len(requests) > MAX_RESERVATION_BATCH:
            raise SchedulerError(SchedulerErrorCode.RESOURCE_UNAVAILABLE,
                                 f"reservation batch exceeds the limit of {MAX_RESERVATION_BATCH}")
        batch = tuple(requests)
        if any(not isinstance(request, LeaseRequest) for request in batch):
            raise TypeError("requests must contain LeaseRequest values")
        leases: list[ModelLease] = []
        with self._mutation_lock:
            initial_records = dict(self._records)
            initial_residents = set(initial_records)
            try:
                for request in batch:
                    leases.append(self.acquire(request))
            except BaseException:
                rollback_errors: list[Exception] = []
                for lease in reversed(leases):
                    try:
                        self.release(lease)
                    except Exception as exc:  # preserve lease cleanup failure as an explicit lifecycle error
                        rollback_errors.append(exc)
                # Remove models this batch loaded solely for its tentative
                # reservations; otherwise a rejected fan-out can strand VRAM.
                for key in sorted(set(self._records) - initial_residents):
                    record = self._records.get(key)
                    if record is not None and not record.lease_count:
                        try:
                            self._unload_record(record, reason="rollback failed batch reservation", force=True)
                        except Exception as exc:
                            rollback_errors.append(exc)
                # Restore idle residents evicted while trying the tentative
                # group. They were already present before this reservation.
                for key in sorted(initial_residents - set(self._records)):
                    previous = initial_records[key]
                    try:
                        restored = self.acquire(LeaseRequest(
                            model_id=previous.model_id, runtime_id=previous.runtime_id,
                            manifest=previous.manifest, profile=previous.profile,
                            estimated_ram_bytes=previous.estimated_ram_bytes,
                            estimated_vram_bytes=previous.estimated_vram_bytes,
                            orchestration_owned=previous.orchestration_owned,
                        ))
                        self.release(restored)
                    except Exception as exc:
                        rollback_errors.append(exc)
                if rollback_errors:
                    raise SchedulerError(SchedulerErrorCode.LIFECYCLE_FAILED,
                                         "Could not fully roll back a failed batch reservation") from rollback_errors[0]
                raise
        return tuple(leases)

    def _make_runtime_exclusive(self, runtime_id: str, model_id: str, *, multi_resident: bool) -> None:
        if multi_resident:
            return
        siblings = sorted((record for record in self._records.values()
                           if record.runtime_id == runtime_id and record.model_id != model_id),
                          key=lambda record: record.last_used_at)
        for record in siblings:
            if record.lease_count or record.pinned:
                raise SchedulerError(SchedulerErrorCode.BUSY,
                                     "Runtime has another resident model that is busy or pinned")
            if self.eviction_policy == "never":
                raise SchedulerError(SchedulerErrorCode.RESOURCE_UNAVAILABLE,
                                     "Runtime supports one resident model; automatic eviction is disabled")
            self._unload_record(record, reason="runtime supports one resident model")

    def _make_room(self, request: LeaseRequest) -> None:
        while not self._fits(request):
            if self.eviction_policy == "never":
                raise SchedulerError(SchedulerErrorCode.RESOURCE_UNAVAILABLE,
                                     "Insufficient measured RAM/VRAM headroom; automatic eviction is disabled")
            candidates = sorted((r for r in self._records.values()
                                 if r.lease_count == 0 and not r.pinned),
                                key=lambda r: r.last_used_at)
            if not candidates:
                raise SchedulerError(SchedulerErrorCode.RESOURCE_UNAVAILABLE,
                                     "Insufficient measured RAM/VRAM headroom; all resident models are pinned or busy")
            self._unload_record(candidates[0], reason="LRU eviction for resource headroom")

    def _fits(self, request: LeaseRequest) -> bool:
        snapshot = self.resource_snapshot()
        return (self._fits_one(request.estimated_ram_bytes, snapshot.ram_total_bytes,
                               snapshot.ram_available_bytes, self.ram_headroom_bytes,
                               self.ram_headroom_ratio)
                and self._fits_one(request.estimated_vram_bytes, snapshot.vram_total_bytes,
                                   snapshot.vram_available_bytes, self.vram_headroom_bytes,
                                   self.vram_headroom_ratio))

    @staticmethod
    def _fits_one(estimate: int | None, total: int | None, available: int | None,
                  minimum_headroom: int, ratio: float) -> bool:
        if estimate is None or available is None:
            return True
        headroom = max(minimum_headroom, int(total * ratio)) if total is not None else minimum_headroom
        return estimate <= max(0, available - headroom)

    def _lease(self, record: ResidencyRecord, owner_id: str | None, *, pin: bool) -> ModelLease:
        lease_id = uuid.uuid4().hex
        record.lease_ids.add(lease_id)
        record.pinned = record.pinned or pin
        record.state = "busy"
        record.last_used_at = time.monotonic()
        self._leases[lease_id] = (record, owner_id)
        acquired = datetime.now(timezone.utc).isoformat()
        self._emit("model.lease.acquired", record)
        return ModelLease(lease_id, record.model_id, record.profile_id, record.runtime_id,
                          record.handle, acquired)

    def release(self, lease: ModelLease | str) -> None:
        lease_id = lease if isinstance(lease, str) else lease.lease_id
        with self._mutation_lock:
            self._release_locked(lease_id)

    def cancel(self, lease: ModelLease | str, request_id: str | None = None) -> None:
        """Signal cancellation without ending the lease.

        A runtime's cancellation callback may only request that an in-flight
        call stop. The caller must keep the lease until that call returns and
        then release it through the normal execution cleanup path.
        """
        lease_id = lease if isinstance(lease, str) else lease.lease_id
        with self._mutation_lock:
            entry = self._leases.get(lease_id)
            if entry is None:
                raise SchedulerError(SchedulerErrorCode.INVALID_LEASE, "Lease is no longer active")
            record, _owner = entry
            adapter, handle = self._adapter(record.runtime_id), record.handle
            # Prevent a concurrent owner cleanup from unloading the handle
            # until the cancellation signal itself has returned.
            record.active_calls += 1
        try:
            adapter.cancel(handle, request_id)
        except Exception as exc:
            raise SchedulerError(SchedulerErrorCode.LIFECYCLE_FAILED,
                                 f"Cancellation callback failed: {exc}") from exc
        finally:
            with self._mutation_lock:
                record.active_calls -= 1

    def begin_call(self, lease: ModelLease | str) -> None:
        """Mark an adapter invocation active for the lifetime of its call."""
        lease_id = lease if isinstance(lease, str) else lease.lease_id
        with self._mutation_lock:
            entry = self._leases.get(lease_id)
            if entry is None:
                raise SchedulerError(SchedulerErrorCode.INVALID_LEASE, "Lease is no longer active")
            record, _owner = entry
            record.active_calls += 1
            record.state = "busy"

    def end_call(self, lease: ModelLease | str) -> None:
        """Mark a completed adapter invocation; the lease remains caller-owned."""
        lease_id = lease if isinstance(lease, str) else lease.lease_id
        with self._mutation_lock:
            entry = self._leases.get(lease_id)
            if entry is None:
                raise SchedulerError(SchedulerErrorCode.INVALID_LEASE, "Lease is no longer active")
            record, _owner = entry
            if record.active_calls <= 0:
                raise SchedulerError(SchedulerErrorCode.LIFECYCLE_FAILED,
                                     "Lease has no active adapter call")
            record.active_calls -= 1

    def release_owner(self, owner_id: str) -> int:
        """Release every lease associated with a cancelled/finished run."""
        with self._mutation_lock:
            lease_ids = [lease_id for lease_id, (_record, owner) in self._leases.items()
                         if owner == owner_id]
            if any(self._leases[lease_id][0].active_calls for lease_id in lease_ids):
                raise SchedulerError(SchedulerErrorCode.BUSY,
                                     "Cannot release run leases while adapter calls are active")
            for lease_id in lease_ids:
                self._release_locked(lease_id)
            return len(lease_ids)

    def _release_locked(self, lease_id: str) -> None:
        entry = self._leases.get(lease_id)
        if entry is None:
            raise SchedulerError(SchedulerErrorCode.INVALID_LEASE, "Lease is no longer active")
        record, _owner = entry
        if record.active_calls:
            raise SchedulerError(SchedulerErrorCode.BUSY,
                                 "Cannot release a lease while adapter calls are active")
        self._leases.pop(lease_id)
        record.lease_ids.discard(lease_id)
        record.last_used_at = time.monotonic()
        record.state = "busy" if record.lease_count else "idle"
        self._emit("model.lease.released", record)
        if (not self.keep_last_model_loaded and self.eviction_policy == "lru"
                and not record.pinned and not record.lease_count):
            self._unload_record(record, reason="keep_last_model_loaded is disabled")

    def pin(self, model_id: str, runtime_id: str, pinned: bool = True,
            profile_id: str | None = None) -> None:
        with self._mutation_lock:
            record = self._records.get((model_id, runtime_id, profile_id))
            if record is None:
                raise SchedulerError(SchedulerErrorCode.INVALID_LEASE, "Model is not resident")
            record.pinned = bool(pinned)
            self._emit("model.residency.pinned" if pinned else "model.residency.unpinned", record)

    @staticmethod
    def _resident_key(model_id: str, runtime_id: str, profile_id: str | None
                      ) -> tuple[str, str, str | None]:
        if not isinstance(model_id, str) or not model_id or not isinstance(runtime_id, str) or not runtime_id:
            raise ValueError("model_id and runtime_id are required")
        if profile_id is not None and (not isinstance(profile_id, str) or not profile_id):
            raise ValueError("profile_id must be non-empty text or None")
        return model_id, runtime_id, profile_id

    def set_orchestration_pin(self, model_id: str, runtime_id: str, *, pinned: bool,
                              profile_id: str | None = None,
                              allowed_residents: Collection[tuple[str, str, str | None]]) -> None:
        """Pin/unpin an existing orchestration-owned resident on an allowlisted route.

        This operation never loads a model. The caller must supply the explicit
        route allowlist derived from trusted orchestration state, and the
        resident must have been loaded by an orchestration-owned lease.
        """
        if not isinstance(pinned, bool):
            raise ValueError("pinned must be a boolean")
        key = self._resident_key(model_id, runtime_id, profile_id)
        allowlist = self._validate_resident_allowlist(allowed_residents)
        if key not in allowlist:
            raise SchedulerError(SchedulerErrorCode.NOT_ALLOWED,
                                 "Resident route is not in the orchestration allowlist")
        with self._mutation_lock:
            record = self._records.get(key)
            self._require_orchestration_resident(record)
            record.pinned = pinned
            self._emit("model.residency.pinned" if pinned else "model.residency.unpinned", record)

    def unload_orchestration_resident(self, model_id: str, runtime_id: str, *,
                                      profile_id: str | None = None,
                                      allowed_residents: Collection[tuple[str, str, str | None]]) -> None:
        """Unload only an idle, unpinned orchestration-owned allowlisted resident."""
        key = self._resident_key(model_id, runtime_id, profile_id)
        allowlist = self._validate_resident_allowlist(allowed_residents)
        if key not in allowlist:
            raise SchedulerError(SchedulerErrorCode.NOT_ALLOWED,
                                 "Resident route is not in the orchestration allowlist")
        with self._mutation_lock:
            record = self._records.get(key)
            self._require_orchestration_resident(record)
            self.unload(model_id, runtime_id, profile_id)

    @staticmethod
    def _validate_resident_allowlist(allowed_residents: Collection[tuple[str, str, str | None]]
                                     ) -> frozenset[tuple[str, str, str | None]]:
        if isinstance(allowed_residents, (str, bytes)) or not isinstance(allowed_residents, Collection):
            raise ValueError("allowed_residents must be an explicit collection of resident keys")
        keys = frozenset(allowed_residents)
        if not keys:
            raise ValueError("allowed_residents cannot be empty")
        if any(not isinstance(key, tuple) or len(key) != 3
               or not isinstance(key[0], str) or not key[0]
               or not isinstance(key[1], str) or not key[1]
               or (key[2] is not None and (not isinstance(key[2], str) or not key[2]))
               for key in keys):
            raise ValueError("allowed_residents contains an invalid resident key")
        return keys

    @staticmethod
    def _require_orchestration_resident(record: ResidencyRecord | None) -> None:
        if record is None:
            raise SchedulerError(SchedulerErrorCode.INVALID_LEASE, "Model is not resident")
        if not record.orchestration_owned:
            raise SchedulerError(SchedulerErrorCode.NOT_ALLOWED,
                                 "Resident was not loaded by orchestration")

    def unload(self, model_id: str, runtime_id: str, profile_id: str | None = None,
               *, force: bool = False) -> None:
        with self._mutation_lock:
            record = self._records.get((model_id, runtime_id, profile_id))
            if record is None:
                return
            if record.lease_count:
                raise SchedulerError(SchedulerErrorCode.BUSY, "Cannot unload a model with active leases")
            if record.active_calls:
                raise SchedulerError(SchedulerErrorCode.BUSY, "Cannot unload a model with active adapter calls")
            if record.pinned and not force:
                raise SchedulerError(SchedulerErrorCode.BUSY, "Cannot unload a pinned model without force")
            self._unload_record(record, reason="requested", force=force)

    def _unload_record(self, record: ResidencyRecord, *, reason: str, force: bool = False) -> None:
        if record.lease_count:
            raise SchedulerError(SchedulerErrorCode.BUSY, "Cannot evict a model with active leases")
        if record.active_calls:
            raise SchedulerError(SchedulerErrorCode.BUSY, "Cannot evict a model with active adapter calls")
        if record.pinned and not force:
            raise SchedulerError(SchedulerErrorCode.BUSY, "Cannot evict a pinned model")
        record.state = "unloading"
        self._emit("model.unload.started", record, reason)
        try:
            self._adapter(record.runtime_id).unload(record.handle)
        except Exception as exc:
            record.state = "failed"
            self._emit("model.unload.failed", record, str(exc))
            raise SchedulerError(SchedulerErrorCode.LIFECYCLE_FAILED, str(exc)) from exc
        self._records.pop((record.model_id, record.runtime_id, record.profile_id), None)
        self._emit("model.unload.completed", record, reason)

    def residency(self) -> tuple[ResidencyRecord, ...]:
        with self._mutation_lock:
            return tuple(sorted(self._records.values(), key=lambda record:
                                (record.runtime_id, record.model_id, record.profile_id or "")))

    def active_leases(self) -> tuple[ModelLease, ...]:
        with self._mutation_lock:
            return tuple(ModelLease(lease_id, record.model_id, record.profile_id,
                                   record.runtime_id, record.handle,
                                   datetime.fromtimestamp(record.loaded_at, timezone.utc).isoformat())
                         for lease_id, (record, _owner) in self._leases.items())

    def active_lease(self, *, model_id: str, runtime_id: str, profile_id: str | None = None,
                     owner_id: str | None | object = _ANY_LEASE_OWNER) -> ModelLease | None:
        """Return the matching active lease for an internal route invoker."""
        with self._mutation_lock:
            for lease_id, (record, owner) in self._leases.items():
                if (record.model_id == model_id and record.runtime_id == runtime_id
                        and record.profile_id == profile_id
                        and (owner_id is _ANY_LEASE_OWNER or owner == owner_id)):
                    return ModelLease(lease_id, record.model_id, record.profile_id, record.runtime_id,
                                      record.handle,
                                      datetime.fromtimestamp(record.loaded_at, timezone.utc).isoformat())
        return None

    def _adapter(self, runtime_id: str) -> RuntimeAdapter:
        try:
            return self.adapters[runtime_id]
        except KeyError as exc:
            raise SchedulerError(SchedulerErrorCode.RUNTIME_UNAVAILABLE,
                                 f"No adapter registered for runtime {runtime_id}") from exc

    def _emit(self, event_type: str, record: ResidencyRecord, details: str = "") -> None:
        if self.event_callback:
            self.event_callback(SchedulerEvent(event_type, record.model_id, record.runtime_id, details))
