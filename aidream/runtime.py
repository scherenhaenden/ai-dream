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
import threading
import time
from typing import Any, Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ToolCallsUnsupported(RuntimeError):
    """The loaded server does not accept the OpenAI tools request format."""


class GenerationCancelled(RuntimeError):
    """Raised when a streaming generation is cancelled by the user."""


@dataclass(frozen=True)
class BackendCapabilities:
    """Runtime availability and placement controls advertised by llama-server."""
    available: bool
    executable: str | None
    gpu_layers: bool = False
    device_selection: bool = False
    tensor_split: bool = False
    details: str = ""
    context_size: bool = False
    threads: bool = False
    batch_size: bool = False
    chat_completions: bool = False
    fit: bool = False
    reasoning: bool = False


class InferenceBackend(Protocol):
    name: str
    def capabilities(self) -> BackendCapabilities: ...
    def can_load(self, model: Any) -> bool: ...
    def load(self, model: Any, placement: Any = None, options: Mapping[str, Any] | None = None) -> None: ...
    def generate(self, prompt: str, options: Mapping[str, Any] | None = None) -> str: ...
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
        self._messages: list[dict[str, Any]] = []
        self._active_response = None
        self._active_socket = None
        self._response_lock = threading.Lock()
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
        return BackendCapabilities(
            True, self.executable, gpu, device, split,
            "A persistent server process holds the model until unload. Runtime controls reflect flags advertised by this executable.",
            "-c" in self._help or "--ctx-size" in self._help,
            "-t" in self._help or "--threads" in self._help,
            "-b" in self._help or "--batch-size" in self._help,
            ("/v1/chat/completions" in self._help or "chat completions" in self._help.lower()
             or Path(self.executable).name in self.candidates),
            "--fit" in self._help,
            "--reasoning" in self._help,
        )

    @staticmethod
    def _path(model: Any) -> Path | None:
        candidate = getattr(model, "path", model)
        try:
            return Path(os.fspath(candidate)).expanduser()
        except TypeError:
            return None

    def can_load(self, model: Any) -> bool:
        path = self._path(model)
        metadata = getattr(model, "metadata", {})
        architecture = metadata.get("general.architecture") if isinstance(metadata, Mapping) else None
        # Vision projector GGUFs are catalogued for pairing, but are not chat models.
        if architecture == "clip" or (path and path.name.lower().startswith("mmproj-")):
            return False
        return bool(self.capabilities().available and path and path.is_file() and path.suffix.lower() == ".gguf")

    def restore_history(self, messages: list[Mapping[str, str]]) -> None:
        """Restore saved turns into the active server conversation context."""
        if not self._process or self._process.poll() is not None or self._loaded_model is None:
            raise RuntimeError("Load a model before restoring conversation history")
        restored: list[dict[str, str]] = []
        for item in messages:
            if not isinstance(item, Mapping) or item.get("role") not in {"system", "user", "assistant"}:
                raise ValueError("history entries must have a system, user, or assistant role")
            content = item.get("content")
            if not isinstance(content, str) or not content.strip():
                raise ValueError("history message content cannot be empty")
            restored.append({"role": item["role"], "content": content})
        self._messages = restored

    def validate_load(self, model: Any, placement: Any = None,
                      options: Mapping[str, Any] | None = None) -> None:
        """Validate a proposed model/device configuration without starting a process."""
        caps = self.capabilities()
        if not caps.available:
            raise RuntimeError(caps.details or "No usable llama.cpp server is available")
        path = self._path(model)
        metadata = getattr(model, "metadata", {})
        architecture = metadata.get("general.architecture") if isinstance(metadata, Mapping) else None
        if path and (architecture == "clip" or path.name.lower().startswith("mmproj-")):
            raise ValueError("This GGUF is a vision projector, not a standalone chat model. Select its compatible base model.")
        if not path or not path.is_file() or path.suffix.lower() != ".gguf":
            raise ValueError("Select an existing GGUF chat model.")
        self._load_options(options)
        self._placement_options(placement)

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

    def _load_options(self, options: Mapping[str, Any] | None) -> list[str]:
        if options is None:
            return []
        if not isinstance(options, Mapping):
            raise ValueError("load options must be a mapping")
        caps, result = self.capabilities(), []
        specs = (("context_size", caps.context_size, ("-c", "--ctx-size")),
                 ("threads", caps.threads, ("-t", "--threads")),
                 ("batch_size", caps.batch_size, ("-b", "--batch-size")))
        for key, supported, flags in specs:
            if key not in options:
                continue
            if not supported:
                raise ValueError(f"This llama.cpp server does not advertise {key}")
            value = _positive_int(options[key], key)
            flag = next((f for f in flags if f in self._help), flags[0])
            result.extend((flag, str(value)))
        if "fit" in options:
            if not caps.fit:
                raise ValueError("This llama.cpp server does not advertise fit")
            fit = options["fit"]
            if not isinstance(fit, bool):
                raise ValueError("fit must be a boolean")
            result.extend(("--fit", "on" if fit else "off"))
        if "reasoning" in options:
            if not caps.reasoning:
                raise ValueError("This llama.cpp server does not advertise reasoning controls")
            reasoning = options["reasoning"]
            if not isinstance(reasoning, bool):
                raise ValueError("reasoning must be a boolean")
            result.extend(("--reasoning", "on" if reasoning else "off"))
        unknown = set(options) - {key for key, _, _ in specs} - {"fit", "reasoning"}
        if unknown:
            raise ValueError(f"Unsupported load option(s): {', '.join(sorted(unknown))}")
        return result

    def load(self, model: Any, placement: Any = None, options: Mapping[str, Any] | None = None) -> None:
        self.validate_load(model, placement, options)
        path = self._path(model)
        self.unload()
        runtime_options = self._load_options(options)
        placement_options = self._placement_options(placement)
        # llama.cpp auto-fit may abort on certain multi-GPU explicit tensor splits.
        # The supported server CLI can safely run with fit disabled in that case.
        if (isinstance(placement, Mapping) and placement.get("tensor_split") is not None
                and not (options and "fit" in options) and self.capabilities().fit):
            runtime_options.extend(("--fit", "off"))
        port = self.port or self._free_port()
        self._log = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
        command = [self.executable, "-m", str(path.resolve()), "--host", "127.0.0.1", "--port", str(port), *placement_options, *runtime_options]
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
                        self._placement = placement_options + runtime_options
                        self._messages = []
                        return
            except (OSError, URLError):
                time.sleep(0.1)
        self.unload()
        raise RuntimeError("Timed out waiting for llama-server readiness")

    def generate(self, prompt: str, options: Mapping[str, Any] | None = None) -> str:
        chunks: list[str] = []
        self.generate_stream(prompt, options, on_delta=chunks.append)
        return "".join(chunks)

    def cancel_generation(self) -> None:
        """Interrupt an in-flight stream; a partial turn is discarded."""
        with self._response_lock:
            active_socket = self._active_socket
        if active_socket is not None:
            try:
                active_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def generate_stream(self, prompt: str, options: Mapping[str, Any] | None = None,
                        on_delta=None, cancel_event: threading.Event | None = None) -> str:
        if cancel_event is not None and cancel_event.is_set():
            raise GenerationCancelled("Generation stopped")
        if not self._process or self._process.poll() is not None or self._loaded_model is None or not self._base_url:
            raise RuntimeError("No model is loaded")
        opts = {} if options is None else options
        if not isinstance(opts, Mapping):
            raise ValueError("generation options must be a mapping")
        unknown = set(opts) - {"temperature", "max_tokens", "system_prompt", "stop", "images"}
        if unknown:
            raise ValueError(f"Unsupported generation option(s): {', '.join(sorted(unknown))}")
        if not self.capabilities().chat_completions:
            raise ValueError("This llama.cpp server does not advertise the chat completions endpoint")
        temperature = opts.get("temperature", 0.7)
        if isinstance(temperature, bool) or not isinstance(temperature, (int, float)) or temperature < 0:
            raise ValueError("temperature must be a non-negative number")
        payload_messages = list(self._messages)
        system_prompt = opts.get("system_prompt")
        if system_prompt is not None:
            if not isinstance(system_prompt, str):
                raise ValueError("system_prompt must be a string")
            if system_prompt:
                if payload_messages and payload_messages[0]["role"] == "system":
                    payload_messages[0] = {"role": "system", "content": system_prompt}
                else:
                    payload_messages.insert(0, {"role": "system", "content": system_prompt})
        if not isinstance(prompt, str):
            raise ValueError("prompt must be a string")
        images = opts.get("images", [])
        if not isinstance(images, (list, tuple)):
            raise ValueError("images must be a list of validated local attachments")
        if images:
            from aidream.image_input import ImageAttachment, build_multimodal_message
            if not all(isinstance(image, ImageAttachment) for image in images):
                raise ValueError("images must contain validated local attachments")
            user_message = build_multimodal_message(prompt, images)
        else:
            user_message = {"role": "user", "content": prompt}
        payload_messages.append(user_message)
        payload = {"messages": payload_messages, "temperature": temperature, "stream": True}
        if "max_tokens" in opts:
            payload["max_tokens"] = _positive_int(opts["max_tokens"], "max_tokens")
        if "stop" in opts:
            stop = opts["stop"]
            if isinstance(stop, str):
                stop = [stop]
            if not isinstance(stop, (list, tuple)) or not all(isinstance(x, str) for x in stop):
                raise ValueError("stop must be a string or a list of strings")
            payload["stop"] = list(stop)
        self._messages.append(user_message)
        request = Request(self._base_url + "/v1/chat/completions", data=json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        answer_parts: list[str] = []
        try:
            with urlopen(request, timeout=self.timeout) as response:
                with self._response_lock:
                    self._active_response = response
                    self._active_socket = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
                answer = self._read_stream(response, cancel_event, answer_parts, on_delta)
        except GenerationCancelled:
            self._messages.pop()
            raise
        except (OSError, URLError, ValueError, KeyError, IndexError, TypeError, socket.timeout) as exc:
            self._messages.pop()
            if cancel_event is not None and cancel_event.is_set():
                raise GenerationCancelled("Generation stopped") from exc
            raise RuntimeError(f"llama-server generation failed: {exc}") from exc
        finally:
            with self._response_lock:
                self._active_response = None
                self._active_socket = None
        self._messages.append({"role": "assistant", "content": answer})
        return answer

    @staticmethod
    def _read_stream(response, cancel_event, answer_parts, on_delta) -> str:
        data_lines: list[str] = []
        while True:
            if cancel_event is not None and cancel_event.is_set():
                raise GenerationCancelled("Generation stopped")
            raw_line = response.readline()
            if not raw_line:
                if cancel_event is not None and cancel_event.is_set():
                    raise GenerationCancelled("Generation stopped")
                break
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                if data_lines:
                    payload = "\n".join(data_lines)
                    data_lines.clear()
                    if payload == "[DONE]":
                        break
                    event = json.loads(payload)
                    choices = event.get("choices") or []
                    if choices:
                        delta = (choices[0].get("delta") or {}).get("content")
                        if isinstance(delta, str) and delta:
                            answer_parts.append(delta)
                            if on_delta:
                                on_delta(delta)
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        answer = "".join(answer_parts)
        if not answer:
            raise RuntimeError("llama-server returned an empty streaming response")
        return answer

    def chat_with_tools(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]],
                        timeout: float | None = None) -> dict[str, Any]:
        """Make one OpenAI-compatible tool-call turn without mutating chat history.

        The caller owns the bounded conversation. Only the model response is
        returned; tool execution remains in the caller's allow-listed registry.
        """
        if not self._process or self._process.poll() is not None or not self._base_url:
            raise RuntimeError("No model is loaded")
        payload = {"messages": messages, "tools": tools, "tool_choice": "auto"}
        request = Request(self._base_url + "/v1/chat/completions", data=json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        try:
            response = urlopen(request, timeout=timeout or self.timeout)
            with self._response_lock:
                self._active_response = response
                self._active_socket = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
            try:
                with response:
                    raw_response = response.read(1_048_577)
            finally:
                with self._response_lock:
                    self._active_response = None
                    self._active_socket = None
            if len(raw_response) > 1_048_576:
                raise RuntimeError("llama-server tool-call response exceeded 1 MiB")
            data = json.loads(raw_response.decode("utf-8"))
        except (HTTPError, URLError, OSError, ValueError) as exc:
            # llama.cpp releases without tool-call request support typically
            # reject the `tools` field as an invalid request (HTTP 400/404/422).
            status = getattr(exc, "code", None)
            if status in (400, 404, 422):
                raise ToolCallsUnsupported(f"llama-server rejected tool calls: {exc}") from exc
            raise RuntimeError(f"llama-server tool-call request failed: {exc}") from exc
        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("llama-server returned an invalid tool-call response") from exc
        if not isinstance(message, dict):
            raise RuntimeError("llama-server returned an invalid tool-call message")
        return message

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


def _positive_int(value: Any, name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a positive integer")
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a positive integer") from exc
    if result <= 0 or result != value:
        raise ValueError(f"{name} must be a positive integer")
    return result
