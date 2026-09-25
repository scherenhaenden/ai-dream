"""Local JSON HTTP adapter with fixed snapshot and chat endpoints.

The server binds only IPv4 loopback. Writes are limited to local chat creation
and model generation through the existing, catalog-backed application services.
"""
from __future__ import annotations

from dataclasses import asdict, is_dataclass
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import select
from pathlib import Path
import socket
import threading
import time
from typing import Any
from urllib.parse import urlsplit

LOOPBACK_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_MODELS = 1000
SOCKET_TIMEOUT_SECONDS = 8
SERVICE_TIMEOUT_SECONDS = 6
MAX_CONCURRENT_REQUESTS = 8
MAX_SERVICE_WORKERS = 4
ANGULAR_DEV_ORIGIN = "http://127.0.0.1:5173"
CHAT_ID_RE = re.compile(r"[a-f0-9]{32}\Z")
MAX_CHATS = 200
MAX_CHAT_FILE_BYTES = 2 * 1024 * 1024
MAX_TRANSCRIPT_MESSAGES = 100
MAX_TRANSCRIPT_CHARS = 256 * 1024
MAX_HISTORY_MESSAGES = 32
MAX_HISTORY_CHARS = 32_768
MAX_REQUEST_BYTES = 32 * 1024
MAX_PROMPT_CHARS = 8_000
MAX_CHAT_OUTPUT_CHARS = 64 * 1024


def _jsonable(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return _jsonable(value.to_dict())
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "__dict__"):
        return _jsonable(vars(value))
    return str(value)


class _BoundedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, services):
        self.services = services
        self._slots = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)
        self._service_slots = threading.BoundedSemaphore(MAX_SERVICE_WORKERS)
        self._service_pool = ThreadPoolExecutor(max_workers=MAX_SERVICE_WORKERS, thread_name_prefix="ai-dream-api")
        super().__init__(address, handler)
        self.timeout = SOCKET_TIMEOUT_SECONDS
        self.request_queue_size = MAX_CONCURRENT_REQUESTS

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


class APIError(ValueError):
    """An expected request or local chat precondition failure."""
    status = 400


class APINotFound(APIError):
    status = 404


class APILimit(APIError):
    status = 413


class ChatRun:
    """Owns one serialized runtime generation and releases its backend/lock."""

    def __init__(self, api, backend, session_id: str, prompt: str):
        self.api = api
        self.backend = backend
        self.session_id = session_id
        self.prompt = prompt
        self._closed = False

    def generate(self, on_delta, cancel_event: threading.Event):
        if cancel_event.is_set():
            from aidream.runtime import GenerationCancelled
            raise GenerationCancelled("generation was cancelled")
        response = self.backend.generate_stream(
            self.prompt, on_delta=on_delta, cancel_event=cancel_event)
        self.api.chat_store.append(self.session_id, "user", self.prompt)
        session = self.api.chat_store.append(self.session_id, "assistant", response)
        return {"chat_id": self.session_id, "assistant": response,
                "session_id": session["id"]}

    def close(self):
        if not self._closed:
            self._closed = True
            self.api._chat_lock.release()


