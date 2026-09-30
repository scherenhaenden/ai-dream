"""Semantic resource and residency payloads from observable local state.

This module prepares values suitable for the resource API without owning HTTP
routes. Unavailable host measurements are serialized as ``None`` with an
explicit unknown status, never as invented zero values.
"""
from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any, Callable, Mapping

from aidream.hardware import HardwareService
from aidream.model_scheduler import ModelScheduler, ResidencyRecord


def _value(source: Any, name: str, default: Any = None) -> Any:
    if isinstance(source, Mapping):
        return source.get(name, default)
    return getattr(source, name, default)


def _metric(value: Any, *, source: str) -> dict[str, Any]:
    valid = isinstance(value, int) and not isinstance(value, bool) and value >= 0
    return {"value_bytes": value if valid else None,
            "status": "observed" if valid else "unknown",
            "source": source if valid else None}


def _record_payload(record: ResidencyRecord, now: float) -> dict[str, Any]:
    estimated_ram = _metric(record.estimated_ram_bytes, source="scheduler_estimate")
    estimated_vram = _metric(record.estimated_vram_bytes, source="scheduler_estimate")
    return {
        "model_id": record.model_id,
        "profile_id": record.profile_id,
        "runtime_id": record.runtime_id,
        "state": record.state,
        "lease_count": record.lease_count,
        "pinned": record.pinned,
        "loaded_for_seconds": max(0.0, now - record.loaded_at),
        "idle_for_seconds": max(0.0, now - record.last_used_at) if record.state == "idle" else None,
        "estimated_ram_bytes": estimated_ram["value_bytes"],
        "estimated_ram_status": estimated_ram["status"],
        "estimated_vram_bytes": estimated_vram["value_bytes"],
        "estimated_vram_status": estimated_vram["status"],
    }


@dataclass
class ResourceSnapshotService:
    """Combine injectable hardware observations with scheduler residency."""

    scheduler: ModelScheduler
    hardware: Any = None
    now: Callable[[], float] = time.monotonic

    def __post_init__(self) -> None:
        if self.hardware is None:
            self.hardware = HardwareService()

    def _detect_hardware(self) -> Any:
        detector = getattr(self.hardware, "detect", None)
        if callable(detector):
            return detector()
        if callable(self.hardware):
            return self.hardware()
        return self.hardware

    def residency(self) -> dict[str, Any]:
        records = self.scheduler.residency()
        entries = [_record_payload(record, self.now()) for record in records]
        lease_count = sum(record.lease_count for record in records)
        return {
            "items": entries,
            "count": len(entries),
            "active_lease_count": lease_count,
            "status": "observed",
            "source": "model_scheduler",
        }

    def resources(self) -> dict[str, Any]:
        hardware_error = None
        try:
            host = self._detect_hardware()
        except Exception as exc:
            host = None
            # Diagnostic is bounded and avoids leaking tracebacks to API clients.
            hardware_error = f"Hardware probe failed: {type(exc).__name__}"

        ram = _value(host, "ram") if host is not None else None
        ram_total = _metric(_value(ram, "total_bytes"), source="host_hardware_probe")
        ram_available = _metric(_value(ram, "available_bytes"), source="host_hardware_probe")
        ram_observed_count = sum(metric["status"] == "observed" for metric in (ram_total, ram_available))
        ram_status = "observed" if ram_observed_count == 2 else "partial" if ram_observed_count else "unknown"

        gpu_entries = []
        for gpu in (_value(host, "gpus", []) or []):
            index = _value(gpu, "index")
            identity = f"gpu-{index}" if isinstance(index, int) and not isinstance(index, bool) else None
            total = _metric(_value(gpu, "memory_total_bytes"), source="host_hardware_probe")
            free = _metric(_value(gpu, "memory_free_bytes"), source="host_hardware_probe")
            gpu_observed_count = sum(metric["status"] == "observed" for metric in (total, free))
            gpu_status = "observed" if gpu_observed_count == 2 else "partial" if gpu_observed_count else "unknown"
            gpu_entries.append({
                "id": identity,
                "index": index if isinstance(index, int) and not isinstance(index, bool) else None,
                "name": _value(gpu, "name"),
                "vendor": _value(gpu, "vendor"),
                "backends": list(_value(gpu, "backends", []) or []),
                "runtime_device_mappings": {"status": "unknown", "items": []},
                "total_vram_bytes": total["value_bytes"],
                "total_vram_status": total["status"],
                "free_vram_bytes": free["value_bytes"],
                "free_vram_status": free["status"],
                "metrics_status": gpu_status,
            })

        residency = self.residency()
        loaded_models = residency["items"]
        cpu = _value(host, "cpu") if host is not None else None
        cpu_logical = _value(cpu, "logical_cores")
        cpu_physical = _value(cpu, "physical_cores")
        any_observed = (ram_observed_count > 0
                        or any(item["metrics_status"] != "unknown" for item in gpu_entries))
        all_observed = (ram_status == "observed"
                        and all(item["metrics_status"] == "observed" for item in gpu_entries))
        hardware_status = ("unknown" if not any_observed else
                           "observed" if all_observed else "partial")
        return {
            "resources": {
                "ram": {
                    "total_bytes": ram_total["value_bytes"],
                    "total_status": ram_total["status"],
                    "available_bytes": ram_available["value_bytes"],
                    "available_status": ram_available["status"],
                    "metrics_status": ram_status,
                },
                "gpus": gpu_entries,
                "loaded_models": loaded_models,
                "pending_reservations": [],
                "pending_reservations_status": "not_supported",
                "active_lease_count": residency["active_lease_count"],
                "cpu": {
                    "logical_cores": cpu_logical if isinstance(cpu_logical, int) else None,
                    "physical_cores": cpu_physical if isinstance(cpu_physical, int) else None,
                    "active_threads": None,
                    "thread_pressure_status": "unknown",
                },
                "temporary_disk": {"available_bytes": None, "status": "unknown"},
            },
            "status": hardware_status,
            "hardware_error": hardware_error,
        }
