"""Deterministic, capability-aware skill planning and execution service.

Planning is read-only: it type-checks a whole skill, resolves all declared
capability/model nodes against typed declarations and route snapshots, and
returns a stable plan with selection explanations. Execution is a separate
operation; it requires explicit route invokers and a model scheduler, acquires
one lease per sequential node, and releases leases even on failure. This layer
does not discover real routes or invoke model/runtime code by itself.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
import threading
from collections.abc import Mapping, Sequence
from typing import Any, Callable

from aidream.artifacts.contracts import ARTIFACT_KINDS
from aidream.capabilities.contracts import ArtifactKind, ArtifactType, EvidenceStatus
from aidream.capabilities.preferences import CapabilityPreferenceStore
from aidream.capabilities.registry import CapabilityRegistry, artifact_types_compatible
from aidream.capabilities.resolver import ResolutionRequest, RouteCandidate, resolve_route
from aidream.model_scheduler import LeaseRequest, ModelScheduler
from aidream.run_manager import RunCancelled
from aidream.skills import FallbackCallback, SkillContractError, SkillExecutor, SkillRegistry


class PlanResolutionError(RuntimeError):
    """One or more required skill nodes have no compatible available route."""

    def __init__(self, message: str, *, why: Sequence[Mapping[str, Any]] = ()) -> None:
        super().__init__(message)
        self.why = tuple(dict(item) for item in why)


class PlanDraftError(ValueError):
    """An assisted-planner draft does not describe an installed static skill."""


@dataclass(frozen=True)
class ResolvedNode:
    node_id: str
    node_type: str
    capability_id: str
    route: RouteCandidate
    alternatives: tuple[RouteCandidate, ...]
    why: tuple[Mapping[str, Any], ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "node_type": self.node_type,
            "capability_id": self.capability_id,
            "selected": _route_summary(self.route),
            "alternatives": [_route_summary(route) for route in self.alternatives],
            "why": [dict(item) for item in self.why],
        }


@dataclass(frozen=True)
class ExecutionPlan:
    plan_id: str
    skill_id: str
    skill_version: str
    mode: str
    resolved_nodes: tuple[ResolvedNode, ...]
    input_kinds: Mapping[str, str]
    manifest: Mapping[str, Any]
    resource_budget: Mapping[str, int]
    nested_skill_fingerprints: tuple[tuple[str, str, str, str], ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "skill": {"id": self.skill_id, "version": self.skill_version},
            "mode": self.mode,
            "input_kinds": dict(self.input_kinds),
            "resource_budget": dict(self.resource_budget),
            "nodes": [node.to_dict() for node in self.resolved_nodes],
        }


RouteInvoker = Callable[[RouteCandidate, Mapping[str, Any], Mapping[str, Any]], Mapping[str, Any]]


def _route_summary(route: RouteCandidate) -> dict[str, Any]:
    result = {"id": route.id, "capability_id": route.capability_id,
              "model_id": route.model_id, "profile_id": route.profile_id,
              "runtime_id": route.runtime_id}
    if route.required_memory_bytes is not None:
        result["estimated_vram_bytes"] = route.required_memory_bytes
    if route.available_memory_bytes is not None:
        result["available_vram_bytes"] = route.available_memory_bytes
    return result


def _artifact_type(kind: str) -> ArtifactType:
    if kind not in ARTIFACT_KINDS:
        raise SkillContractError(f"unsupported artifact kind {kind!r}")
    return ArtifactType(ArtifactKind(kind))


class OrchestrationService:
    """Plan skills from injected snapshots, then execute through explicit adapters."""

    def __init__(self, *, skills: SkillRegistry, executor: SkillExecutor,
                 capabilities: CapabilityRegistry, routes: Sequence[RouteCandidate],
                 preferences: CapabilityPreferenceStore,
                 scheduler: ModelScheduler | None = None,
                 route_invokers: Mapping[str, RouteInvoker] | None = None,
                 assisted_planner_enabled: bool = False) -> None:
        self.skills = skills
        self.executor = executor
        self.capabilities = capabilities
        self.routes = tuple(routes)
        if any(not isinstance(route, RouteCandidate) for route in self.routes):
            raise TypeError("routes must contain RouteCandidate values")
        if len({route.id for route in self.routes}) != len(self.routes):
            raise ValueError("route candidate IDs must be unique")
        self.preferences = preferences
        self.scheduler = scheduler
        self.route_invokers = dict(route_invokers or {})
        if not isinstance(assisted_planner_enabled, bool):
            raise ValueError("assisted_planner_enabled must be a boolean")
        self.assisted_planner_enabled = assisted_planner_enabled

    def draft_components(self, skill_id: str) -> list[dict[str, str]]:
        """Return the validated routable components, including nested skill nodes.

        Node ids use the same stable slash-separated paths as plan resolution,
        so an assisted planner can describe a nested component without
        inventing a root-level node id.
        """
        manifest = self.skills.get(skill_id)
        if manifest is None:
            raise PlanDraftError(f"draft names uninstalled skill {skill_id!r}")
        return [
            {
                "node_id": path,
                "component_id": node["capability"] if node["type"] == "capability" else node["operation"],
            }
            for path, node, _inputs, _graph in self._route_nodes(manifest)
        ]

    def resolve_assisted_draft(self, draft: Mapping[str, Any], inputs: Mapping[str, Any], *,
                               mode: str | None = None,
                               capability_pins: Mapping[str, Mapping[str, str]] | None = None) -> ExecutionPlan:
        """Validate a draft against one installed skill, then run deterministic planning.

        This method never invokes an LLM or executes a node. Drafts may select
        an installed skill but cannot add tools, components, permissions, or
        graph edges; route choices are resolved by ``build_plan``.
        """
        if not self.assisted_planner_enabled:
            raise PlanDraftError("assisted planner is disabled")
        if not isinstance(draft, Mapping):
            raise PlanDraftError("draft must be an object")
        unknown = set(draft) - {"skill_id", "components"}
        missing = {"skill_id", "components"} - set(draft)
        if unknown:
            raise PlanDraftError("draft contains unsupported field(s): " + ", ".join(sorted(map(str, unknown))))
        if missing:
            raise PlanDraftError("draft is missing field(s): " + ", ".join(sorted(missing)))
        skill_id = draft.get("skill_id")
        if not isinstance(skill_id, str) or not skill_id:
            raise PlanDraftError("draft.skill_id must name an installed skill")
        manifest = self.skills.get(skill_id)
        if manifest is None:
            raise PlanDraftError(f"draft names uninstalled skill {skill_id!r}")
        expected = {item["node_id"]: item["component_id"] for item in self.draft_components(skill_id)}
        raw_components = draft.get("components")
        if not isinstance(raw_components, list):
            raise PlanDraftError("draft.components must be a list")
        supplied: dict[str, str] = {}
        for index, item in enumerate(raw_components):
            if not isinstance(item, Mapping) or set(item) != {"node_id", "component_id"}:
                raise PlanDraftError(f"draft.components[{index}] must contain only node_id and component_id")
            node_id, component_id = item.get("node_id"), item.get("component_id")
            if not isinstance(node_id, str) or not isinstance(component_id, str):
                raise PlanDraftError(f"draft.components[{index}] identifiers must be strings")
            if node_id in supplied:
                raise PlanDraftError(f"draft repeats component node {node_id!r}")
            supplied[node_id] = component_id
        if supplied != expected:
            unknown_nodes = sorted(set(supplied) - set(expected))
            missing_nodes = sorted(set(expected) - set(supplied))
            mismatched = sorted(node_id for node_id in set(expected) & set(supplied)
                                if supplied[node_id] != expected[node_id])
            raise PlanDraftError(
                f"draft components do not match the installed skill (unknown={unknown_nodes}, "
                f"missing={missing_nodes}, mismatched={mismatched})"
            )
        return self.build_plan(skill_id, inputs, mode=mode, capability_pins=capability_pins)

    def build_plan(self, skill_id: str, inputs: Mapping[str, Any], *, mode: str | None = None,
                   pinned_model_id: str | None = None, pinned_profile_id: str | None = None,
                   capability_pins: Mapping[str, Mapping[str, str]] | None = None) -> ExecutionPlan:
        """Type-check first, then resolve every static model/capability node."""
        manifest = self.skills.get(skill_id)
        if manifest is None:
            raise PlanResolutionError(f"skill {skill_id!r} is not installed")

        # Validate graph and supplied artifact kinds before resolution and before
        # any scheduler/capability callback can run.
        clean = self.executor.type_check(manifest)
        input_kinds = self._validate_inputs(clean, inputs)
        preference_snapshot = self.preferences.get()
        defaults = preference_snapshot["selection_defaults"]
        chosen_mode = mode or defaults["mode"]
        if chosen_mode not in {"auto", "guided", "manual"}:
            raise ValueError("mode must be auto, guided, or manual")
        if capability_pins is None:
            capability_pins = {}
        if not isinstance(capability_pins, Mapping) or len(capability_pins) > 32:
            raise ValueError("capability_pins must be a bounded object")
        clean_capability_pins: dict[str, dict[str, str]] = {}
        for capability_id, pin in capability_pins.items():
            from aidream.capabilities.contracts import validate_capability_id
            try:
                clean_id = validate_capability_id(capability_id)
            except (TypeError, ValueError) as exc:
                raise ValueError("capability_pins contains an invalid capability ID") from exc
            if not isinstance(pin, Mapping) or set(pin) - {"model_id", "profile_id"} or not pin:
                raise ValueError(f"capability_pins.{clean_id} must select model_id or profile_id")
            clean_pin = {}
            if "model_id" in pin:
                model_id = pin["model_id"]
                if (not isinstance(model_id, str) or len(model_id) > 256
                        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,255}", model_id)):
                    raise ValueError(f"capability_pins.{clean_id}.model_id is invalid")
                clean_pin["model_id"] = model_id
            if "profile_id" in pin:
                profile_id = pin["profile_id"]
                if not isinstance(profile_id, str) or len(profile_id) != 32 or any(char not in "0123456789abcdef" for char in profile_id):
                    raise ValueError(f"capability_pins.{clean_id}.profile_id is invalid")
                clean_pin["profile_id"] = profile_id
            clean_capability_pins[clean_id] = clean_pin
        resolved_nodes: list[ResolvedNode] = []
        failures: list[dict[str, Any]] = []

        for node_path, node, declared_inputs, graph_by_id in self._route_nodes(clean):
            node_type = node["type"]
            capability_id = node["capability"] if node_type == "capability" else node["operation"]
            incoming = self._incoming_types(node, declared_inputs, graph_by_id)
            outgoing = tuple(_artifact_type(kind) for kind in node.get("out", {}).values())
            if not incoming:
                failures.append({"node_id": node_path, "capability_id": capability_id,
                                 "reason": "no_typed_input", "routes": []})
                continue
            declarations = self.capabilities.find_by_id(capability_id)
            declarations = tuple(
                declaration for declaration in declarations
                if declaration.evidence.status != EvidenceStatus.FAILED
                if all(any(artifact_types_compatible(actual, accepted) for accepted in declaration.inputs)
                       for actual in incoming)
                and all(any(artifact_types_compatible(actual, produced) for produced in declaration.outputs)
                        for actual in outgoing)
            )
            if not declarations:
                failures.append({"node_id": node_path, "capability_id": capability_id,
                                 "reason": "capability_not_declared_for_typed_io", "routes": []})
                continue
            pin_model, pin_profile, prefer_model, prefer_profile = self._preferences(
                capability_id, node, preference_snapshot)
            explicit_pin = clean_capability_pins.get(capability_id)
            if explicit_pin:
                pin_model = explicit_pin.get("model_id", pin_model)
                pin_profile = explicit_pin.get("profile_id", pin_profile)
            # Request-level chat selection is a hard, one-run pin. It does not
            # mutate the user's persistent capability preferences.
            if capability_id in {"text.chat", "text.generate"}:
                pin_model = pinned_model_id or pin_model
                pin_profile = pinned_profile_id or pin_profile
                prefer_model = pin_model or prefer_model
                prefer_profile = pin_profile or prefer_profile
            if chosen_mode == "manual" and not pin_model:
                # In manual mode a saved per-capability choice becomes a hard pin.
                pin_model = prefer_model
            if chosen_mode == "manual" and not pin_model:
                failures.append({"node_id": node_path, "capability_id": capability_id,
                                 "reason": "manual_mode_requires_model_pin", "routes": []})
                continue
            request = ResolutionRequest(
                capability_id=capability_id,
                input=incoming[0],
                output=outgoing[0] if outgoing else None,
                required_features=frozenset(node.get("select", {}).get("required_features", ())),
                mode="manual" if pin_model else chosen_mode,
                pinned_model_id=pin_model,
                preferred_model_id=prefer_model,
                preferred_profile_id=prefer_profile,
                prefer_verified=defaults["prefer_verified"],
                prefer_loaded=defaults["prefer_loaded"],
                resource_headroom_percent=defaults["resource_headroom_percent"],
            )
            capability_routes = tuple(route for route in self.routes if route.capability_id == capability_id)
            compatible_routes: list[RouteCandidate] = []
            prefilter_why: list[dict[str, Any]] = []
            for route in capability_routes:
                reasons: list[str] = []
                if route.evidence_status == EvidenceStatus.FAILED.value:
                    reasons.append("capability_evidence_failed")
                if pin_profile and route.profile_id != pin_profile:
                    reasons.append("not_pinned_profile")
                if not all(any(artifact_types_compatible(actual, accepted) for accepted in route.inputs)
                           for actual in incoming):
                    reasons.append("input_type_mismatch")
                if not all(any(artifact_types_compatible(actual, produced) for produced in route.outputs)
                           for actual in outgoing):
                    reasons.append("output_type_mismatch")
                if reasons:
                    prefilter_why.append({"route_id": route.id, "eligible": False, "reasons": reasons})
                else:
                    compatible_routes.append(route)
            resolution = resolve_route(request, compatible_routes)
            route_why = tuple(sorted((*prefilter_why, *[dict(item) for item in resolution.why]),
                                     key=lambda item: (str(item.get("route_id", "")),
                                                       tuple(item.get("reasons", ())))))
            if resolution.selected is None:
                failures.append({"node_id": node_path, "capability_id": capability_id,
                                 "reason": "no_compatible_available_route",
                                 "routes": [dict(item) for item in route_why]})
                continue
            selected = resolution.selected
            why = route_why
            resolved_nodes.append(ResolvedNode(node_path, node_type, capability_id,
                                               selected, resolution.alternatives, why))

        if failures:
            raise PlanResolutionError("skill has unresolved required capability/model nodes", why=failures)
        resource_budget = {"max_parallel_routes": clean.get("policy", {}).get("max_parallel_nodes", 1)}
        nested_skill_fingerprints = self._nested_skill_fingerprints(clean)
        digest_data = {
            "skill": [clean["id"], clean["version"]], "mode": chosen_mode,
            "inputs": input_kinds,
            "workflow": {"graph": clean["graph"], "policy": clean.get("policy", {}),
                         "permissions": clean["permissions"]},
            "preferences": preference_snapshot,
            "routes": [item.to_dict() for item in resolved_nodes],
            "resource_budget": resource_budget,
            "nested_skills": nested_skill_fingerprints,
        }
        plan_id = hashlib.sha256(json.dumps(digest_data, sort_keys=True, separators=(",", ":"),
                                  ensure_ascii=True).encode()).hexdigest()[:24]
        return ExecutionPlan(plan_id, clean["id"], clean["version"], chosen_mode,
                             tuple(resolved_nodes), dict(input_kinds), clean, resource_budget,
                             nested_skill_fingerprints)

    @staticmethod
    def _validate_inputs(manifest: Mapping[str, Any], inputs: Mapping[str, Any]) -> dict[str, str]:
        if not isinstance(inputs, Mapping):
            raise SkillContractError("inputs: expected an object")
        ports = {item["name"]: item for item in manifest["inputs"]}
        extras = set(inputs) - set(ports)
        if extras:
            raise SkillContractError("inputs: undeclared field(s): " + ", ".join(sorted(map(str, extras))))
        result: dict[str, str] = {}
        for name, port in ports.items():
            if name not in inputs:
                if port.get("required", False):
                    raise SkillContractError(f"inputs.{name}: required input is missing")
                continue
            artifact = inputs[name]
            if not isinstance(artifact, Mapping) or artifact.get("kind") != port["artifact"]:
                raise SkillContractError(f"inputs.{name}: expected artifact kind {port['artifact']!r}")
            result[name] = str(port["artifact"])
        return dict(sorted(result.items()))

    def _route_nodes(self, manifest: Mapping[str, Any], prefix: str = ""):
        """Yield every routable node, including nodes inside validated sub-skills.

        The path is stable within a plan and identifies a nested node even when
        the same child skill is called more than once.
        """
        graph = manifest["graph"]
        graph_by_id = {node["id"]: node for node in graph}
        input_kinds = {item["name"]: item["artifact"] for item in manifest["inputs"]}
        for node in graph:
            node_path = f"{prefix}{node['id']}"
            if node["type"] in {"capability", "model"}:
                yield node_path, node, input_kinds, graph_by_id
            elif node["type"] == "skill":
                child = self.skills.get(node["skill_id"], node.get("skill_version"))
                if child is None:
                    raise PlanResolutionError(f"nested skill {node['skill_id']!r} is no longer installed")
                yield from self._route_nodes(child, f"{node_path}/")

    def _nested_skill_fingerprints(self, manifest: Mapping[str, Any], prefix: str = ""):
        fingerprints = []
        for node in manifest["graph"]:
            if node["type"] != "skill":
                continue
            path = f"{prefix}{node['id']}"
            child = self.skills.get(node["skill_id"], node.get("skill_version"))
            if child is None:
                raise PlanResolutionError(f"nested skill {node['skill_id']!r} is no longer installed")
            payload = json.dumps(child, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
            fingerprints.append((path, child["id"], child["version"], hashlib.sha256(payload.encode()).hexdigest()))
            fingerprints.extend(self._nested_skill_fingerprints(child, f"{path}/"))
        return tuple(fingerprints)

    @staticmethod
    def _incoming_types(node: Mapping[str, Any], input_types: Mapping[str, str],
                        graph_by_id: Mapping[str, Mapping[str, Any]]) -> tuple[ArtifactType, ...]:
        kinds: list[str] = []
        for value in node.get("in", {}).values():
            if not isinstance(value, str):
                continue
            if value.startswith("$input."):
                kind = input_types.get(value[len("$input."):])
            elif value.startswith("$"):
                ref = value[1:].split(".", 1)
                source = graph_by_id.get(ref[0]) if len(ref) == 2 else None
                kind = source.get("out", {}).get(ref[1]) if source else None
            else:
                continue
            if isinstance(kind, str):
                kinds.append(kind)
        return tuple(_artifact_type(kind) for kind in kinds)

    @staticmethod
    def _preferences(capability_id: str, node: Mapping[str, Any], snapshot: Mapping[str, Any]
                     ) -> tuple[str | None, str | None, str | None, str | None]:
        saved = snapshot.get("capability_preferences", {}).get(capability_id, {})
        select = node.get("select", {}) if isinstance(node.get("select", {}), Mapping) else {}
        pin_model = node.get("model_id") if node.get("type") == "model" else select.get("pinned_model_id")
        pin_profile = node.get("profile_id") if node.get("type") == "model" else select.get("pinned_profile_id")
        # Explicit model node / pin always wins as a hard constraint.
        prefer_model = pin_model or select.get("model_id") or saved.get("model_id")
        prefer_profile = pin_profile or select.get("profile_id") or saved.get("profile_id")
        return pin_model, pin_profile, prefer_model, prefer_profile

    def execute(self, plan: ExecutionPlan, inputs: Mapping[str, Any], *, owner_id: str | None = None,
                event_callback: Callable[[str, str], None] | None = None,
                fallback_callback: FallbackCallback | None = None,
                cancel_event: threading.Event | None = None) -> dict[str, Any]:
        """Execute a previously resolved plan after rechecking it before leases."""
        current = self.skills.get(plan.skill_id, plan.skill_version)
        if current is None:
            raise PlanResolutionError("planned skill version is no longer installed")
        self.executor.type_check(current)
        self._validate_inputs(current, inputs)
        if plan.nested_skill_fingerprints != self._nested_skill_fingerprints(current):
            raise PlanResolutionError("nested skill definitions changed after this plan was resolved")
        route_by_node = {node.node_id: node.route for node in plan.resolved_nodes}
        graph_capability_nodes = {path for path, _node, _inputs, _graph in self._route_nodes(current)}
        if set(route_by_node) != graph_capability_nodes:
            raise PlanResolutionError("plan does not resolve every capability/model node")
        missing_invokers = sorted({route.id for route in route_by_node.values()} - set(self.route_invokers))
        if missing_invokers:
            raise PlanResolutionError("missing route invoker(s): " + ", ".join(missing_invokers))
        if route_by_node and self.scheduler is None:
            raise PlanResolutionError("model scheduler is required before executing resolved model routes")
        known_routes = {route.id: route for route in self.routes}
        for node_id, route in route_by_node.items():
            if not route.available or known_routes.get(route.id) != route:
                raise PlanResolutionError(f"resolved route for node {node_id!r} is no longer available")
            if not isinstance(route.metadata, Mapping) or route.metadata.get("manifest") is None:
                raise PlanResolutionError(f"selected route {route.id!r} has no scheduler manifest")

        callbacks: dict[str, Callable[..., Mapping[str, Any]]] = {}
        model_callbacks: dict[str, Callable[..., Mapping[str, Any]]] = {}
        held_leases: dict[str, Any] = {}
        try:
            max_parallel_routes = plan.resource_budget["max_parallel_routes"]
        except (AttributeError, KeyError, TypeError) as exc:
            raise PlanResolutionError("plan has no bounded route resource budget") from exc
        if isinstance(max_parallel_routes, bool) or not isinstance(max_parallel_routes, int) or not 1 <= max_parallel_routes <= 64:
            raise PlanResolutionError("plan route resource budget must be between 1 and 64")
        current_route_budget = current.get("policy", {}).get("max_parallel_nodes", 1)
        if max_parallel_routes != current_route_budget:
            raise PlanResolutionError("planned route resource budget no longer matches the installed skill")
        route_slots = threading.BoundedSemaphore(max_parallel_routes)
        held_route_slots: dict[str, int] = {}

        def reserve_layer(node_ids: tuple[str, ...]) -> None:
            routed = [(node_id, route_by_node[node_id]) for node_id in node_ids if node_id in route_by_node]
            if not routed:
                return
            if len(routed) > max_parallel_routes:
                raise PlanResolutionError("route layer exceeds the inherited concurrency budget")
            if self.scheduler is None:
                raise PlanResolutionError("model scheduler is required before reserving parallel routes")
            acquired_slots = 0
            try:
                for _node_id, _route in routed:
                    while not route_slots.acquire(timeout=0.05):
                        if cancel_event is not None and cancel_event.is_set():
                            raise RunCancelled("run cancelled while waiting for route capacity")
                    acquired_slots += 1
                if cancel_event is not None and cancel_event.is_set():
                    raise RunCancelled("run cancelled before route reservation")
            except Exception:
                for _ in range(acquired_slots):
                    route_slots.release()
                raise
            same_route_counts: dict[tuple[str, str, str | None], int] = {}
            for _, route in routed:
                key = (route.model_id, route.runtime_id, route.profile_id)
                same_route_counts[key] = same_route_counts.get(key, 0) + 1
            requests = [LeaseRequest(
                model_id=route.model_id, runtime_id=route.runtime_id,
                manifest=route.metadata["manifest"], profile=route.metadata.get("profile"),
                estimated_ram_bytes=route.metadata.get("estimated_ram_bytes"),
                estimated_vram_bytes=route.metadata.get("estimated_vram_bytes"),
                owner_id=owner_id or plan.plan_id, orchestration_owned=True,
                allow_concurrent=same_route_counts[(route.model_id, route.runtime_id, route.profile_id)] > 1,
            ) for _, route in routed]
            acquire_many = getattr(self.scheduler, "acquire_many", None)
            leases_list = []
            try:
                if callable(acquire_many):
                    leases = tuple(acquire_many(requests))
                else:
                    for request in requests:
                        leases_list.append(self.scheduler.acquire(request))
                    leases = tuple(leases_list)
            except Exception:
                for lease in reversed(leases_list):
                    self.scheduler.release(lease)
                for _ in range(acquired_slots):
                    route_slots.release()
                raise
            if len(leases) != len(routed):
                for lease in reversed(leases):
                    self.scheduler.release(lease)
                for _ in range(acquired_slots):
                    route_slots.release()
                raise PlanResolutionError("scheduler returned an incomplete parallel lease reservation")
            held_leases.update({node_id: lease for (node_id, _), lease in zip(routed, leases)})
            held_route_slots.update({node_id: 1 for node_id, _route in routed})

        def release_layer(node_ids: tuple[str, ...]) -> None:
            if self.scheduler is None:
                return
            failures: list[Exception] = []
            for node_id in reversed(node_ids):
                lease = held_leases.pop(node_id, None)
                if lease is not None:
                    try:
                        self.scheduler.release(lease)
                    except Exception as exc:
                        failures.append(exc)
                slots = held_route_slots.pop(node_id, 0)
                for _ in range(slots):
                    route_slots.release()
            if failures:
                raise PlanResolutionError("could not release every parallel route lease") from failures[0]

        for _path, node, _inputs, _graph in self._route_nodes(current):
            capability_id = node["capability"] if node["type"] == "capability" else node["operation"]
            def invoke(_node: Mapping[str, Any], node_inputs: Mapping[str, Any]) -> Mapping[str, Any]:
                path = _node.get("_orchestration_path", _node["id"])
                route = route_by_node[path]
                if path not in held_leases:
                    raise PlanResolutionError(f"route node {path!r} started without a reserved lease")
                return self.route_invokers[route.id](route, _node, node_inputs)

            if node["type"] == "capability":
                callbacks[capability_id] = invoke
            else:
                model_callbacks[node["model_id"]] = invoke
        execution = self.executor.with_capability_executors(
            capabilities=callbacks, models=model_callbacks,
        )
        return execution.execute(current, inputs, event_callback=event_callback,
                                fallback_callback=fallback_callback,
                                cancel_event=cancel_event,
                                _max_parallel_nodes_limit=max_parallel_routes,
                                plan_revision=plan.plan_id,
                                layer_start_callback=reserve_layer,
                                layer_end_callback=release_layer)


__all__ = ["ExecutionPlan", "OrchestrationService", "PlanDraftError", "PlanResolutionError", "ResolvedNode"]
