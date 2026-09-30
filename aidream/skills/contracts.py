"""Declarative contracts and validation for skill manifests and workflow graphs.

This module validates plans only. It does not resolve capabilities, load models,
execute nodes, or grant permissions.
"""
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any, TypedDict

SCHEMA_VERSION = 1
CAPABILITY_ID_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
SKILL_ID_PATTERN = CAPABILITY_ID_PATTERN
SEMVER_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$")
NODE_ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")

ARTIFACT_KINDS = frozenset({
    "text", "chat_messages", "json", "image", "audio", "video", "document",
    "embedding_batch", "rerank_candidates", "file_reference", "screen_frame",
    "tool_result", "model_reference",
})
NODE_TYPES = frozenset({
    "capability", "model", "skill", "tool", "transform", "router", "parallel",
    "join", "loop", "fallback", "input", "output",
})
PERMISSION_VALUES: dict[str, frozenset[str]] = {
    "filesystem_read": frozenset({"none", "user-selected-only", "scoped-paths"}),
    "filesystem_write": frozenset({"none", "user-approved-output", "scoped-paths"}),
    "network": frozenset({"none", "specific-hosts", "unrestricted"}),
    "shell": frozenset({"none", "registered-command-only"}),
    "browser_control": frozenset({"none", "allowed"}),
    "computer_control": frozenset({"none", "allowed"}),
    "desktop_control": frozenset({"none", "allowed"}),
    "microphone": frozenset({"none", "allowed"}),
    "camera": frozenset({"none", "allowed"}),
    "clipboard": frozenset({"none", "read", "write", "read-write"}),
}


class SkillPort(TypedDict, total=False):
    name: str
    artifact: str
    required: bool


class SkillManifest(TypedDict, total=False):
    schema_version: int
    id: str
    name: str
    version: str
    description: str
    inputs: list[SkillPort]
    outputs: list[SkillPort]
    requirements: dict[str, Any]
    permissions: dict[str, str]
    policy: dict[str, Any]
    ui: dict[str, Any]
    graph: list[dict[str, Any]]


class SkillContractError(ValueError):
    """Raised when a skill manifest or workflow graph is invalid."""


def validate_capability_id(value: Any, *, path: str = "capability") -> str:
    """Return a normalized capability ID or raise a path-specific error."""
    if not isinstance(value, str) or not CAPABILITY_ID_PATTERN.fullmatch(value):
        raise SkillContractError(f"{path}: expected a normalized capability ID")
    return value


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise SkillContractError(f"{path}: expected an object")
    if any(not isinstance(key, str) for key in value):
        raise SkillContractError(f"{path}: object keys must be strings")
    return value


def _nonempty_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SkillContractError(f"{path}: expected a non-empty string")
    return value


def _ports(value: Any, path: str) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        raise SkillContractError(f"{path}: expected a list")
    result: list[Mapping[str, Any]] = []
    names: set[str] = set()
    for index, raw_port in enumerate(value):
        port_path = f"{path}[{index}]"
        port = _mapping(raw_port, port_path)
        name = _nonempty_string(port.get("name"), f"{port_path}.name")
        if name in names:
            raise SkillContractError(f"{port_path}.name: duplicate port {name!r}")
        names.add(name)
        artifact = _nonempty_string(port.get("artifact"), f"{port_path}.artifact")
        if artifact not in ARTIFACT_KINDS:
            raise SkillContractError(f"{port_path}.artifact: unknown artifact kind {artifact!r}")
        if "required" in port and not isinstance(port["required"], bool):
            raise SkillContractError(f"{port_path}.required: expected a boolean")
        result.append(port)
    return result


def _check_reference(reference: Any, path: str, input_names: set[str], node_ids: set[str]) -> tuple[str, str] | None:
    if not isinstance(reference, str):
        return None  # Literal node settings are allowed.
    if reference.startswith("$input."):
        name = reference[len("$input."):]
        if name not in input_names:
            raise SkillContractError(f"{path}: references undeclared input {name!r}")
        return "input", name
    if reference.startswith("$"):
        match = re.fullmatch(r"\$([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)", reference)
        if not match:
            raise SkillContractError(f"{path}: malformed graph reference {reference!r}")
        source_id, output_name = match.groups()
        if source_id not in node_ids:
            raise SkillContractError(f"{path}: references unknown node {source_id!r}")
        return source_id, output_name
    return None


