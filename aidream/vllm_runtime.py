"""vLLM inference backend for AI Dream.

The adapter deliberately reuses AI Dream's OpenAI-compatible chat transport and
conversation handling from :class:`LlamaCppBackend`, while replacing model
startup and the supported placement/load controls with vLLM equivalents.

vLLM's GGUF support is optional and currently supplied by the upstream
``vllm-gguf-plugin``. AI Dream therefore advertises vLLM when the executable is
available, but startup will still fail with the upstream diagnostic when a
selected GGUF requires a missing plugin or tokenizer/config information.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Mapping

from aidream.runtime import BackendCapabilities, LlamaCppBackend, _positive_int


class VLLMBackend(LlamaCppBackend):
    """Manage a local ``vllm serve`` process through its OpenAI API."""

    name = "vLLM"
    candidates = ("vllm",)

    def __init__(self, executable: str | None = None, timeout: float = 180.0,
                 startup_timeout: float = 180.0, port: int | None = None, *,
                 runtime_id: str | None = None, name: str | None = None):
        resolved = executable or shutil.which("vllm")
        super().__init__(resolved, timeout=timeout, startup_timeout=startup_timeout,
                         port=port, runtime_id=runtime_id, name=name or type(self).name)

    def _read_help(self) -> str:
        if not self.executable:
            return ""
        try:
            result = subprocess.run([self.executable, "serve", "--help"],
                                    capture_output=True, text=True, timeout=15,
                                    check=False, shell=False)
            return result.stdout + result.stderr
        except (OSError, subprocess.SubprocessError):
            return ""

    def capabilities(self) -> BackendCapabilities:
        if not self.executable:
            return BackendCapabilities(
                False, None,
                details="No vLLM executable found on PATH. Install vLLM to enable this backend.")
        if not self._help:
            return BackendCapabilities(
                False, self.executable,
                details="vLLM was found, but `vllm serve --help` could not be verified.")

        has = lambda flag: bool(re.search(
            r"(?<![\w-])" + re.escape(flag) + r"(?![\w-])", self._help))
        return BackendCapabilities(
            available=True,
            executable=self.executable,
            device_selection=has("--device-ids"),
            tensor_split=has("--tensor-parallel-size") or has("-tp"),
            details=(
                "Persistent vLLM OpenAI-compatible server. Existing AI Dream GGUF files "
                "can be attempted when the upstream vllm-gguf-plugin is installed; native "
                "Hugging Face model directories are also accepted by the backend."
            ),
            context_size=has("--max-model-len"),
            chat_completions=True,
            max_concurrent=has("--max-num-seqs"),
        )

    @staticmethod
    def _path(model: Any) -> Path | None:
        candidate = getattr(model, "path", model)
        try:
            return Path(os.fspath(candidate)).expanduser()
        except TypeError:
            return None

    def can_load(self, model: Any) -> bool:
        if not self.capabilities().available:
            return False
        path = self._path(model)
        if not path or not path.exists():
            return False
        if path.is_dir():
            return (path / "config.json").is_file()
        return path.is_file() and path.suffix.lower() == ".gguf"

    def validate_load(self, model: Any, placement: Any = None,
                      options: Mapping[str, Any] | None = None) -> None:
        caps = self.capabilities()
        if not caps.available:
            raise RuntimeError(caps.details or "No usable vLLM runtime is available")
        path = self._path(model)
        if not path or not path.exists():
            raise ValueError("Select an existing GGUF file or Hugging Face model directory.")
        if path.is_dir() and not (path / "config.json").is_file():
            raise ValueError("A vLLM model directory must contain config.json.")
        if path.is_file() and path.suffix.lower() != ".gguf":
            raise ValueError("vLLM local files must be GGUF; otherwise select a model directory.")
        self._placement_options(placement)
        self._load_options(options)

    @staticmethod
    def _tensor_parallel_size(value: Any) -> int:
        """Translate AI Dream's tensor-split field to vLLM tensor parallelism.

        ``2`` means two ranks. A llama.cpp-style equal split such as ``1,1`` or
        ``50,50`` is also accepted and maps to two ranks. Unequal splits are
        rejected because vLLM tensor parallelism does not represent arbitrary
        per-device weight ratios.
        """
        if isinstance(value, bool):
            raise ValueError("tensor_split must describe a tensor-parallel size")
        text = str(value).strip()
        if re.fullmatch(r"[1-9]\d*", text):
            return int(text)
        pieces = [piece.strip() for piece in text.split(",")]
        if len(pieces) < 2 or any(not re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)", p) for p in pieces):
            raise ValueError("tensor_split must be a positive rank count or equal comma-separated split")
        weights = [float(piece) for piece in pieces]
        if any(weight <= 0 for weight in weights) or any(abs(weight - weights[0]) > 1e-9 for weight in weights[1:]):
            raise ValueError("vLLM supports equal tensor-parallel ranks, not asymmetric tensor_split weights")
        return len(weights)

    def _placement_options(self, placement: Any) -> list[str]:
        if placement is None:
            return []
        if isinstance(placement, str):
            placement = {"device": placement}
        if not isinstance(placement, Mapping):
            raise ValueError("placement must be a mapping, device selection, or None")

        caps = self.capabilities()
        unknown = set(placement) - {"device", "tensor_split"}
        if unknown:
            raise ValueError(
                "vLLM does not support AI Dream placement setting(s): " + ", ".join(sorted(unknown)))

        result: list[str] = []
        if "device" in placement:
            if not caps.device_selection:
                raise ValueError("This vLLM version does not advertise --device-ids")
            device = str(placement["device"]).strip()
            if not device or "\x00" in device or not re.fullmatch(r"[A-Za-z0-9_.:,\-]+", device):
                raise ValueError("device must be a comma-separated list of GPU IDs or UUIDs")
            result.extend(("--device-ids", device))
        if "tensor_split" in placement:
            if not caps.tensor_split:
                raise ValueError("This vLLM version does not advertise tensor parallelism")
            result.extend(("--tensor-parallel-size", str(self._tensor_parallel_size(placement["tensor_split"]))))
        return result

    def _load_options(self, options: Mapping[str, Any] | None) -> list[str]:
        if options is None:
            return []
        if not isinstance(options, Mapping):
            raise ValueError("load options must be a mapping")
        supported = {"context_size", "max_concurrent"}
        unknown = set(options) - supported
        if unknown:
            raise ValueError(
                "vLLM does not support AI Dream load option(s): " + ", ".join(sorted(unknown)))
        caps = self.capabilities()
        result: list[str] = []
        if "context_size" in options:
            if not caps.context_size:
                raise ValueError("This vLLM version does not advertise --max-model-len")
            result.extend(("--max-model-len", str(_positive_int(options["context_size"], "context_size"))))
        if "max_concurrent" in options:
            if not caps.max_concurrent:
                raise ValueError("This vLLM version does not advertise --max-num-seqs")
            result.extend(("--max-num-seqs", str(_positive_int(options["max_concurrent"], "max_concurrent"))))
        return result

    def effective_command(self, model: Any, placement: Any = None,
                          options: Mapping[str, Any] | None = None, *,
                          port: int | None = None) -> list[str]:
        self.validate_load(model, placement, options)
        selected_port = port if port is not None else (self.port or self._free_port())
        path = self._path(model)
        assert path is not None
        return [self.executable, "serve", str(path.resolve()), "--host", "127.0.0.1",
                "--port", str(selected_port), *self._placement_options(placement),
                *self._load_options(options)]
