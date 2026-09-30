"""Small deterministic executor for the initial declarative workflow nodes.

Executors are explicitly registered by node type/name. No imports, shell, or
arbitrary code are resolved from manifests. The complete graph is statically
type-checked before any executor is called. A `parallel` node is an explicit
static fan-in barrier: `in` maps distinct branch names to typed node-output
references, `accepts` declares each artifact kind, and `out` republishes the
same names and kinds. Independent upstream nodes execute in stable topological
layers, bounded by `policy.max_parallel_nodes`; the barrier itself is a
deterministic pass-through. Bounded typed sub-skills inherit permissions,
resource limits and cancellation state. Nested model/capability calls are
identified by their skill-node path so the orchestration planner can resolve
and reserve their routes before invocation.
"""
from __future__ import annotations

import re
import hashlib
import json
import threading
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from collections.abc import Callable, Mapping
from typing import Any

from ..artifacts.contracts import ARTIFACT_KINDS
from ..run_manager import RunCancelled
from .contracts import SkillContractError, validate_skill_manifest

SUPPORTED_NODE_TYPES = frozenset({"input", "capability", "model", "tool", "transform", "router", "parallel", "join", "loop", "fallback", "skill", "output"})
_REFERENCE = re.compile(r"^\$([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$")
NodeExecutor = Callable[[Mapping[str, Any], Mapping[str, Any]], Mapping[str, Any]]
MAX_SUBSKILL_DEPTH = 4
_PERMISSION_GRANTS = {
    "filesystem_read": {"none": frozenset(), "user-selected-only": frozenset({"read-selected"}),
                        "scoped-paths": frozenset({"read-selected", "read-scoped"})},
    "filesystem_write": {"none": frozenset(), "user-approved-output": frozenset({"write-approved"}),
                         "scoped-paths": frozenset({"write-approved", "write-scoped"})},
    "network": {"none": frozenset(), "specific-hosts": frozenset({"network-specific"}),
                "unrestricted": frozenset({"network-specific", "network-any"})},
    "shell": {"none": frozenset(), "registered-command-only": frozenset({"registered-command"})},
    "browser_control": {"none": frozenset(), "allowed": frozenset({"browser"})},
    "computer_control": {"none": frozenset(), "allowed": frozenset({"computer"})},
    "desktop_control": {"none": frozenset(), "allowed": frozenset({"desktop"})},
    "microphone": {"none": frozenset(), "allowed": frozenset({"microphone"})},
    "camera": {"none": frozenset(), "allowed": frozenset({"camera"})},
    "clipboard": {"none": frozenset(), "read": frozenset({"clipboard-read"}),
                  "write": frozenset({"clipboard-write"}),
                  "read-write": frozenset({"clipboard-read", "clipboard-write"})},
}


@dataclass(frozen=True)
class FallbackTrace:
    """Sanitized bridge event for a deterministic fallback plan revision."""

    event_type: str
    node_id: str
    base_plan_revision: str
    revision_id: str | None
    attempted_candidates: tuple[str, ...]
    selected_candidate: str | None
    failure_kinds: tuple[str, ...]


FallbackCallback = Callable[[FallbackTrace], None]


class SkillExecutionError(RuntimeError):
    """A validated skill could not be executed with the registered handlers."""


class FallbackExhaustedError(SkillExecutionError):
    """All declared fallback candidates failed; carries a sanitized trace event."""

    def __init__(self, trace: FallbackTrace) -> None:
        super().__init__(f"all fallback candidates failed for node {trace.node_id!r}")
        self.trace = trace