class ReadOnlyAPI:
    """HTTP adapter backed by the existing local catalog, chat and runtime services."""

    def __init__(self, *, hardware=None, catalog=None, runtimes=None, chat_store=None):
        if hardware is None:
            from aidream.hardware import HardwareService
            hardware = HardwareService()
        if catalog is None:
            from aidream.models import ModelCatalog
            catalog = ModelCatalog()
        if runtimes is None:
            from aidream.runtime import RuntimeRegistry
            runtimes = RuntimeRegistry()
        if chat_store is None:
            from aidream.conversation import ChatStore
            chat_store = ChatStore()
        self.hardware = hardware
        self.catalog = catalog
        self.runtimes = runtimes
        self.chat_store = chat_store
        self._chat_lock = threading.Lock()
        self._active_backend = None
        self._active_binding = None
        self._closed = False

    @staticmethod
    def _public_summary(session):
        return {key: session.get(key, "") for key in ("id", "title", "created_at", "updated_at")}

    @staticmethod
    def public_transcript(session):
        messages = session.get("messages", [])
        if len(messages) > MAX_TRANSCRIPT_MESSAGES:
            raise APIError("This chat exceeds the browser transcript limit")
        public_messages = []
        total_chars = 0
        for item in messages:
            content = item.get("content", "")
            total_chars += len(content)
            if total_chars > MAX_TRANSCRIPT_CHARS:
                raise APILimit("This chat exceeds the browser transcript size limit")
            public_messages.append({"role": item.get("role"), "content": content,
                                   "created_at": item.get("created_at", "")})
        return {**ReadOnlyAPI._public_summary(session), "messages": public_messages}

    def _safe_load_chat(self, chat_id: str):
        if not isinstance(chat_id, str) or not CHAT_ID_RE.fullmatch(chat_id):
            raise APIError("Invalid chat id")
        path = self.chat_store._path(chat_id)
        try:
            root = self.chat_store.directory.resolve(strict=True)
            if path.is_symlink() or path.resolve(strict=True).parent != root:
                raise APINotFound("Chat not found")
            if path.stat().st_size > MAX_CHAT_FILE_BYTES:
                raise APILimit("This chat exceeds the local API size limit")
            return self.chat_store.load(chat_id)
        except FileNotFoundError as exc:
            raise APINotFound("Chat not found") from exc

    def list_chats(self):
        # Scan only regular, bounded, in-directory JSON files. This avoids following
        # chat-file symlinks as well as exposing settings and attachment paths.
        root = self.chat_store.directory.resolve(strict=True)
        ids = []
        for index, path in enumerate(root.glob("*.json")):
            if index >= MAX_CHATS * 5:
                break
            if not CHAT_ID_RE.fullmatch(path.stem) or path.is_symlink():
                continue
            try:
                if path.resolve(strict=True).parent != root or path.stat().st_size > MAX_CHAT_FILE_BYTES:
                    continue
                ids.append(path.stem)
            except OSError:
                continue
        sessions = []
        for chat_id in ids:
            try:
                sessions.append(self._safe_load_chat(chat_id))
            except (APIError, OSError, ValueError, TypeError):
                continue
        sessions.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return {"data": {"chats": [self._public_summary(item) for item in sessions[:MAX_CHATS]]}}

    def create_chat(self, title: str = "New chat"):
        if not isinstance(title, str) or len(title) > 120:
            raise APIError("title must be at most 120 characters")
        session = self.chat_store.create(title)
        return {"data": {"chat": self._public_summary(session)}}

    def get_chat(self, chat_id: str):
        return {"data": {"chat": self.public_transcript(self._safe_load_chat(chat_id))}}

    def prepare_chat(self, chat_id: str, model_id: str, prompt: str) -> ChatRun:
        if self._closed:
            raise APIError("Local chat service is shutting down")
        if not isinstance(chat_id, str) or not CHAT_ID_RE.fullmatch(chat_id):
            raise APIError("Invalid chat id")
        if not isinstance(model_id, str) or not 1 <= len(model_id) <= 256:
            raise APIError("Invalid model id")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise APIError(f"prompt must contain 1 to {MAX_PROMPT_CHARS} characters")
        if not self._chat_lock.acquire(blocking=False):
            raise APIError("Another local chat request is active")
        try:
            session = self._safe_load_chat(chat_id)
            models = self.catalog.list_models()
            if len(models) > MAX_MODELS:
                raise APIError("Local model catalog exceeds the API limit")
            model = next((item for item in models if getattr(item, "id", None) == model_id), None)
            if model is None:
                raise APIError("Model id was not found in the local catalog")
            backends = self.runtimes.list_backends()
            backend = next((item for item in backends
                            if item.capabilities().available and item.can_load(model)
                            and callable(getattr(item, "generate_stream", None))), None)
            if backend is None:
                raise APIError("No available local streaming runtime can load this model")
            binding = (id(backend), model_id, chat_id)
            active_healthy = self._active_binding == binding
            process = getattr(backend, "_process", None)
            if hasattr(backend, "_process"):
                active_healthy = (active_healthy and process is not None and process.poll() is None
                                  and getattr(backend, "_loaded_model", None) is not None)
            if not active_healthy:
                self._unload_active()
                history = []
                total = 0
                messages = session.get("messages", [])
                if not isinstance(messages, list):
                    raise APIError("Invalid chat history")
                for item in reversed(messages):
                    role, content = item.get("role"), item.get("content")
                    if role not in {"user", "assistant"} or not isinstance(content, str) or not content.strip():
                        continue
                    cost = len(content)
                    if len(history) >= MAX_HISTORY_MESSAGES or total + cost > MAX_HISTORY_CHARS:
                        break
                    history_item = {"role": role, "content": content}
                    # These references come only from the persisted local chat;
                    # callers cannot submit or modify them through this API.
                    if item.get("attachments"):
                        history_item["attachments"] = item["attachments"]
                    history.append(history_item)
                    total += cost
                history.reverse()
                backend.load(model)
                try:
                    backend.restore_history(history)
                except Exception:
                    backend.unload()
                    raise
                self._active_backend = backend
                self._active_binding = binding
            return ChatRun(self, backend, chat_id, prompt.strip())
        except APIError:
            self._chat_lock.release()
            raise
        except (OSError, RuntimeError, ValueError, TypeError) as exc:
            self._chat_lock.release()
            raise APIError("Local model could not be loaded") from exc

    def _unload_active(self):
        backend = self._active_backend
        self._active_backend = None
        self._active_binding = None
        if backend is not None:
            backend.unload()

    def close(self):
        """Unload the retained local model when the HTTP service shuts down."""
        with self._chat_lock:
            self._unload_active()
            self._closed = True

    def get(self, path: str) -> tuple[int, dict[str, Any]]:
        if path == "/api/health":
            return 200, {"data": {"status": "ok", "service": "ai-dream"}}
        if path == "/api/hardware":
            return 200, {"data": {"hardware": _jsonable(self.hardware.detect())}}
        if path == "/api/models":
            records = self.catalog.list_models()
            if len(records) > MAX_MODELS:
                return 413, {"error": f"Model catalog exceeds the {MAX_MODELS} item API limit"}
            return 200, {"data": {"models": [_jsonable(model) for model in records]}}
        if path == "/api/chats":
            return 200, self.list_chats()
        match = re.fullmatch(r"/api/chats/([a-f0-9]{32})", path)
        if match:
            try:
                return 200, self.get_chat(match.group(1))
            except APIError as exc:
                return exc.status, {"error": str(exc)}
        if path == "/api/runtime":
            backends = []
            for backend in self.runtimes.list_backends():
                capabilities = backend.capabilities()
                backends.append({"name": str(backend.name), "capabilities": _jsonable(capabilities),
                                 "available": bool(capabilities.available)})
            return 200, {"data": {"backends": backends}}
        return 404, {"error": "Not found"}


