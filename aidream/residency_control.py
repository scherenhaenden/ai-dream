"""Transport-neutral, allowlisted controls for existing model residency.

The controller never discovers routes, accepts caller-supplied model IDs, or
acquires a model. Its route map must be constructed by trusted orchestration
code and is immutable for the lifetime of this instance.
"""
from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
import re
from typing import Any

from aidream.model_scheduler import ModelScheduler, SchedulerError, SchedulerErrorCode

_ROUTE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_ACTIONS = frozenset({"pin", "unpin", "unload"})
ResidentKey = tuple[str, str, str | None]


class ResidencyControlService:
    """Apply pin/unpin/unload to allowlisted orchestration-owned residents."""

    def __init__(self, scheduler: ModelScheduler, *, route_allowlist: Mapping[str, ResidentKey]):
        if not isinstance(scheduler, ModelScheduler):
            raise TypeError("scheduler must be a ModelScheduler")
        if not isinstance(route_allowlist, Mapping) or not route_allowlist:
            raise ValueError("route_allowlist must be a non-empty server-owned mapping")
        clean: dict[str, ResidentKey] = {}
        for route_id, raw_key in route_allowlist.items():
            if not isinstance(route_id, str) or not _ROUTE_ID.fullmatch(route_id):
                raise ValueError("route_allowlist contains an invalid route ID")
            if (not isinstance(raw_key, tuple) or len(raw_key) != 3
                    or not isinstance(raw_key[0], str) or not raw_key[0]
                    or not isinstance(raw_key[1], str) or not raw_key[1]
                    or (raw_key[2] is not None
                        and (not isinstance(raw_key[2], str) or not raw_key[2]))):
                raise ValueError("route_allowlist contains an invalid resident key")
            clean[route_id] = raw_key
        self._scheduler = scheduler
        self._route_allowlist = MappingProxyType(clean)

    @property
    def route_ids(self) -> tuple[str, ...]:
        """Return the public stable route IDs without model paths or handles."""
        return tuple(sorted(self._route_allowlist))

    def apply(self, route_id: str, action: str) -> dict[str, Any]:
        """Apply one semantic action to the mapped existing resident.

        All actions are residency-only: pin/unpin only update scheduler state;
        unload may call adapter.unload, but no action calls scheduler.acquire.
        """
        if not isinstance(route_id, str) or not _ROUTE_ID.fullmatch(route_id):
            raise ValueError("route_id is invalid")
        if not isinstance(action, str) or action not in _ACTIONS:
            raise ValueError("action must be pin, unpin, or unload")
        key = self._route_allowlist.get(route_id)
        if key is None:
            raise SchedulerError(SchedulerErrorCode.NOT_ALLOWED,
                                 "Route is not in the server-owned residency allowlist")
        model_id, runtime_id, profile_id = key
        allowed = frozenset({key})
        if action in {"pin", "unpin"}:
            self._scheduler.set_orchestration_pin(
                model_id, runtime_id, profile_id=profile_id,
                pinned=(action == "pin"), allowed_residents=allowed)
        else:
            self._scheduler.unload_orchestration_resident(
                model_id, runtime_id, profile_id=profile_id,
                allowed_residents=allowed)
        resident = next((record for record in self._scheduler.residency()
                         if (record.model_id, record.runtime_id, record.profile_id) == key), None)
        return {
            "route_id": route_id,
            "action": action,
            "resident": self._summary(resident) if resident is not None else None,
        }

    @staticmethod
    def _summary(record) -> dict[str, Any]:
        return {
            "model_id": record.model_id,
            "runtime_id": record.runtime_id,
            "profile_id": record.profile_id,
            "state": record.state,
            "pinned": record.pinned,
            "lease_count": record.lease_count,
            "orchestration_owned": record.orchestration_owned,
        }


__all__ = ["ResidencyControlService"]