class SkillExecutor:
    """Run a typed DAG with bounded independent branches and registered callbacks."""

    def __init__(self, *, capabilities: Mapping[str, NodeExecutor] | None = None,
                 models: Mapping[str, NodeExecutor] | None = None,
                 tools: Mapping[str, NodeExecutor] | None = None,
                 transforms: Mapping[str, NodeExecutor] | None = None,
                 routers: Mapping[str, NodeExecutor] | None = None,
                 subskills: Mapping[str, Mapping[str, Any]] | None = None) -> None:
        self._executors = {
            "capability": dict(capabilities or {}), "model": dict(models or {}),
            "tool": dict(tools or {}), "transform": dict(transforms or {}),
            "router": dict(routers or {}),
        }
        self._subskills = {key: dict(value) for key, value in (subskills or {}).items()}

    def with_capability_executors(self, *, capabilities: Mapping[str, NodeExecutor],
                                  models: Mapping[str, NodeExecutor] | None = None) -> "SkillExecutor":
        """Return an executor with route-bound handlers and the same local registries."""
        return SkillExecutor(
            capabilities=capabilities,
            models=models if models is not None else capabilities,
            tools=self._executors["tool"],
            transforms=self._executors["transform"],
            routers=self._executors["router"],
            subskills=self._subskills,
        )

    def type_check(self, manifest: Mapping[str, Any]) -> dict[str, Any]:
        """Validate every graph edge and artifact kind before side effects."""
        return self._type_check(manifest, stack=())

    def _type_check(self, manifest: Mapping[str, Any], *, stack: tuple[str, ...]) -> dict[str, Any]:
        raw_graph = manifest.get("graph") if isinstance(manifest, Mapping) else None
        if isinstance(raw_graph, list):
            for raw_node in raw_graph:
                if isinstance(raw_node, Mapping) and raw_node.get("type") not in SUPPORTED_NODE_TYPES:
                    raise SkillContractError(f"graph.{raw_node.get('id', '?')}: node type {raw_node.get('type')!r} is not supported by this executor")
        skill = validate_skill_manifest(manifest)
        graph = skill["graph"]
        skill_key = skill["id"]
        if skill_key in stack:
            raise SkillContractError(f"graph: sub-skill cycle includes {skill_key!r}")
        if len(stack) > MAX_SUBSKILL_DEPTH:
            raise SkillContractError(f"graph: sub-skill nesting exceeds depth {MAX_SUBSKILL_DEPTH}")
        for node in graph:
            if node["type"] not in SUPPORTED_NODE_TYPES:
                raise SkillContractError(f"graph.{node['id']}: node type {node['type']!r} is not supported by this executor")
        input_types = {port["name"]: port["artifact"] for port in skill["inputs"]}
        declared: dict[str, dict[str, str]] = {}
        by_id = {node["id"]: node for node in graph}
        for node in graph:
            node_type = node["type"]
            if node_type == "input":
                name = node.get("name")
                if name not in input_types:
                    raise SkillContractError(f"graph.{node['id']}.name: unknown skill input {name!r}")
                declared[node["id"]] = {str(node.get("out", {}).get("value", name)): input_types[name]}
            elif node_type == "output":
                declared[node["id"]] = {}
            elif node_type == "join":
                if node.get("out") != {"value": "json"}:
                    raise SkillContractError(f"graph.{node['id']}.out: join must declare exactly {{'value': 'json'}}")
                branch_inputs = node.get("in")
                accepted_inputs = node.get("accepts")
                if not isinstance(branch_inputs, Mapping) or not branch_inputs:
                    raise SkillContractError(f"graph.{node['id']}.in: join requires at least one branch input")
                if not isinstance(accepted_inputs, Mapping) or set(accepted_inputs) != set(branch_inputs):
                    raise SkillContractError(f"graph.{node['id']}.accepts: declare the artifact kind for every join branch")
                if any(not isinstance(source, str) or not source.startswith("$") for source in branch_inputs.values()):
                    raise SkillContractError(f"graph.{node['id']}.in: join inputs must reference typed graph outputs")
                declared[node["id"]] = {"value": "json"}
            elif node_type == "parallel":
                # A parallel node is a static fan-in barrier over independent
                # graph branches. Its inputs and outputs are typed identity ports.
                branches = node.get("in")
                accepts = node.get("accepts")
                outputs = node.get("out")
                if not isinstance(branches, Mapping) or len(branches) < 2:
                    raise SkillContractError(f"graph.{node['id']}.in: parallel requires at least two static branches")
                if not isinstance(accepts, Mapping) or set(accepts) != set(branches):
                    raise SkillContractError(f"graph.{node['id']}.accepts: declare the artifact kind for every branch")
                if not isinstance(outputs, Mapping) or set(outputs) != set(branches) or dict(outputs) != dict(accepts):
                    raise SkillContractError(f"graph.{node['id']}.out: parallel outputs must preserve every branch name and type")
                producers: set[str] = set()
                for branch, source in branches.items():
                    match = _REFERENCE.fullmatch(source) if isinstance(source, str) else None
                    if not match or match.group(1) == "input":
                        raise SkillContractError(f"graph.{node['id']}.in.{branch}: parallel branches must reference node outputs")
                    producers.add(match.group(1))
                if len(producers) != len(branches):
                    raise SkillContractError(f"graph.{node['id']}.in: each parallel branch must have a distinct producer node")
                declared[node["id"]] = dict(outputs)
            elif node_type == "skill":
                child = self._lookup_subskill(node)
                if child is None:
                    raise SkillContractError(f"graph.{node['id']}.skill_id: referenced sub-skill is not registered")
                child_key = child.get("id")
                if child_key in stack or child_key == skill_key:
                    raise SkillContractError(f"graph: sub-skill cycle includes {child_key!r}")
                if len(stack) >= MAX_SUBSKILL_DEPTH:
                    raise SkillContractError(f"graph.{node['id']}: sub-skill nesting exceeds depth {MAX_SUBSKILL_DEPTH}")
                child_skill = self._type_check(child, stack=(*stack, skill_key))
                widened = [permission for permission, child_level in child_skill["permissions"].items()
                           if not _PERMISSION_GRANTS[permission][child_level].issubset(
                               _PERMISSION_GRANTS[permission][skill["permissions"].get(permission, "none")])]
                if widened:
                    raise SkillContractError(
                        f"graph.{node['id']}: sub-skill widens inherited permissions: " +
                        ", ".join(sorted(widened)))
                child_inputs = {port["name"]: port for port in child_skill["inputs"]}
                child_outputs = {port["name"]: port for port in child_skill["outputs"]}
                supplied = node.get("in", {})
                accepts = node.get("accepts", {})
                outputs = node.get("out", {})
                if not isinstance(supplied, Mapping) or set(supplied) - set(child_inputs):
                    raise SkillContractError(f"graph.{node['id']}.in: sub-skill inputs must name declared child inputs")
                missing_required = {name for name, port in child_inputs.items()
                                    if port.get("required", False) and name not in supplied}
                if missing_required:
                    raise SkillContractError(f"graph.{node['id']}.in: missing required child input(s): " +
                                             ", ".join(sorted(missing_required)))
                if not isinstance(accepts, Mapping) or set(accepts) != set(supplied):
                    raise SkillContractError(f"graph.{node['id']}.accepts: declare every supplied child input kind")
                for name in supplied:
                    if accepts[name] != child_inputs[name]["artifact"]:
                        raise SkillContractError(f"graph.{node['id']}.accepts.{name}: expected child input kind {child_inputs[name]['artifact']!r}")
                expected_outputs = {name: port["artifact"] for name, port in child_outputs.items()}
                if not isinstance(outputs, Mapping) or dict(outputs) != expected_outputs:
                    raise SkillContractError(f"graph.{node['id']}.out: must match the child skill output names and kinds")
                declared[node["id"]] = dict(outputs)
            elif node_type == "fallback":
                ports = node.get("out", {})
                if not isinstance(ports, Mapping) or not ports:
                    raise SkillContractError(f"graph.{node['id']}.out: typed fallback output declarations are required")
                clean: dict[str, str] = {}
                for port, kind in ports.items():
                    if not isinstance(port, str) or not isinstance(kind, str) or kind not in ARTIFACT_KINDS:
                        raise SkillContractError(f"graph.{node['id']}.out.{port}: expected an artifact kind")
                    clean[port] = kind
                declared[node["id"]] = clean
            else:
                ports = node.get("out", {})
                if not isinstance(ports, Mapping) or not ports:
                    raise SkillContractError(f"graph.{node['id']}.out: typed output declarations are required")
                clean: dict[str, str] = {}
                for port, kind in ports.items():
                    if not isinstance(port, str) or not isinstance(kind, str) or kind not in ARTIFACT_KINDS:
                        raise SkillContractError(f"graph.{node['id']}.out.{port}: expected an artifact kind")
                    clean[port] = kind
                declared[node["id"]] = clean
        for node in graph:
            if node["type"] in {"input", "output"}:
                continue
            ins = node.get("in", {})
            if not isinstance(ins, Mapping):
                raise SkillContractError(f"graph.{node['id']}.in: expected an object")
            for port, ref in ins.items():
                if not isinstance(ref, str) or not ref.startswith("$"):
                    continue
                match = _REFERENCE.fullmatch(ref)
                if not match:
                    raise SkillContractError(f"graph.{node['id']}.in.{port}: malformed reference")
                source_id, source_port = match.groups()
                if source_id == "input":
                    actual_kind = input_types.get(source_port)
                    if actual_kind is None:
                        raise SkillContractError(f"graph.{node['id']}.in.{port}: unknown skill input {source_port!r}")
                    accepts = node.get("accepts", {}).get(port) if isinstance(node.get("accepts", {}), Mapping) else None
                    if accepts is None:
                        raise SkillContractError(f"graph.{node['id']}.accepts.{port}: destination artifact kind must be declared")
                    if accepts is not None and accepts != actual_kind:
                        raise SkillContractError(f"graph.{node['id']}.in.{port}: expected {accepts}, got {actual_kind}")
                    continue
                if source_id not in by_id:
                    raise SkillContractError(f"graph.{node['id']}.in.{port}: unknown source node")
                kind = declared.get(source_id, {}).get(source_port)
                if kind is None:
                    raise SkillContractError(f"graph.{node['id']}.in.{port}: source output is not declared")
                accepts = node.get("accepts", {}).get(port) if isinstance(node.get("accepts", {}), Mapping) else None
                if accepts is None:
                    raise SkillContractError(f"graph.{node['id']}.accepts.{port}: destination artifact kind must be declared")
                if accepts is not None and accepts != kind:
                    raise SkillContractError(f"graph.{node['id']}.in.{port}: expected {accepts}, got {kind}")
        dependencies: dict[str, set[str]] = {node["id"]: set() for node in graph}
        for node in graph:
            for ref in node.get("in", {}).values():
                match = _REFERENCE.fullmatch(ref) if isinstance(ref, str) else None
                if match and match.group(1) != "input":
                    dependencies[node["id"]].add(match.group(1))
        ancestors: dict[str, set[str]] = {}

        def get_ancestors(node_id: str) -> set[str]:
            if node_id not in ancestors:
                result: set[str] = set()
                for dependency in dependencies[node_id]:
                    result.add(dependency)
                    result.update(get_ancestors(dependency))
                ancestors[node_id] = result
            return ancestors[node_id]

        for node in graph:
            if node["type"] != "parallel":
                continue
            producers = [
                _REFERENCE.fullmatch(value).group(1)  # contract above guaranteed this shape
                for value in node["in"].values()
            ]
            for index, producer in enumerate(producers):
                for other in producers[index + 1:]:
                    if producer in get_ancestors(other) or other in get_ancestors(producer):
                        raise SkillContractError(
                            f"graph.{node['id']}.in: parallel branches {producer!r} and {other!r} are dependency-linked"
                        )
        for node in graph:
            if node["type"] != "loop":
                continue
            incoming, outgoing = node.get("in", {}), node.get("out", {})
            if len(incoming) != 1 or len(outgoing) != 1:
                raise SkillContractError(f"graph.{node['id']}: loop must have exactly one input and one output")
            input_port = next(iter(incoming))
            output_port, output_kind = next(iter(outgoing.items()))
            accepted = node.get("accepts", {}).get(input_port) if isinstance(node.get("accepts"), Mapping) else None
            if accepted != output_kind:
                raise SkillContractError(f"graph.{node['id']}: loop input and output artifact kinds must match")
        max_steps = skill.get("policy", {}).get("max_steps")
        if any(node["type"] == "parallel" for node in graph) and skill.get("policy", {}).get("max_parallel_nodes", 1) < 2:
            raise SkillContractError("policy.max_parallel_nodes: parallel nodes require a concurrency limit of at least 2")
        if max_steps is not None:
            # Bookkeeping input/output nodes are free. Each runnable node counts
            # once; a loop counts each bounded transform invocation.
            step_cost = sum(
                self._subskill_step_cost(node) if node["type"] == "skill"
                else node.get("max_iterations", 1) if node["type"] == "loop"
                else len(node["fallbacks"]) if node["type"] == "fallback"
                else 1
                for node in graph if node["type"] not in {"input", "output"}
            )
            if step_cost > max_steps:
                raise SkillContractError(
                    f"policy.max_steps: graph requires {step_cost} steps, limit is {max_steps}"
                )
        for output in skill["outputs"]:
            for node in graph:
                if node["type"] != "output" or output["name"] not in node.get("in", {}):
                    continue
                ref = node["in"][output["name"]]
                match = _REFERENCE.fullmatch(ref) if isinstance(ref, str) else None
                if not match:
                    raise SkillContractError(f"graph.{node['id']}.in.{output['name']}: expected typed reference")
                source_id, source_port = match.groups()
                kind = declared.get(source_id, {}).get(source_port)
                if kind != output["artifact"]:
                    raise SkillContractError(f"outputs.{output['name']}: expected {output['artifact']}, got {kind or 'undeclared'}")
        for output in skill["outputs"]:
            if output.get("required", False) and not any(
                node["type"] == "output" and output["name"] in node.get("in", {}) for node in graph
            ):
                raise SkillContractError(f"outputs.{output['name']}: no output node publishes required output")
        return skill

    def _lookup_subskill(self, node: Mapping[str, Any]) -> Mapping[str, Any] | None:
        skill_id = node.get("skill_id")
        child = self._subskills.get(str(skill_id))
        if child is None:
            return None
        if child.get("id") != skill_id:
            return None
        version = node.get("skill_version")
        if version is not None and child.get("version") != version:
            return None
        return child

    def _subskill_step_cost(self, node: Mapping[str, Any]) -> int:
        child = self._lookup_subskill(node)
        if child is None:
            return 1
        total = 0
        for nested in child.get("graph", []):
            if nested.get("type") in {"input", "output"}:
                continue
            if nested.get("type") == "skill":
                total += self._subskill_step_cost(nested)
            elif nested.get("type") == "loop":
                total += nested.get("max_iterations", 1)
            elif nested.get("type") == "fallback":
                total += len(nested.get("fallbacks", ()))
            else:
                total += 1
        return max(1, total)

    def execute(self, manifest: Mapping[str, Any], inputs: Mapping[str, Any], *,
                event_callback: Callable[[str, str], None] | None = None,
                fallback_callback: FallbackCallback | None = None,
                plan_revision: str | None = None,
                layer_start_callback: Callable[[tuple[str, ...]], None] | None = None,
                layer_end_callback: Callable[[tuple[str, ...]], None] | None = None,
                cancel_event: threading.Event | None = None,
                _max_parallel_nodes_limit: int | None = None,
                _node_path_prefix: str = "",
                _skill_stack: tuple[str, ...] = ()) -> dict[str, Any]:
        skill = self.type_check(manifest)  # Always before invoking any callback.
        if skill["id"] in _skill_stack:
            raise SkillExecutionError(f"sub-skill cycle includes {skill['id']!r}")
        if len(_skill_stack) > MAX_SUBSKILL_DEPTH:
            raise SkillExecutionError(f"sub-skill nesting exceeds depth {MAX_SUBSKILL_DEPTH}")
        fallback_nodes = [node for node in skill["graph"] if node["type"] == "fallback"]
        if fallback_nodes:
            if fallback_callback is None:
                raise SkillExecutionError("fallback nodes require a trace callback for plan revisions")
            if plan_revision is not None and (not isinstance(plan_revision, str) or not plan_revision.strip()):
                raise SkillExecutionError("plan_revision must be a non-empty string")
            missing_candidates = sorted({
                item["transform_id"] for node in fallback_nodes for item in node["fallbacks"]
                if item["transform_id"] not in self._executors["transform"]
            })
            if missing_candidates:
                raise SkillExecutionError("unregistered fallback transform(s): " + ", ".join(missing_candidates))
            base_plan_revision = plan_revision or hashlib.sha256(json.dumps(
                {"skill": [skill["id"], skill["version"]], "graph": skill["graph"]},
                sort_keys=True, separators=(",", ":"), ensure_ascii=True,
            ).encode()).hexdigest()[:24]
        else:
            base_plan_revision = plan_revision or ""
        self._preflight_registered_handlers(skill)
        if not isinstance(inputs, Mapping):
            raise SkillExecutionError("inputs must be an object")
        input_ports = {port["name"]: port for port in skill["inputs"]}
        extra_inputs = set(inputs) - set(input_ports)
        if extra_inputs:
            raise SkillExecutionError(f"undeclared input(s): {', '.join(sorted(map(str, extra_inputs)))}")
        for name, port in input_ports.items():
            if port.get("required", False) and name not in inputs:
                raise SkillExecutionError(f"missing required input {name!r}")
            if name in inputs and not isinstance(inputs[name], Mapping):
                raise SkillExecutionError(f"input {name!r} must be a typed artifact mapping")
            if name in inputs and inputs[name].get("kind") != port["artifact"]:
                raise SkillExecutionError(f"input {name!r} must have artifact kind {port['artifact']!r}")
        referenced_inputs = {
            match.group(1) for node in skill["graph"]
            for value in node.get("in", {}).values()
            if isinstance(value, str) and (match := re.fullmatch(r"\$input\.([A-Za-z][A-Za-z0-9_-]*)", value))
        }
        referenced_inputs.update(node["name"] for node in skill["graph"] if node["type"] == "input")
        missing_references = referenced_inputs - set(inputs)
        if missing_references:
            raise SkillExecutionError(
                "workflow references missing input(s): " + ", ".join(sorted(missing_references))
            )
        state: dict[str, dict[str, Any]] = {}
        result: dict[str, Any] = {}
        child_trace: list[tuple[str, Any]] = []
        execution_context = {
            "event_callback": event_callback,
            "fallback_callback": fallback_callback,
            "plan_revision": base_plan_revision,
            "layer_start_callback": layer_start_callback,
            "layer_end_callback": layer_end_callback,
            "cancel_event": cancel_event,
            "max_parallel_nodes_limit": _max_parallel_nodes_limit,
            "node_path_prefix": _node_path_prefix,
            "skill_stack": (*_skill_stack, skill["id"]),
            "child_trace": child_trace,
        }
        max_parallel = skill.get("policy", {}).get("max_parallel_nodes", 1)
        inherited_limit = _max_parallel_nodes_limit
        if isinstance(inherited_limit, int) and not isinstance(inherited_limit, bool):
            max_parallel = min(max_parallel, inherited_limit)
        for layer in self._execution_layers(skill["graph"]):
            _raise_if_cancelled(cancel_event)
            # Chunk ready nodes so resource reservation and execution have the
            # same hard concurrency bound, even for very wide DAG layers.
            for start in range(0, len(layer), max_parallel):
                _raise_if_cancelled(cancel_event)
                batch = layer[start:start + max_parallel]
                node_ids = tuple(node["id"] for node in batch)
                route_node_ids = tuple(f"{_node_path_prefix}{node_id}" for node_id in node_ids)
                prepared = [(node, self._resolve_inputs(node, inputs, state)) for node in batch]
                reserved = False
                try:
                    if layer_start_callback is not None:
                        layer_start_callback(route_node_ids)
                        reserved = True
                    if event_callback:
                        for node, _ in prepared:
                            event_callback("started", node["id"])
                    if max_parallel > 1 and len(prepared) > 1:
                        with ThreadPoolExecutor(max_workers=max_parallel, thread_name_prefix="aidream-skill") as pool:
                            futures = [pool.submit(self._run_node, node, resolved, base_plan_revision, execution_context)
                                       for node, resolved in prepared]
                            outcomes = []
                            for (node, _), future in zip(prepared, futures):
                                try:
                                    produced, trace = future.result()
                                    outcomes.append((node, produced, None, trace))
                                except Exception as exc:
                                    outcomes.append((node, None, exc, getattr(exc, "trace", None)))
                    else:
                        outcomes = []
                        for node, resolved in prepared:
                            try:
                                produced, trace = self._run_node(node, resolved, base_plan_revision, execution_context)
                                outcomes.append((node, produced, None, trace))
                            except Exception as exc:
                                outcomes.append((node, None, exc, getattr(exc, "trace", None)))
                    for node, produced, error, trace in outcomes:
                        node_id = node["id"]
                        # Child traces are buffered by the executing worker and
                        # replayed here in stable graph declaration order.
                        for kind, item in child_trace:
                            if kind == node_id:
                                if item[0] == "event" and event_callback is not None:
                                    event_callback(item[1], item[2])
                                elif item[0] == "fallback" and fallback_callback is not None:
                                    fallback_callback(item[1])
                        child_trace[:] = [(kind, item) for kind, item in child_trace if kind != node_id]
                        if error is not None:
                            if trace is not None and fallback_callback is not None:
                                fallback_callback(trace)
                            if event_callback:
                                event_callback("failed", node_id)
                        else:
                            state[node_id] = produced
                            if node["type"] == "output":
                                result.update(produced)
                            if trace is not None and fallback_callback is not None:
                                fallback_callback(trace)
                            if event_callback:
                                event_callback("completed", node_id)
                    errors = [error for _, _, error, _ in outcomes if error is not None]
                    if errors:
                        # Deterministic failure selection follows graph declaration order.
                        raise errors[0]
                finally:
                    if reserved and layer_end_callback is not None:
                        layer_end_callback(route_node_ids)
        return result

    @staticmethod
    def _resolve_inputs(node: Mapping[str, Any], inputs: Mapping[str, Any],
                        state: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        if node["type"] == "input":
            name = node["name"]
            return {str(node.get("out", {}).get("value", name)): inputs[name]}
        resolved: dict[str, Any] = {}
        for key, value in node.get("in", {}).items():
            match = _REFERENCE.fullmatch(value) if isinstance(value, str) else None
            if match and match.group(1) == "input":
                resolved[key] = inputs[match.group(2)]
            else:
                resolved[key] = state[match.group(1)][match.group(2)] if match else value
        return resolved

    def _run_node(self, node: Mapping[str, Any], resolved: Mapping[str, Any],
                  base_plan_revision: str = "",
                  execution_context: Mapping[str, Any] | None = None) -> tuple[dict[str, Any], FallbackTrace | None]:
        _raise_if_cancelled((execution_context or {}).get("cancel_event"))
        node_type = node["type"]
        if node_type in {"input", "output"}:
            return dict(resolved), None
        if node_type == "join":
            return {"value": {"kind": "json", "value": dict(resolved)}}, None
        if node_type == "parallel":
            # Upstream independent branches have completed in the graph layers;
            # publish their artifacts under the barrier's stable branch names.
            return dict(resolved), None
        if node_type == "fallback":
            return self._run_fallback(node, resolved, base_plan_revision,
                                     (execution_context or {}).get("cancel_event"))
        if node_type == "skill":
            return self._run_subskill(node, resolved, execution_context or {})
        executor_type = "transform" if node_type == "loop" else node_type
        lookup_key = {"capability": "capability", "model": "model_id", "tool": "tool_id",
                      "transform": "transform_id", "router": "router_id", "loop": "transform_id"}[node_type]
        executor = self._executors[executor_type].get(str(node.get(lookup_key, "")))
        if executor is None:
            raise SkillExecutionError(f"no registered {executor_type} executor for {node.get(lookup_key)!r}")
        current = dict(resolved)
        produced = None
        for _ in range(node.get("max_iterations", 1) if node_type == "loop" else 1):
            _raise_if_cancelled((execution_context or {}).get("cancel_event"))
            if node_type in {"capability", "model"}:
                path_prefix = (execution_context or {}).get("node_path_prefix", "")
                invocation_node = {**node, "_orchestration_path": f"{path_prefix}{node['id']}"}
            else:
                invocation_node = node
            produced = executor(invocation_node, current)
            if node_type == "loop":
                if not isinstance(produced, Mapping) or set(produced) != set(node["out"]):
                    raise SkillExecutionError(f"loop node {node['id']!r} returned unexpected output ports")
                output_name = next(iter(node["out"]))
                artifact = produced.get(output_name)
                if not isinstance(artifact, Mapping) or artifact.get("kind") != node["out"][output_name]:
                    raise SkillExecutionError(f"loop node {node['id']!r}.{output_name} returned the wrong artifact kind")
                current = {next(iter(node["in"])): artifact}
        if not isinstance(produced, Mapping):
            raise SkillExecutionError(f"executor for node {node['id']!r} must return a mapping")
        expected = node["out"]
        if set(produced) != set(expected):
            raise SkillExecutionError(f"executor for node {node['id']!r} returned unexpected output ports")
        for port, artifact in produced.items():
            if not isinstance(artifact, Mapping) or artifact.get("kind") != expected[port]:
                raise SkillExecutionError(f"node {node['id']!r}.{port} must return artifact kind {expected[port]!r}")
        return dict(produced), None

    def _run_subskill(self, node: Mapping[str, Any], resolved: Mapping[str, Any],
                      context: Mapping[str, Any]) -> tuple[dict[str, Any], FallbackTrace | None]:
        child = self._lookup_subskill(node)
        if child is None:
            raise SkillExecutionError(f"sub-skill {node.get('skill_id')!r} is not registered")
        prefix = node["id"]
        trace_sink = context.get("child_trace")

        def child_event(state: str, child_node_id: str) -> None:
            if isinstance(trace_sink, list):
                trace_sink.append((prefix, ("event", state, f"{prefix}/{child_node_id}")))

        def child_fallback(trace: FallbackTrace) -> None:
            if isinstance(trace_sink, list):
                trace_sink.append((prefix, ("fallback", FallbackTrace(
                    trace.event_type, f"{prefix}/{trace.node_id}", trace.base_plan_revision,
                    trace.revision_id, trace.attempted_candidates, trace.selected_candidate,
                    trace.failure_kinds))))

        revision_seed = "\0".join((str(context.get("plan_revision", "")), prefix,
                                    str(child["id"]), str(child["version"])))
        child_revision = hashlib.sha256(revision_seed.encode()).hexdigest()[:24]
        child_executor = SkillExecutor(
            capabilities=self._executors["capability"], models=self._executors["model"],
            tools=self._executors["tool"], transforms=self._executors["transform"],
            routers=self._executors["router"], subskills=self._subskills,
        )
        outputs = child_executor.execute(
            child, resolved, event_callback=child_event, fallback_callback=child_fallback,
            plan_revision=child_revision,
            layer_start_callback=context.get("layer_start_callback"),
            layer_end_callback=context.get("layer_end_callback"),
            cancel_event=context.get("cancel_event"),
            _max_parallel_nodes_limit=context.get("max_parallel_nodes_limit"),
            _node_path_prefix=f"{context.get('node_path_prefix', '')}{node['id']}/",
            _skill_stack=tuple(context.get("skill_stack", ())),
        )
        return outputs, None

    def _run_fallback(self, node: Mapping[str, Any], resolved: Mapping[str, Any],
                      base_plan_revision: str, cancel_event: threading.Event | None = None
                      ) -> tuple[dict[str, Any], FallbackTrace | None]:
        failed_candidates: list[str] = []
        failure_kinds: list[str] = []
        for candidate in node["fallbacks"]:
            _raise_if_cancelled(cancel_event)
            candidate_id = candidate["id"]
            handler = self._executors["transform"][candidate["transform_id"]]
            candidate_node = {**node, "transform_id": candidate["transform_id"],
                              "fallback_candidate_id": candidate_id}
            try:
                produced = handler(candidate_node, resolved)
                if not isinstance(produced, Mapping):
                    raise SkillExecutionError(f"fallback candidate {candidate_id!r} returned a non-object")
                expected = node["out"]
                if set(produced) != set(expected):
                    raise SkillExecutionError(f"fallback candidate {candidate_id!r} returned unexpected output ports")
                for port, artifact in produced.items():
                    if not isinstance(artifact, Mapping) or artifact.get("kind") != expected[port]:
                        raise SkillExecutionError(f"fallback candidate {candidate_id!r}.{port} returned the wrong artifact kind")
                if not failed_candidates:
                    return dict(produced), None
                revision_id = hashlib.sha256(
                    f"{base_plan_revision}\0{node['id']}\0{candidate_id}".encode()
                ).hexdigest()[:24]
                trace = FallbackTrace("fallback.selected", node["id"], base_plan_revision,
                                      revision_id, tuple(failed_candidates + [candidate_id]),
                                      candidate_id, tuple(failure_kinds))
                return dict(produced), trace
            except RunCancelled:
                raise
            except Exception as exc:
                failed_candidates.append(candidate_id)
                failure_kinds.append(type(exc).__name__)
        raise FallbackExhaustedError(FallbackTrace(
            "fallback.exhausted", node["id"], base_plan_revision, None,
            tuple(failed_candidates), None, tuple(failure_kinds),
        ))

    def _preflight_registered_handlers(self, skill: Mapping[str, Any]) -> None:
        """Confirm the complete nested graph is executable before first side effect."""
        missing: dict[str, set[str]] = {}
        missing_fallbacks: set[str] = set()

        def visit(manifest: Mapping[str, Any], prefix: str) -> None:
            for node in manifest["graph"]:
                node_id = f"{prefix}{node['id']}"
                kind = node["type"]
                if kind in {"input", "output", "join", "parallel"}:
                    continue
                if kind == "skill":
                    child = self._lookup_subskill(node)
                    if child is not None:
                        visit(child, node_id + "/")
                    continue
                if kind == "fallback":
                    missing_fallbacks.update(candidate["transform_id"] for candidate in node["fallbacks"]
                                             if candidate["transform_id"] not in self._executors["transform"])
                    continue
                executor_type = "transform" if kind == "loop" else kind
                lookup_key = {"capability": "capability", "model": "model_id", "tool": "tool_id",
                              "transform": "transform_id", "router": "router_id", "loop": "transform_id"}[kind]
                executor_id = str(node.get(lookup_key, ""))
                if executor_id not in self._executors[executor_type]:
                    missing.setdefault(executor_type, set()).add(f"{node_id} ({executor_id})")

        visit(skill, "")
        if missing_fallbacks:
            raise SkillExecutionError("unregistered fallback transform(s): " + ", ".join(sorted(missing_fallbacks)))
        if missing:
            executor_type = sorted(missing)[0]
            raise SkillExecutionError(
                f"no registered {executor_type} executor for: " + ", ".join(sorted(missing[executor_type])))

    @staticmethod
    def _execution_order(graph: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Stable topological order, allowing manifests to list consumers first."""
        by_id = {node["id"]: node for node in graph}
        pending = {node["id"]: set() for node in graph}
        for node in graph:
            if node["type"] == "input":
                continue
            for value in node.get("in", {}).values():
                match = _REFERENCE.fullmatch(value) if isinstance(value, str) else None
                if match and match.group(1) != "input":
                    pending[node["id"]].add(match.group(1))
        ordered: list[dict[str, Any]] = []
        emitted: set[str] = set()
        while len(emitted) < len(graph):
            ready = [node for node in graph if node["id"] not in emitted and pending[node["id"]] <= emitted]
            if not ready:  # validate_skill_manifest already rejects cycles; defensive only.
                raise SkillContractError("graph: dependencies cannot be ordered")
            for node in ready:
                ordered.append(by_id[node["id"]])
                emitted.add(node["id"])
        return ordered


    @staticmethod
    def _execution_layers(graph: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        """Stable topological layers; independent branches are parallel opt-in."""
        pending = {node["id"]: set() for node in graph}
        for node in graph:
            if node["type"] == "input":
                continue
            for value in node.get("in", {}).values():
                match = _REFERENCE.fullmatch(value) if isinstance(value, str) else None
                if match and match.group(1) != "input":
                    pending[node["id"]].add(match.group(1))
        emitted: set[str] = set()
        layers: list[list[dict[str, Any]]] = []
        while len(emitted) < len(graph):
            ready = [node for node in graph if node["id"] not in emitted and pending[node["id"]] <= emitted]
            if not ready:
                raise SkillContractError("graph: dependencies cannot be ordered")
            layers.append(ready)
            emitted.update(node["id"] for node in ready)
        return layers


def _raise_if_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise RunCancelled("run cancelled")