def validate_workflow_graph(
    graph: Any, *, input_ports: Sequence[Mapping[str, Any]] = ()
) -> list[dict[str, Any]]:
    """Validate node types, identifiers, references, and dependency cycles.

    Unknown optional fields are retained for forward compatibility. Unknown node
    types and malformed references are rejected rather than treated as executable.
    """
    if not isinstance(graph, list):
        raise SkillContractError("graph: expected a list")
    nodes: list[dict[str, Any]] = []
    ids: set[str] = set()
    for index, raw_node in enumerate(graph):
        path = f"graph[{index}]"
        node = _mapping(raw_node, path)
        node_id = _nonempty_string(node.get("id"), f"{path}.id")
        if not NODE_ID_PATTERN.fullmatch(node_id):
            raise SkillContractError(f"{path}.id: expected a simple node identifier")
        if node_id in ids:
            raise SkillContractError(f"{path}.id: duplicate node ID {node_id!r}")
        ids.add(node_id)
        node_type = node.get("type")
        if not isinstance(node_type, str) or node_type not in NODE_TYPES:
            raise SkillContractError(f"{path}.type: unknown workflow node type {node_type!r}")
        if node_type == "capability":
            validate_capability_id(node.get("capability"), path=f"{path}.capability")
        elif node_type == "model":
            _nonempty_string(node.get("model_id"), f"{path}.model_id")
            validate_capability_id(node.get("operation"), path=f"{path}.operation")
        elif node_type in {"skill", "tool", "transform"}:
            field = {"skill": "skill_id", "tool": "tool_id", "transform": "transform_id"}[node_type]
            _nonempty_string(node.get(field), f"{path}.{field}")
            if node_type == "skill" and "skill_version" in node:
                version = _nonempty_string(node["skill_version"], f"{path}.skill_version")
                if not SEMVER_PATTERN.fullmatch(version):
                    raise SkillContractError(f"{path}.skill_version: expected semantic version (major.minor.patch)")
        elif node_type == "loop":
            _nonempty_string(node.get("transform_id"), f"{path}.transform_id")
            count = node.get("max_iterations")
            if type(count) is not int or not 1 <= count <= 8:
                raise SkillContractError(f"{path}.max_iterations: expected an integer from 1 to 8")
        elif node_type == "fallback":
            choices = node.get("fallbacks")
            if not isinstance(choices, list) or not 2 <= len(choices) <= 4:
                raise SkillContractError(f"{path}.fallbacks: expected 2 to 4 ordered candidates")
            candidate_ids: set[str] = set()
            transform_ids: set[str] = set()
            for candidate_index, raw_candidate in enumerate(choices):
                candidate_path = f"{path}.fallbacks[{candidate_index}]"
                candidate = _mapping(raw_candidate, candidate_path)
                candidate_id = _nonempty_string(candidate.get("id"), f"{candidate_path}.id")
                if not NODE_ID_PATTERN.fullmatch(candidate_id) or candidate_id in candidate_ids:
                    raise SkillContractError(f"{candidate_path}.id: expected a unique simple candidate ID")
                candidate_ids.add(candidate_id)
                transform_id = _nonempty_string(candidate.get("transform_id"), f"{candidate_path}.transform_id")
                if transform_id in transform_ids:
                    raise SkillContractError(f"{candidate_path}.transform_id: fallback candidates must be distinct")
                transform_ids.add(transform_id)
        for field in ("in", "out"):
            if field in node:
                ports = _mapping(node[field], f"{path}.{field}")
                if any(not key for key in ports):
                    raise SkillContractError(f"{path}.{field}: port names cannot be empty")
        nodes.append(dict(node))

    input_names = {str(port["name"]) for port in input_ports}
    node_by_id = {node["id"]: node for node in nodes}
    dependencies: dict[str, set[str]] = {node["id"]: set() for node in nodes}
    for index, node in enumerate(nodes):
        node_inputs = _mapping(node.get("in", {}), f"graph[{index}].in")
        for port, source in node_inputs.items():
            reference = _check_reference(source, f"graph[{index}].in.{port}", input_names, ids)
            if reference and reference[0] != "input":
                source_id, output_name = reference
                declared = _mapping(node_by_id[source_id].get("out", {}), f"graph.{source_id}.out")
                if output_name not in declared:
                    raise SkillContractError(
                        f"graph[{index}].in.{port}: node {source_id!r} has no declared output {output_name!r}"
                    )
                dependencies[node["id"]].add(source_id)

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visiting:
            raise SkillContractError(f"graph: dependency cycle includes node {node_id!r}")
        if node_id in visited:
            return
        visiting.add(node_id)
        for dependency in dependencies[node_id]:
            visit(dependency)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in dependencies:
        visit(node_id)
    return nodes


