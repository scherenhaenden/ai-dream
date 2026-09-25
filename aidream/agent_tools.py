"""Typed, allow-listed read-only tools for local agent workflows.

The registry intentionally has no generic function execution, shell, or write
primitive. Its only operations report information from existing core services.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from aidream.hardware import HardwareService
from aidream.models import ModelCatalog
from aidream.runtime import RuntimeRegistry
from aidream.runtime_manager import RuntimeManager


@dataclass(frozen=True)
class ToolSpec:
    """A stable description of one callable tool."""

    name: str
    description: str
    parameters: Mapping[str, str]
    read_only: bool = True


class AgentToolRegistry:
    """Expose a small, fixed set of local status and catalog queries."""

    def __init__(
        self,
        *,
        hardware: HardwareService | None = None,
        models: ModelCatalog | None = None,
        runtime: RuntimeRegistry | None = None,
        runtime_manager: RuntimeManager | None = None,
    ) -> None:
        self._hardware = hardware or HardwareService()
        self._models = models or ModelCatalog()
        self._runtime = runtime or RuntimeRegistry()
        self._runtime_manager = runtime_manager or RuntimeManager()
        self._specs = (
            ToolSpec("hardware.status", "Get CPU, memory, OS, and detected GPU status.", {}),
            ToolSpec("models.list", "List GGUF models already present in configured local folders.", {}),
            ToolSpec("models.info", "Get metadata for a locally catalogued GGUF model.", {"model_id": "string"}),
            ToolSpec("runtime.status", "Get llama.cpp installation and backend status.", {}),
        )

    def list_tools(self) -> tuple[ToolSpec, ...]:
        """Return descriptions without exposing mutable registry internals."""
        return self._specs

    def invoke(self, name: str, arguments: Mapping[str, Any] | None = None) -> Any:
        """Invoke one named query, rejecting unknown tools and extra arguments."""
        if not isinstance(name, str):
            raise ValueError("tool name must be a string")
        args = {} if arguments is None else arguments
        if not isinstance(args, Mapping):
            raise ValueError("tool arguments must be an object")
        spec = next((item for item in self._specs if item.name == name), None)
        if spec is None:
            raise ValueError(f"Unknown agent tool: {name}")
        missing = set(spec.parameters) - set(args)
        extra = set(args) - set(spec.parameters)
        if missing:
            raise ValueError(f"Missing argument(s) for {name}: {', '.join(sorted(missing))}")
        if extra:
            raise ValueError(f"Unsupported argument(s) for {name}: {', '.join(sorted(extra))}")

        if name == "hardware.status":
            return self._hardware.detect()
        if name == "models.list":
            return self._models.list_models()
        if name == "models.info":
            model_id = args["model_id"]
            if not isinstance(model_id, str) or not model_id.strip():
                raise ValueError("model_id must be a non-empty string")
            model = next((item for item in self._models.list_models() if item.id == model_id), None)
            if model is None:
                raise ValueError(f"Model is not present in the local catalog: {model_id}")
            return model
        if name == "runtime.status":
            return {
                "installation": self._runtime_manager.status(),
                "backends": [
                    {"name": backend.name, "capabilities": backend.capabilities()}
                    for backend in self._runtime.list_backends()
                ],
            }
        # This is unreachable unless the fixed spec list and dispatcher diverge.
        raise RuntimeError(f"No implementation for registered tool: {name}")