def create_server(port: int = DEFAULT_PORT, *, api: ReadOnlyAPI | None = None) -> ThreadingHTTPServer:
    """Create an API server on 127.0.0.1 only. Port 0 is useful for local tests."""
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("port must be an integer between 0 and 65535")
    services = api or ReadOnlyAPI()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "AI-Dream-Local-API"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(SOCKET_TIMEOUT_SECONDS)

        def log_message(self, fmt, *args):
            # Avoid logging browser-supplied values or local paths by default.
            return

        def _send_json(self, status: int, value: Any):
            body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(body) > MAX_RESPONSE_BYTES:
                status = 413
                body = b'{"error":"Response exceeds the local API size limit"}'
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self._write_cors_headers()
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                if not getattr(self, "_head_only", False):
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass
            self.close_connection = True

        def _valid_host(self) -> bool:
            supplied = self.headers.get("Host", "")
            port_text = str(self.server.server_address[1])
            return supplied.lower() in {f"127.0.0.1:{port_text}", f"localhost:{port_text}"}

        def _allowed_origin(self) -> str | None:
            origin = self.headers.get("Origin")
            if origin is None:
                return None
            if origin == ANGULAR_DEV_ORIGIN:
                return origin
            supplied_host = self.headers.get("Host", "").lower()
            if origin in {f"http://{supplied_host}"}:
                return origin
            return ""

        def _origin_ok(self) -> bool:
            return self._allowed_origin() != ""

        def _write_cors_headers(self):
            origin = self._allowed_origin()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        def do_GET(self):
            if not self._valid_host():
                self._send_json(400, {"error": "Invalid Host header"})
                return
            if not self._origin_ok():
                self._send_json(403, {"error": "Origin is not allowed"})
                return
            parsed = urlsplit(self.path)
            if parsed.query or parsed.fragment or parsed.path != self.path:
                self._send_json(400, {"error": "Query strings and encoded paths are not supported"})
                return
            if not self.server._service_slots.acquire(blocking=False):
                self._send_json(503, {"error": "Local API is busy"})
                return
            future = self.server._service_pool.submit(self.server.services.get, parsed.path)
            future.add_done_callback(lambda _future: self.server._service_slots.release())
            try:
                status, payload = future.result(timeout=SERVICE_TIMEOUT_SECONDS)
                self._send_json(status, payload)
            except FutureTimeout:
                self._send_json(504, {"error": "Local service request timed out"})
            except (OSError, RuntimeError, ValueError, TypeError):
                self._send_json(503, {"error": "Local service is temporarily unavailable"})

        def do_HEAD(self):
            # HEAD shares the fixed path/status lookup but suppresses the body.
            self._head_only = True
            try:
                self.do_GET()
            finally:
                self._head_only = False

        def do_POST(self):
            if not self._valid_host():
                self._send_json(400, {"error": "Invalid Host header"})
                return
            if not self._write_origin_ok():
                self._send_json(403, {"error": "A permitted Origin is required"})
                return
            parsed = urlsplit(self.path)
            if parsed.query or parsed.fragment or parsed.path != self.path:
                self._send_json(400, {"error": "Query strings and encoded paths are not supported"})
                return
            if self.path == "/api/chat":
                self._post_chat()
                return
            if self.path == "/api/chats":
                try:
                    body = self._read_json_body()
                    if set(body) - {"title"}:
                        raise APIError("Only the title field is accepted")
                    result = self.server.services.create_chat(body.get("title", "New chat"))
                    self._send_json(201, result)
                except (APIError, ValueError) as exc:
                    self._send_json(getattr(exc, "status", 400), {"error": str(exc)})
                except OSError:
                    self._send_json(503, {"error": "Could not create a local chat"})
                return
            self._reject_write()

        def do_PUT(self):
            self._reject_write()

        def do_PATCH(self):
            self._reject_write()

        def do_DELETE(self):
            self._reject_write()

        def do_TRACE(self):
            self._reject_write()

        def do_CONNECT(self):
            self._reject_write()

        def _write_origin_ok(self) -> bool:
            origin = self._allowed_origin()
            return bool(origin)

        def _read_json_body(self):
            if self.headers.get("Transfer-Encoding"):
                raise APIError("Chunked request bodies are not supported")
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                raise APIError("Content-Type must be application/json")
            raw_length = self.headers.get("Content-Length")
            if raw_length is None or not raw_length.isascii() or not raw_length.isdigit():
                raise APIError("Content-Length is required")
            if len(raw_length) > 6:
                raise APILimit("Request body exceeds the local API limit")
            length = int(raw_length)
            if length > MAX_REQUEST_BYTES:
                raise APILimit("Request body exceeds the local API limit")
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise APIError("Request body was incomplete")
                value = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise APIError("Request body must contain valid UTF-8 JSON") from exc
            if not isinstance(value, dict):
                raise APIError("Request body must be a JSON object")
            return value

        def _send_event(self, name: str, payload: dict[str, Any]):
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            self.wfile.write(f"event: {name}\ndata: {data}\n\n".encode("utf-8"))
            self.wfile.flush()

        def _post_chat(self):
            try:
                body = self._read_json_body()
            except APIError as exc:
                self._send_json(exc.status, {"error": str(exc)})
                return
            if set(body) != {"chat_id", "model_id", "prompt"}:
                self._send_json(400, {"error": "chat_id, model_id and prompt are required"})
                return
            if (not isinstance(body.get("chat_id"), str) or not isinstance(body.get("model_id"), str)
                    or not isinstance(body.get("prompt"), str)):
                self._send_json(400, {"error": "chat_id, model_id and prompt must be strings"})
                return
            if len(body["prompt"]) > MAX_PROMPT_CHARS or not body["prompt"].strip():
                self._send_json(400, {"error": f"prompt must contain 1 to {MAX_PROMPT_CHARS} characters"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Access-Control-Expose-Headers", "Content-Type")
            self._write_cors_headers()
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.flush()

            cancel = threading.Event()
            disconnected = threading.Event()
            response_limited = threading.Event()
            finished = threading.Event()
            run_ref = {"run": None}
            stream_write_lock = threading.Lock()

            def cancel_backend():
                disconnected.set()
                cancel.set()
                run = run_ref["run"]
                if run is not None:
                    cancel_generation = getattr(run.backend, "cancel_generation", None)
                    if callable(cancel_generation):
                        cancel_generation()

            def emit_event(name, payload):
                with stream_write_lock:
                    self._send_event(name, payload)

            def watch_disconnect():
                last_heartbeat = time.monotonic()
                while not finished.wait(0.1):
                    try:
                        readable, _, _ = select.select([self.connection], [], [], 0)
                        if readable and self.connection.recv(1, socket.MSG_PEEK) == b"":
                            cancel_backend()
                            return
                        if time.monotonic() - last_heartbeat >= 0.75:
                            with stream_write_lock:
                                self.wfile.write(b": keep-alive\n\n")
                                self.wfile.flush()
                            last_heartbeat = time.monotonic()
                    except (OSError, ValueError, socket.timeout):
                        cancel_backend()
                        return

            monitor = threading.Thread(target=watch_disconnect, daemon=True)
            monitor.start()
            run = None
            emitted_chars = 0
            try:
                run = self.server.services.prepare_chat(body["chat_id"], body["model_id"], body["prompt"])
                run_ref["run"] = run
                if cancel.is_set():
                    cancel_generation = getattr(run.backend, "cancel_generation", None)
                    if callable(cancel_generation):
                        cancel_generation()
                def on_delta(text):
                    nonlocal emitted_chars
                    if cancel.is_set():
                        from aidream.runtime import GenerationCancelled
                        raise GenerationCancelled("client disconnected")
                    emitted_chars += len(text)
                    if emitted_chars > MAX_CHAT_OUTPUT_CHARS:
                        response_limited.set()
                        cancel.set()
                        cancel_generation = getattr(run.backend, "cancel_generation", None)
                        if callable(cancel_generation):
                            cancel_generation()
                        from aidream.runtime import GenerationCancelled
                        raise GenerationCancelled("response exceeded limit")
                    emit_event("delta", {"text": text})
                result = run.generate(on_delta, cancel)
                if not cancel.is_set():
                    emit_event("complete", result)
            except Exception as exc:
                if not disconnected.is_set():
                    if response_limited.is_set():
                        safe_error = "Model response exceeded the local API output limit"
                    else:
                        safe_error = str(exc) if isinstance(exc, APIError) else "Local model request failed"
                    try:
                        emit_event("error", {"error": safe_error[:240]})
                    except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
                        cancel_backend()
            finally:
                finished.set()
                monitor.join(timeout=0.5)
                if run is not None:
                    run.close()
                self.close_connection = True

        def _reject_write(self):
            # Unsupported write methods never read or act on the request body.
            if not self._valid_host():
                self._send_json(400, {"error": "Invalid Host header"})
                return
            if not self._origin_ok():
                self._send_json(403, {"error": "Origin is not allowed"})
                return
            self.send_response(405)
            self.send_header("Allow", "GET, HEAD, OPTIONS")
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True

        def do_OPTIONS(self):
            if not self._valid_host():
                self._send_json(400, {"error": "Invalid Host header"})
                return
            if not self._write_origin_ok():
                self._send_json(403, {"error": "A permitted Origin is required"})
                return
            if self.path not in {"/api/chat", "/api/chats"}:
                self._send_json(404, {"error": "Not found"})
                return
            self.send_response(204)
            self.send_header("Allow", "POST, OPTIONS")
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self._write_cors_headers()
            self.end_headers()

    server = _BoundedHTTPServer((LOOPBACK_HOST, port), Handler, services)
    original_close = server.server_close

    def close():
        original_close()
        server._service_pool.shutdown(wait=False, cancel_futures=True)
        close_api = getattr(server.services, "close", None)
        if callable(close_api):
            close_api()

    server.server_close = close
    return server


def serve(port: int = DEFAULT_PORT) -> None:
    server = create_server(port)
    try:
        print(f"AI Dream local API listening at http://{LOOPBACK_HOST}:{server.server_address[1]}")
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