def validate_skill_manifest(value: Any) -> SkillManifest:
    """Validate and shallow-copy a version-1 manifest, preserving extra metadata."""
    manifest = _mapping(value, "manifest")
    if type(manifest.get("schema_version")) is not int or manifest.get("schema_version") != SCHEMA_VERSION:
        raise SkillContractError(f"schema_version: expected {SCHEMA_VERSION}")
    skill_id = _nonempty_string(manifest.get("id"), "id")
    if not SKILL_ID_PATTERN.fullmatch(skill_id):
        raise SkillContractError("id: expected a normalized namespaced skill ID")
    _nonempty_string(manifest.get("name"), "name")
    version = _nonempty_string(manifest.get("version"), "version")
    if not SEMVER_PATTERN.fullmatch(version):
        raise SkillContractError("version: expected semantic version (major.minor.patch)")
    _nonempty_string(manifest.get("description"), "description")

    inputs = _ports(manifest.get("inputs"), "inputs")
    outputs = _ports(manifest.get("outputs"), "outputs")
    requirements = _mapping(manifest.get("requirements"), "requirements")
    capabilities = requirements.get("capabilities")
    if not isinstance(capabilities, list):
        raise SkillContractError("requirements.capabilities: expected a list")
    normalized = [validate_capability_id(item, path=f"requirements.capabilities[{index}]") for index, item in enumerate(capabilities)]
    if len(set(normalized)) != len(normalized):
        raise SkillContractError("requirements.capabilities: duplicate capability ID")

    permissions = _mapping(manifest.get("permissions", {}), "permissions")
    effective_permissions = {name: "none" for name in PERMISSION_VALUES}
    for permission, allowed in PERMISSION_VALUES.items():
        if permission in permissions and (
            not isinstance(permissions[permission], str) or permissions[permission] not in allowed
        ):
            raise SkillContractError(f"permissions.{permission}: unsupported value {permissions[permission]!r}")
        if permission in permissions:
            effective_permissions[permission] = permissions[permission]
    policy = _mapping(manifest.get("policy", {}), "policy")
    for key in ("max_steps", "timeout_seconds"):
        if key in policy and (not isinstance(policy[key], int) or isinstance(policy[key], bool) or policy[key] <= 0):
            raise SkillContractError(f"policy.{key}: expected a positive integer")
    if "max_parallel_nodes" in policy and (
        type(policy["max_parallel_nodes"]) is not int or not 1 <= policy["max_parallel_nodes"] <= 8
    ):
        raise SkillContractError("policy.max_parallel_nodes: expected an integer from 1 to 8")
    if "continue_on_optional_failure" in policy and not isinstance(policy["continue_on_optional_failure"], bool):
        raise SkillContractError("policy.continue_on_optional_failure: expected a boolean")
    _mapping(manifest.get("ui", {}), "ui")

    graph = validate_workflow_graph(manifest.get("graph"), input_ports=inputs)
    return {
        **manifest,
        "inputs": inputs,
        "outputs": outputs,
        "permissions": effective_permissions | dict(permissions),
        "graph": graph,
    }  # type: ignore[return-value]
