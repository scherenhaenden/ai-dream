"""Persistent subprocess-backed inference using a local llama.cpp server."""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from typing import Any, Mapping, Protocol
from urllib.error import URLError
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class BackendCapabilities:
    """Runtime availability and placement controls advertised by llama-server."""
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
    """Manage one persistent llama-server process and its OpenAI-compatible API."""
    name = "llama.cpp"
    candidates = ("llama-server", "server")

    def __init__(self, executable: str | None = None, timeout: float = 180.0,
                 startup_timeout: float = 60.0, port: int | None = None):
        self.executable = executable or next((shutil.which(n) for n in self.candidates if shutil.which(n)), None)
        self.timeout = timeout
        self.startup_timeout = startup_timeout
        self.port = port
        self._process: subprocess.Popen | None = None
        self._log = None
        self._base_url: str | None = None
        self._loaded_model: Path | None = None
        self._placement: list[str] = []
        self._messages: list[dict[str, str]] = []
        self._help = self._read_help() if self.executable else ""

    def _read_help(self) -> str:
        try:
            result = subprocess.run([self.executable, "--help"], capture_output=True, text=True, timeout=10)
            return result.stdout + result.stderr
        except (OSError, subprocess.SubprocessError):
            return ""

    def capabilities(self) -> BackendCapabilities:
        if not self.executable:
            return BackendCapabilities(False, None, details="No llama.cpp server found on PATH (looked for llama-server, server).")
        if not self._help:
            return BackendCapabilities(False, self.executable, details="Server executable found, but --help failed; interface could not be verified.")
        gpu = "-ngl" in self._help or "--n-gpu-layers" in self._help
        device = "--device" in self._help
        split = "--tensor-split" in self._help or "--tensor_split" in self._help
        return BackendCapabilities(True, self.executable, gpu, device, split,
            "A persistent server process holds the model until unload. Placement reflects flags advertised by this executable.")

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

    def _placement_options(self, placement: Any) -> list[str]:
        if placement is None:
            return []
        if isinstance(placement, str):
            placement = {"device": placement}
        if not isinstance(placement, Mapping):
            raise ValueError("placement must be a mapping, device name, or None")
        caps, opts = self.capabilities(), []
        for key, supported, flag in (
            ("gpu_layers", caps.gpu_layers, "-ngl"),
            ("device", caps.device_selection, "--device"),
            ("tensor_split", caps.tensor_split, "--tensor-split"),
        ):
            if key in placement:
                if not supported:
                    raise ValueError(f"This llama.cpp server does not advertise {key} placement")
                value = int(placement[key]) if key == "gpu_layers" else str(placement[key])
                opts.extend([flag, str(value)])
        unknown = set(placement) - {"gpu_layers", "device", "tensor_split"}
        if unknown:
            raise ValueError(f"Unsupported placement setting(s): {', '.join(sorted(unknown))}")
        return opts

    @staticmethod
    def _free_port() -> int:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def load(self, model: Any, placement: Any = None) -> None:
        path = self._path(model)
        if not self.can_load(model):
            raise ValueError("llama.cpp server can load only an existing GGUF model when available")
        self.unload()
        options = self._placement_options(placement)
        port = self.port or self._free_port()
        self._log = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
        command = [self.executable, "-m", str(path.resolve()), "--host", "127.0.0.1", "--port", str(port), *options]
        try:
            self._process = subprocess.Popen(command, stdout=self._log, stderr=subprocess.STDOUT, text=True)
        except OSError:
            self._close_log()
            raise
        self._base_url = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                log_text = self._log_text()
                self.unload()
                raise RuntimeError(f"llama-server exited during startup: {log_text}")
            try:
                with urlopen(self._base_url + "/health", timeout=0.5) as response:
                    if 200 <= response.status < 300:
                        self._loaded_model = path.resolve()
                        self._placement = options
                        self._messages = []
                        return
            except (OSError, URLError):
                time.sleep(0.1)
        self.unload()
        raise RuntimeError("Timed out waiting for llama-server readiness")

    def generate(self, prompt: str) -> str:
        if not self._process or self._process.poll() is not None or self._loaded_model is None or not self._base_url:
            raise RuntimeError("No model is loaded")
        self._messages.append({"role": "user", "content": prompt})
        payload = json.dumps({"messages": self._messages, "temperature": 0.7}).encode()
        request = Request(self._base_url + "/v1/chat/completions", data=payload,
                          headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            answer = data["choices"][0]["message"]["content"]
        except (OSError, URLError, ValueError, KeyError, IndexError, TypeError) as exc:
            self._messages.pop()
            raise RuntimeError(f"llama-server generation failed: {exc}") from exc
        self._messages.append({"role": "assistant", "content": answer})
        return answer

    def _log_text(self) -> str:
        if not self._log:
            return ""
        self._log.flush()
        self._log.seek(0)
        return self._log.read().strip()[-4000:]

    def _close_log(self) -> None:
        if self._log:
            self._log.close()
            self._log = None

    def unload(self) -> None:
        """Stop the server and release its model; safe to call repeatedly."""
        process = self._process
        self._process = None
        self._base_url = None
        self._loaded_model = None
        self._placement = []
        self._messages = []
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        self._close_log()


class RuntimeRegistry:
    """Registry for supported local inference backends."""
    def __init__(self, backends: list[InferenceBackend] | None = None):
        self._backends = backends if backends is not None else [LlamaCppBackend()]
    def list_backends(self) -> list[InferenceBackend]:
        return list(self._backends)
