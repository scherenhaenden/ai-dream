"""Subprocess-backed inference runtimes for locally installed llama.cpp."""
from __future__ import annotations
from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any, Mapping, Protocol

class ModelLike(Protocol):
    path: str | Path

@dataclass(frozen=True)
class BackendCapabilities:
    """Controls actually exposed by this executable's help output."""
    available: bool
    executable: str | None
    gpu_layers: bool = False
    device_selection: bool = False
    tensor_split: bool = False
    details: str = ""

class InferenceBackend(Protocol):
    name: str
    def capabilities(self) -> BackendCapabilities: ...
    def can_load(self, model: Any) -> bool: ...
    def load(self, model: Any, placement: Any = None) -> None: ...
    def generate(self, prompt: str) -> str: ...
    def unload(self) -> None: ...

class LlamaCppBackend:
    """Run a locally installed llama.cpp CLI. Generation is one subprocess per prompt."""
    name = "llama.cpp"
    candidates = ("llama-cli", "llama.cpp", "main")

    def __init__(self, executable: str | None = None, timeout: float | None = None):
        self.executable = executable or next((shutil.which(n) for n in self.candidates if shutil.which(n)), None)
        self.timeout = timeout
        self._loaded_model: Path | None = None
        self._placement: list[str] = []
        self._help = self._read_help() if self.executable else ""

    def _read_help(self) -> str:
        try:
            result = subprocess.run([self.executable, "--help"], capture_output=True, text=True, timeout=10)
            return result.stdout + result.stderr
        except (OSError, subprocess.SubprocessError):
            return ""

    def capabilities(self) -> BackendCapabilities:
        help_text = self._help
        if not self.executable:
            return BackendCapabilities(False, None, details="No llama.cpp CLI found on PATH (looked for llama-cli, llama.cpp, main).")
        if not help_text:
            return BackendCapabilities(False, self.executable, details="Executable found, but --help failed; CLI interface could not be verified.")
        gpu = "-ngl" in help_text or "--n-gpu-layers" in help_text
        device = "--device" in help_text
        split = "--tensor-split" in help_text or "--tensor_split" in help_text
        return BackendCapabilities(True, self.executable, gpu, device, split,
            "Placement is limited to flags advertised by this executable. Device identity is not inferred from hardware discovery.")

    @staticmethod
    def _path(model: Any) -> Path | None:
        candidate = getattr(model, "path", model)
        try:
            return Path(os.fspath(candidate)).expanduser()
        except TypeError:
            return None

    def can_load(self, model: Any) -> bool:
        path = self._path(model)
        return bool(self.capabilities().available and path and path.is_file() and path.suffix.lower() == ".gguf")

    def load(self, model: Any, placement: Any = None) -> None:
        path = self._path(model)
        if not self.can_load(model):
            raise ValueError("llama.cpp can load only an existing GGUF model when its CLI is available")
        options = self._placement_options(placement)
        self._loaded_model = path.resolve()
        self._placement = options

    def _placement_options(self, placement: Any) -> list[str]:
        if placement is None:
            return []
        if isinstance(placement, str):
            placement = {"device": placement}
        if not isinstance(placement, Mapping):
            raise ValueError("placement must be a mapping, device name, or None")
        opts: list[str] = []
        caps = self.capabilities()
        if "gpu_layers" in placement:
            if not caps.gpu_layers:
                raise ValueError("This llama.cpp executable does not advertise GPU layer placement")
            opts.extend(["-ngl", str(int(placement["gpu_layers"]))])
        if "device" in placement:
            if not caps.device_selection:
                raise ValueError("This llama.cpp executable does not advertise device selection")
            opts.extend(["--device", str(placement["device"])])
        if "tensor_split" in placement:
            if not caps.tensor_split:
                raise ValueError("This llama.cpp executable does not advertise tensor splitting")
            opts.extend(["--tensor-split", str(placement["tensor_split"])])
        unknown = set(placement) - {"gpu_layers", "device", "tensor_split"}
        if unknown:
            raise ValueError(f"Unsupported placement setting(s): {', '.join(sorted(unknown))}")
        return opts

    def generate(self, prompt: str) -> str:
        if self._loaded_model is None:
            raise RuntimeError("No model is loaded")
        command = [self.executable, "-m", str(self._loaded_model), "-p", prompt, "-n", "256", *self._placement]
        result = subprocess.run(command, capture_output=True, text=True, timeout=self.timeout)
        if result.returncode:
            raise RuntimeError(f"llama.cpp exited with status {result.returncode}: {result.stderr.strip()}")
        return result.stdout.strip()

    def unload(self) -> None:
        """Clear loaded state. CLI model resources live only for each generate subprocess."""
        self._loaded_model = None
        self._placement = []

class RuntimeRegistry:
    """Registry for supported local inference backends."""
    def __init__(self, backends: list[InferenceBackend] | None = None):
        self._backends = backends if backends is not None else [LlamaCppBackend()]
    def list_backends(self) -> list[InferenceBackend]:
        return list(self._backends)
