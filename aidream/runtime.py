"""Persistent subprocess-backed inference using a local llama.cpp server."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
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
    split_mode: bool = False
    main_gpu: bool = False
    physical_batch_size: bool = False
    max_concurrent: bool = False
    flash_attention: bool = False
    unified_kv_cache: bool = False
    offload_kv_cache: bool = False
    mmap: bool = False
    keep_model_in_memory: bool = False
    threads_batch: bool = False
    continuous_batching: bool = False
    numa: bool = False
    kv_cache_type_k: bool = False
    kv_cache_type_v: bool = False
    device_listing: bool = False
    mlock: bool = False
    mmap_disable: bool = False


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
                 startup_timeout: float = 60.0, port: int | None = None, *,
                 runtime_id: str | None = None, name: str | None = None):
        self.runtime_id = runtime_id
        self.name = name or type(self).name
        self.executable = executable or next((shutil.which(n) for n in self.candidates if shutil.which(n)), None)
        self.timeout = timeout
        self.startup_timeout = startup_timeout
        self.port = port
        self._process: subprocess.Popen | None = None
        self._log = None
        self._base_url: str | None = None
        self._loaded_model: Path | None = None
        self._placement: list[str] = []
        self._effective_command: list[str] = []
        self._loaded_at: float | None = None
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
        has = lambda *flags: any(re.search(r"(?<![\w-])" + re.escape(flag) + r"(?![\w-])", self._help) for flag in flags)
        gpu = has("-ngl", "--n-gpu-layers")
        device = has("--device")
        split = has("--tensor-split", "--tensor_split")
        return BackendCapabilities(
            True, self.executable, gpu, device, split,
            "A persistent server process holds the model until unload. Runtime controls reflect flags advertised by this executable.",
            "-c" in self._help or "--ctx-size" in self._help,
            "-t" in self._help or "--threads" in self._help,
            "-b" in self._help or "--batch-size" in self._help,
            ("/v1/chat/completions" in self._help or "chat completions" in self._help.lower()
             or Path(self.executable).name in self.candidates),
            has("--fit"),
            has("--reasoning"),
            has("--split-mode"), has("--main-gpu"), has("-ub", "--ubatch-size"),
            has("-np", "--parallel"), has("-fa", "--flash-attn"),
            has("--kv-unified"), has("--no-kv-offload"),
            has("--mmap", "--no-mmap"), has("--mlock"),
            has("-tb", "--threads-batch"), has("--cont-batching", "--continuous-batching", "--no-cont-batching"), has("--numa"),
            has("-ctk", "--cache-type-k"), has("-ctv", "--cache-type-v"),
            has("--list-devices", "--list_devices"),
            has("--mlock"),
            has("--no-mmap"),
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

    def restore_history(self, messages: list[Mapping[str, Any]]) -> None:
        """Restore saved turns into the active server conversation context."""
        if not self._process or self._process.poll() is not None or self._loaded_model is None:
            raise RuntimeError("Load a model before restoring conversation history")
        restored: list[dict[str, Any]] = []
        for item in messages:
            if (not isinstance(item, Mapping) or not isinstance(item.get("role"), str)
                    or item.get("role") not in {"system", "user", "assistant"}):
                raise ValueError("history entries must have a system, user, or assistant role")
            content = item.get("content")
            if not isinstance(content, str) or not content.strip():
                raise ValueError("history message content cannot be empty")
            role = item["role"]
            message: dict[str, Any] = {"role": role, "content": content}
            refs = item.get("attachments", [])
            if refs:
                try:
                    from aidream.conversation import validate_attachment_references
                    references = validate_attachment_references(refs)
                except (ImportError, ValueError, TypeError):
                    references = []
                images = []
                documents = []
                from aidream.document_input import build_document_prompt, load_document_attachment
                from aidream.image_input import load_image_attachment
                for ref in references:
                    try:
                        path = Path(ref["path"]).resolve(strict=True)
                        stat = path.stat()
                        if (not path.is_file() or stat.st_size != ref["size_bytes"]
                                or stat.st_mtime_ns != ref["mtime_ns"]):
                            continue
                        maximum = 8 * 1024 * 1024 if ref["kind"] == "image" else 5 * 1024 * 1024
                        with path.open("rb") as stream:
                            data = stream.read(maximum + 1)
                        if len(data) > maximum or hashlib.sha256(data).hexdigest() != ref["sha256"]:
                            continue
                        if ref["kind"] == "image":
                            images.append(load_image_attachment(path))
                        else:
                            documents.append(load_document_attachment(path))
                    except (OSError, RuntimeError, ValueError, TypeError):
                        # A removed, changed, or no-longer-supported attachment
                        # should not make the rest of a saved chat unusable.
                        continue
                if documents:
                    try:
                        message["content"] = build_document_prompt(content, documents)
                    except ValueError:
                        # Over-limit or invalid documents are omitted as a group.
                        pass
                if images and role in {"user", "system"}:
                    try:
                        from aidream.image_input import build_multimodal_message
                        message = build_multimodal_message(message["content"], images, role=role)
                    except ValueError:
                        # Keep plain text if historical images cannot be restored.
                        pass
            restored.append(message)
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
            ("split_mode", caps.split_mode, "--split-mode"),
            ("main_gpu", caps.main_gpu, "--main-gpu"),
        ):
            if key in placement:
                if not supported:
                    raise ValueError(f"This llama.cpp server does not advertise {key} placement")
                if key == "main_gpu":
                    raw = placement[key]
                    if isinstance(raw, bool) or not str(raw).isdigit():
                        raise ValueError("main_gpu must be a non-negative integer")
                    value = int(raw)
                else:
                    value = int(placement[key]) if key == "gpu_layers" else str(placement[key])
                if key == "split_mode" and (not value or any(ch.isspace() for ch in value) or "\x00" in value):
                    raise ValueError("split_mode must be a single non-empty mode name")
                opts.extend([flag, str(value)])
        unknown = set(placement) - {"gpu_layers", "device", "tensor_split", "split_mode", "main_gpu"}
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
                 ("batch_size", caps.batch_size, ("-b", "--batch-size")),
                 ("physical_batch_size", caps.physical_batch_size, ("-ub", "--ubatch-size")),
                 ("max_concurrent", caps.max_concurrent, ("-np", "--parallel")),
                 ("threads_batch", caps.threads_batch, ("-tb", "--threads-batch")))
        for key, supported, flags in specs:
            if key not in options:
                continue
            if not supported:
                raise ValueError(f"This llama.cpp server does not advertise {key}")
            value = _positive_int(options[key], key)
            flag = next((f for f in flags if re.search(r"(?<![\w-])" + re.escape(f) + r"(?![\w-])", self._help)), flags[0])
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
        for key, supported, flags in (
            ("kv_cache_type_k", caps.kv_cache_type_k, ("-ctk", "--cache-type-k")),
            ("kv_cache_type_v", caps.kv_cache_type_v, ("-ctv", "--cache-type-v")),
            ("numa", caps.numa, ("--numa",)),
        ):
            if key not in options:
                continue
            if not supported:
                raise ValueError(f"This llama.cpp server does not advertise {key}")
            value = options[key]
            if not isinstance(value, str) or not value or any(ch.isspace() for ch in value) or "\x00" in value:
                raise ValueError(f"{key} must be a single non-empty value")
            flag = next((candidate for candidate in flags if re.search(
                r"(?<![\w-])" + re.escape(candidate) + r"(?![\w-])", self._help)), flags[-1])
            result.extend((flag, value))
        bool_flags = {
            "flash_attention": (caps.flash_attention, ("-fa", "--flash-attn"), "value"),
            "unified_kv_cache": (caps.unified_kv_cache, ("--kv-unified",), "true"),
            "offload_kv_cache": (caps.offload_kv_cache, ("--no-kv-offload",), "false"),
            "mmap": (caps.mmap, ("--mmap", "--no-mmap"), "mmap"),
            "keep_model_in_memory": (caps.keep_model_in_memory, ("--mlock",), "true"),
        }
        for key, (supported, flags, behavior) in bool_flags.items():
            if key not in options:
                continue
            if not supported:
                raise ValueError(f"This llama.cpp server does not advertise {key}")
            value = options[key]
            if not isinstance(value, bool):
                raise ValueError(f"{key} must be a boolean")
            chosen = next((flag for flag in flags if re.search(r"(?<![\w-])" + re.escape(flag) + r"(?![\w-])", self._help)), flags[0])
            if behavior == "value":
                result.extend((chosen, "on" if value else "off"))
            elif behavior == "false" and not value:
                result.append(chosen)
            elif behavior == "true" and value:
                result.append(chosen)
            elif behavior == "mmap" and not value:
                if caps.mmap_disable:
                    result.append("--no-mmap")
                else:
                    raise ValueError("This llama.cpp server cannot disable mmap")
        if "continuous_batching" in options:
            if not caps.continuous_batching:
                raise ValueError("This llama.cpp server does not advertise continuous_batching")
            if not isinstance(options["continuous_batching"], bool):
                raise ValueError("continuous_batching must be a boolean")
            if options["continuous_batching"]:
                flag = next((candidate for candidate in ("--cont-batching", "--continuous-batching")
                             if re.search(r"(?<![\w-])" + re.escape(candidate) + r"(?![\w-])", self._help)), None)
                if flag is None:
                    raise ValueError("This llama.cpp server cannot enable continuous batching")
                result.append(flag)
            elif re.search(r"(?<![\w-])--no-cont-batching(?![\w-])", self._help):
                result.append("--no-cont-batching")
            else:
                raise ValueError("This llama.cpp server cannot disable continuous batching")
        unknown = (set(options) - {key for key, _, _ in specs}
                   - {"fit", "reasoning", *bool_flags, "continuous_batching", "numa",
                      "kv_cache_type_k", "kv_cache_type_v"})
        if unknown:
            raise ValueError(f"Unsupported load option(s): {', '.join(sorted(unknown))}")
        return result

    def effective_command(self, model: Any, placement: Any = None,
                          options: Mapping[str, Any] | None = None, *, port: int | None = None) -> list[str]:
        """Return the exact argv for a load, including AI Dream's automatic fit default."""
        self.validate_load(model, placement, options)
        runtime_options = self._load_options(options)
        if (isinstance(placement, Mapping) and placement.get("tensor_split") is not None
                and not (options and "fit" in options) and self.capabilities().fit):
            runtime_options.extend(("--fit", "off"))
        selected_port = port if port is not None else (self.port or self._free_port())
        path = self._path(model)
        return [self.executable, "-m", str(path.resolve()), "--host", "127.0.0.1", "--port",
                str(selected_port), *self._placement_options(placement), *runtime_options]

    def status(self) -> dict[str, Any]:
        """Describe the current persistent server state for UI/API status views."""
        running = bool(self._process and self._process.poll() is None and self._loaded_model)
        return {"loaded": running, "model_path": str(self._loaded_model) if running else None,
                "placement": list(self._placement) if running else [],
                "command": list(self._effective_command) if running else [],
                "uptime_seconds": max(0.0, time.monotonic() - self._loaded_at) if running and self._loaded_at else None}

    def load(self, model: Any, placement: Any = None, options: Mapping[str, Any] | None = None) -> None:
        self.validate_load(model, placement, options)
        path = self._path(model)
        self.unload()
        command = self.effective_command(model, placement, options)
        self._log = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
        try:
            self._process = subprocess.Popen(command, stdout=self._log, stderr=subprocess.STDOUT, text=True)
        except OSError:
            self._close_log()
            raise
        command_port = command[command.index("--port") + 1]
        self._base_url = f"http://127.0.0.1:{command_port}"
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
                        self._placement = command[command.index("--port") + 2:]
                        self._effective_command = list(command)
                        self._loaded_at = time.monotonic()
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
        unknown = set(opts) - {"temperature", "max_tokens", "system_prompt", "stop", "images",
                               "top_p", "top_k", "min_p", "repeat_penalty", "seed"}
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
        for key in ("top_p", "min_p", "repeat_penalty"):
            if key in opts:
                value = opts[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                    raise ValueError(f"{key} must be a non-negative number")
                payload[key] = value
        if "top_k" in opts:
            payload["top_k"] = _positive_int(opts["top_k"], "top_k")
        if "seed" in opts:
            seed = opts["seed"]
            if isinstance(seed, bool) or not isinstance(seed, int):
                raise ValueError("seed must be an integer")
            payload["seed"] = seed
        if "structured_output" in opts:
            response_format = opts["structured_output"]
            if not isinstance(response_format, Mapping):
                raise ValueError("structured_output must be an object")
            try:
                json.dumps(response_format, allow_nan=False)
            except (TypeError, ValueError) as exc:
                raise ValueError("structured_output must contain JSON values") from exc
            payload["response_format"] = dict(response_format)
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
        self._effective_command = []
        self._loaded_at = None
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
