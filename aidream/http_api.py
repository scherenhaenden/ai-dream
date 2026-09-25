"""Local JSON HTTP adapter with fixed snapshot and chat endpoints.

The server binds only IPv4 loopback. Writes are limited to local chat creation
and model generation through the existing, catalog-backed application services.
"""
from __future__ import annotations

from dataclasses import asdict, is_dataclass
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import select
from pathlib import Path
import mimetypes
import socket
import threading
import time
from typing import Any
from urllib.parse import parse_qs, unquote_to_bytes, urlsplit
import uuid

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
MAX_STATIC_FILE_BYTES = 32 * 1024 * 1024
MAX_HUB_QUERY_CHARS = 200
MAX_DOWNLOAD_JOBS = 8
AGENT_AUDIT_PREFIX = "[[AI_DREAM_AGENT_AUDIT]]"


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

    def __init__(self, *, hardware=None, catalog=None, runtimes=None, chat_store=None, hub=None, download_dir=None):
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
        if hub is None:
            from aidream.huggingface import HuggingFaceDownloader
            hub = HuggingFaceDownloader()
        self.hub = hub
        data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")).expanduser()
        self.download_dir = Path(download_dir) if download_dir else data_home / "ai-dream" / "models"
        self._downloads: dict[str, dict[str, Any]] = {}
        self._download_lock = threading.Lock()
        self._download_changed = threading.Condition(self._download_lock)
        self._download_worker_active = False
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
        public_messages = []
        agent_audits = []
        total_chars = 0
        for item in messages:
            content = item.get("content", "")
            if item.get("role") == "system" and isinstance(content, str) and content.startswith(AGENT_AUDIT_PREFIX):
                try:
                    audit = json.loads(content[len(AGENT_AUDIT_PREFIX):])
                    if isinstance(audit, dict) and isinstance(audit.get("tools"), list):
                        tools = []
                        for tool in audit["tools"][:12]:
                            if not isinstance(tool, dict):
                                continue
                            names = tool.get("argument_names", [])
                            names = names[:16] if isinstance(names, list) else []
                            tools.append({
                                "name": str(tool.get("name", ""))[:80],
                                "status": str(tool.get("status", ""))[:32],
                                "result_snippet": str(tool.get("result_snippet", ""))[:240],
                                "sequence": min(max(int(tool.get("sequence", 0)), 0), 12),
                                "duration_ms": min(max(int(tool.get("duration_ms", 0)), 0), 120_000),
                                "argument_names": [str(name)[:80] for name in names],
                                "result_bytes": min(max(int(tool.get("result_bytes", 0)), 0), 1_048_576),
                            })
                        agent_audits.append({
                            "tools": tools,
                            "tool_call_count": min(max(int(audit.get("tool_call_count", 0)), 0), 12),
                            "elapsed_seconds": round(min(max(float(audit.get("elapsed_seconds", 0)), 0), 120), 3),
                            "stop_reason": str(audit.get("stop_reason", ""))[:64],
                            "tool_calls_supported": bool(audit.get("tool_calls_supported", False)),
                        })
                except (TypeError, ValueError, OverflowError):
                    pass
                continue
            if len(public_messages) >= MAX_TRANSCRIPT_MESSAGES:
                raise APIError("This chat exceeds the browser transcript limit")
            total_chars += len(content)
            if total_chars > MAX_TRANSCRIPT_CHARS:
                raise APILimit("This chat exceeds the browser transcript size limit")
            public_messages.append({"role": item.get("role"), "content": content,
                                   "created_at": item.get("created_at", "")})
        return {**ReadOnlyAPI._public_summary(session), "messages": public_messages,
                "agent_audits": agent_audits[-24:]}

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

    def prepare_agent(self, chat_id: str, model_id: str, prompt: str):
        """Prepare a bounded read-only LocalAgent turn on the shared model lock."""
        from aidream.agent_api import prepare_agent
        return prepare_agent(self, chat_id, model_id, prompt)

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
        if path == "/api/downloads":
            with self._download_lock:
                return 200, {"data": {"downloads": [self._public_download(item) for item in self._downloads.values()]}}
        match = re.fullmatch(r"/api/downloads/([a-f0-9]{32})", path)
        if match:
            item = self._download_snapshot(match.group(1))
            return 200, {"data": {"download": item}}
        return 404, {"error": "Not found"}

    @staticmethod
    def _public_download(job):
        return {key: job.get(key) for key in ("id", "repo_id", "file_name", "status", "received", "total", "path", "error")}

    @staticmethod
    def _download_api_state(job):
        states = {"queued": "queued", "downloading": "downloading", "cancelling": "cancelling",
                  "complete": "complete", "failed": "failed", "cancelled": "cancelled"}
        result = {"id": job["id"], "state": states.get(job["status"], "failed"),
                  "downloaded_bytes": job.get("received", 0), "file_name": job.get("file_name")}
        if job.get("total") is not None:
            result["total_bytes"] = job["total"]
            result["progress"] = min(100.0, job["received"] * 100.0 / max(1, job["total"]))
        else:
            result["progress"] = None
        if job.get("error"):
            result["error"] = job["error"]
        return result

    def _download_snapshot(self, job_id):
        with self._download_lock:
            item = self._downloads.get(job_id)
            if item is None:
                raise APINotFound("Download job not found")
            return self._public_download(item)

    def hub_search(self, query: str, limit: int):
        if len(query) > MAX_HUB_QUERY_CHARS:
            raise APIError("Search text is too long")
        try:
            models = self.hub.search(query, limit)
        except (ValueError, RuntimeError) as exc:
            raise APIError(str(exc)) from exc
        return {"data": {"items": [_jsonable(model) for model in models]}}

    def hub_files(self, repo_id: str, revision: str):
        try:
            repo_id = self.hub.validate_repo_id(repo_id)
            files = self.hub.list_gguf_files(repo_id, revision)
            details = self.hub.repository_details(repo_id)
        except (ValueError, RuntimeError) as exc:
            raise APIError(str(exc)) from exc
        return {"data": {"repo_id": repo_id, "repo": _jsonable(details),
                          "files": [{"file_name": name} for name in files], "revision": revision}}

    def create_download(self, repo_id: str, file_name: str, revision: str):
        try:
            repo_id = self.hub.validate_repo_id(repo_id)
            file_name = self.hub.validate_file(file_name)
            if not re.fullmatch(r"[A-Za-z0-9._/-]{1,128}", revision) or ".." in revision.split("/"):
                raise ValueError("Invalid repository revision.")
        except ValueError as exc:
            raise APIError(str(exc)) from exc
        with self._download_lock:
            if self._download_worker_active:
                raise APIError("Another model download is active")
            if len(self._downloads) >= MAX_DOWNLOAD_JOBS:
                completed = [key for key, job in self._downloads.items() if job["status"] in {"complete", "failed", "cancelled"}]
                for key in completed:
                    self._downloads.pop(key, None)
            if len(self._downloads) >= MAX_DOWNLOAD_JOBS:
                raise APIError("Download job limit reached")
            self.download_dir.mkdir(parents=True, exist_ok=True)
            if self.download_dir.is_symlink() or not self.download_dir.resolve().is_dir():
                raise APIError("Application model directory is not a safe directory")
            job_id = uuid.uuid4().hex
            cancel = threading.Event()
            job = {"id": job_id, "repo_id": repo_id, "file_name": file_name, "status": "queued",
                   "received": 0, "total": None, "path": None, "error": None, "cancel": cancel,
                   "revision": revision}
            self._downloads[job_id] = job
            self._download_worker_active = True
            self._download_changed.notify_all()
        threading.Thread(target=self._run_download, args=(job_id,), daemon=True,
                         name=f"ai-dream-download-{job_id[:8]}").start()
        return self._download_api_state(job)

    def _run_download(self, job_id):
        from aidream.huggingface import DownloadCancelledError
        with self._download_lock:
            job = self._downloads.get(job_id)
            if job is None:
                self._download_worker_active = False
                return
            job["status"] = "downloading"
            cancel = job["cancel"]
            revision = job["revision"]
            self._download_changed.notify_all()
        def progress(received, total):
            with self._download_lock:
                current = self._downloads.get(job_id)
                if current is not None:
                    current["received"], current["total"] = received, total
                    self._download_changed.notify_all()
        try:
            path = self.hub.download(job["repo_id"], job["file_name"], self.download_dir,
                                     progress=progress, revision=revision, cancel_event=cancel)
            self.catalog.add_source(self.download_dir)
            with self._download_lock:
                job["status"], job["path"] = "complete", str(path)
                self._download_changed.notify_all()
        except DownloadCancelledError:
            with self._download_lock:
                job["status"] = "cancelled"
                self._download_changed.notify_all()
        except (OSError, RuntimeError, ValueError) as exc:
            with self._download_lock:
                job["status"], job["error"] = "failed", str(exc)[:240]
                self._download_changed.notify_all()
        finally:
            with self._download_lock:
                self._download_worker_active = False
                self._download_changed.notify_all()

    def cancel_download(self, job_id):
        with self._download_lock:
            job = self._downloads.get(job_id)
            if job is None:
                raise APINotFound("Download job not found")
            if job["status"] in {"queued", "downloading"}:
                job["cancel"].set()
                job["status"] = "cancelling"
                self._download_changed.notify_all()
            return self._download_api_state(job)


def default_web_dist() -> Path:
    """Return the bundled Angular production directory beside the Python package."""
    return Path(__file__).resolve().parent.parent / "web" / "dist"


def create_server(port: int = DEFAULT_PORT, *, api: ReadOnlyAPI | None = None,
                  static_root: str | Path | None = None) -> ThreadingHTTPServer:
    """Create a loopback server; optionally add a contained SPA static root."""
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("port must be an integer between 0 and 65535")
    services = api or ReadOnlyAPI()
    web_root = None
    if static_root is not None:
        try:
            supplied_root = Path(static_root).expanduser()
            if supplied_root.is_symlink():
                raise ValueError("web/dist must not be a symbolic link")
            web_root = supplied_root.resolve(strict=True)
            index_path = web_root / "index.html"
            if index_path.is_symlink():
                raise ValueError("web/dist/index.html must not be a symbolic link")
            index_file = index_path.resolve(strict=True)
            if (not web_root.is_dir() or not index_file.is_file()
                    or index_file.parent != web_root):
                raise ValueError("web/dist must contain a regular index.html")
        except OSError as exc:
            raise ValueError(f"Angular build is missing at {Path(static_root) / 'index.html'}; build web/dist first") from exc
        except RuntimeError as exc:
            raise ValueError("Angular build index.html must stay inside web/dist") from exc
        server_static_root = web_root
    else:
        server_static_root = None

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
            if parsed.fragment:
                self._send_json(400, {"error": "Fragments are not supported"})
                return
            if parsed.path == "/api" or parsed.path.startswith("/api/"):
                if (parsed.path != self.path.split("?", 1)[0]
                        or (parsed.query and parsed.path != "/api/hub/search" and "/api/hub/repos/" not in parsed.path)):
                    self._send_json(400, {"error": "Query strings are not supported for this API path"})
                    return
                if parsed.path == "/api/hub/search":
                    self._serve_hub_search(parsed.query)
                elif parsed.path.startswith("/api/hub/repos/") and parsed.path.endswith("/files"):
                    self._serve_hub_files(parsed.path, parsed.query)
                elif re.fullmatch(r"/api/downloads/[a-f0-9]{32}/events", parsed.path):
                    self._serve_download_events(parsed.path.split("/")[3])
                else:
                    if parsed.query:
                        self._send_json(400, {"error": "Query strings are not supported for this API path"})
                        return
                    self._serve_api(parsed.path)
                return
            if server_static_root is not None:
                self._serve_static(parsed.path)
                return
            if parsed.query or parsed.path != self.path:
                self._send_json(400, {"error": "Query strings and encoded paths are not supported"})
                return
            self._serve_api(parsed.path)

        def _serve_api(self, path):
            if not self.server._service_slots.acquire(blocking=False):
                self._send_json(503, {"error": "Local API is busy"})
                return
            future = self.server._service_pool.submit(self.server.services.get, path)
            future.add_done_callback(lambda _future: self.server._service_slots.release())
            try:
                status, payload = future.result(timeout=SERVICE_TIMEOUT_SECONDS)
                self._send_json(status, payload)
            except FutureTimeout:
                self._send_json(504, {"error": "Local service request timed out"})
            except (OSError, RuntimeError, ValueError, TypeError):
                self._send_json(503, {"error": "Local service is temporarily unavailable"})

        def _serve_hub_search(self, query):
            try:
                params = parse_qs(query, keep_blank_values=True, strict_parsing=False)
                if set(params) - {"q", "limit"} or any(len(values) != 1 for values in params.values()):
                    raise APIError("Only one q and limit value are accepted")
                text = params.get("q", [""])[0]
                limit_text = params.get("limit", ["30"])[0]
                if not limit_text.isascii() or not limit_text.isdigit() or len(limit_text) > 3:
                    raise APIError("limit must be between 1 and 100")
                status, value = 200, self.server.services.hub_search(text, int(limit_text))
                self._send_json(status, value)
            except APIError as exc:
                self._send_json(exc.status, {"error": str(exc)})
            except (OSError, RuntimeError, ValueError, TypeError):
                self._send_json(503, {"error": "Hugging Face is temporarily unavailable"})

        def _serve_hub_files(self, path, query):
            try:
                params = parse_qs(query, keep_blank_values=True, strict_parsing=False)
                if set(params) - {"revision"} or any(len(values) != 1 for values in params.values()):
                    raise APIError("Only one revision value is accepted")
                revision = params.get("revision", ["main"])[0]
                encoded_repo = path[len("/api/hub/repos/"):-len("/files")].rstrip("/")
                repo_id = unquote_to_bytes(encoded_repo).decode("utf-8")
                value = self.server.services.hub_files(repo_id, revision)
                self._send_json(200, value)
            except (UnicodeDecodeError, APIError) as exc:
                self._send_json(getattr(exc, "status", 400), {"error": str(exc)})
            except (OSError, RuntimeError, ValueError, TypeError):
                self._send_json(503, {"error": "Hugging Face is temporarily unavailable"})

        def _serve_download_events(self, job_id):
            try:
                self.server.services._download_snapshot(job_id)
            except APIError as exc:
                self._send_json(exc.status, {"error": str(exc)})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Accel-Buffering", "no")
            self._write_cors_headers()
            self.send_header("Connection", "close")
            self.end_headers()
            last_payload = None
            terminal = {"complete", "failed", "cancelled"}
            try:
                while True:
                    with self.server.services._download_changed:
                        job = self.server.services._downloads.get(job_id)
                        if job is None:
                            break
                        payload = self.server.services._download_api_state(job)
                        status = job["status"]
                        if payload != last_payload:
                            last_payload = payload
                        else:
                            self.server.services._download_changed.wait(timeout=0.5)
                            job = self.server.services._downloads.get(job_id)
                            if job is None:
                                break
                            payload = self.server.services._download_api_state(job)
                            status = job["status"]
                            if payload == last_payload:
                                try:
                                    readable, _, _ = select.select([self.connection], [], [], 0)
                                    if readable and self.connection.recv(1, socket.MSG_PEEK) == b"":
                                        return
                                    self.wfile.write(b": keep-alive\n\n")
                                    self.wfile.flush()
                                except (OSError, socket.timeout):
                                    return
                                continue
                    if payload != last_payload:
                        last_payload = payload
                    try:
                        self._send_event("progress", payload)
                    except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
                        return
                    if status in terminal:
                        return
            finally:
                self.close_connection = True

        def _serve_static(self, request_path: str):
            try:
                decoded = unquote_to_bytes(request_path).decode("utf-8")
            except (UnicodeDecodeError, ValueError):
                self._send_static_error(400)
                return
            if "\x00" in decoded or "\\" in decoded:
                self._send_static_error(404)
                return
            segments = decoded.split("/")
            if any(segment in {".", ".."} for segment in segments):
                self._send_static_error(404)
                return
            if any(segment.startswith(".") for segment in segments if segment):
                self._send_static_error(404)
                return
            relative = decoded.lstrip("/")
            if not relative:
                relative = "index.html"
            candidate = server_static_root.joinpath(*relative.split("/"))
            target = None
            try:
                target = candidate.resolve(strict=True)
                target.relative_to(server_static_root)
                if not target.is_file():
                    target = None
            except (OSError, RuntimeError, ValueError):
                target = None
            if target is None:
                # SPA route fallback applies only to extensionless routes, never API
                # paths, assets, dotfiles or traversal attempts.
                leaf = segments[-1] if segments else ""
                if (not leaf or leaf.startswith(".") or Path(leaf).suffix
                        or relative.startswith("assets/")):
                    self._send_static_error(404)
                    return
                target = server_static_root / "index.html"
            try:
                stat = target.stat()
                if stat.st_size > MAX_STATIC_FILE_BYTES:
                    self._send_static_error(413)
                    return
                body = target.read_bytes()
            except OSError:
                self._send_static_error(404)
                return
            content_type, _encoding = mimetypes.guess_type(target.name, strict=True)
            if target.suffix.lower() in {".js", ".mjs"}:
                content_type = "application/javascript"
            content_type = content_type or "application/octet-stream"
            if content_type.startswith("text/") or content_type in {"application/javascript", "application/json", "image/svg+xml"}:
                content_type += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", self._static_cache_control(target))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                             "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; "
                             "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
            self._write_cors_headers()
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                if not getattr(self, "_head_only", False):
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass
            self.close_connection = True

        @staticmethod
        def _static_cache_control(target: Path) -> str:
            if target.name == "index.html":
                return "no-cache"
            fingerprinted = re.search(r"[.-][A-Za-z0-9_-]{8,}[.-]", target.name)
            if target.parent.name == "assets" or fingerprinted:
                return "public, max-age=31536000, immutable"
            return "no-cache"

        def _send_static_error(self, status: int):
            body = b"Not found\n" if status == 404 else b"Bad request\n" if status == 400 else b"File too large\n"
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self._write_cors_headers()
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                if not getattr(self, "_head_only", False):
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass
            self.close_connection = True

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
            if self.path == "/api/agent":
                self._post_agent()
                return
            cancel_match = re.fullmatch(r"/api/downloads/([a-f0-9]{32})/cancel", self.path)
            if cancel_match:
                try:
                    item = self.server.services.cancel_download(cancel_match.group(1))
                    self._send_json(200, {"data": item})
                except APIError as exc:
                    self._send_json(exc.status, {"error": str(exc)})
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
            if self.path == "/api/downloads":
                try:
                    body = self._read_json_body()
                    if set(body) - {"repo_id", "file_name", "revision"} or not {"repo_id", "file_name"} <= set(body):
                        raise APIError("repo_id and file_name are required")
                    if any(not isinstance(body.get(key), str) for key in ("repo_id", "file_name")):
                        raise APIError("repo_id and file_name must be strings")
                    revision = body.get("revision", "main")
                    if not isinstance(revision, str):
                        raise APIError("revision must be a string")
                    result = self.server.services.create_download(body["repo_id"], body["file_name"], revision)
                    self._send_json(202, {"data": result})
                except (APIError, ValueError) as exc:
                    self._send_json(getattr(exc, "status", 400), {"error": str(exc)})
                except OSError:
                    self._send_json(503, {"error": "Could not prepare the application model directory"})
                return
            self._reject_write()

        def do_PUT(self):
            self._reject_write()

        def do_PATCH(self):
            self._reject_write()

        def do_DELETE(self):
            if not self._valid_host():
                self._send_json(400, {"error": "Invalid Host header"})
                return
            if not self._write_origin_ok():
                self._send_json(403, {"error": "A permitted Origin is required"})
                return
            match = re.fullmatch(r"/api/downloads/([a-f0-9]{32})/cancel", self.path)
            if not match:
                self._reject_write()
                return
            try:
                item = self.server.services.cancel_download(match.group(1))
                self._send_json(200, {"data": item})
            except APIError as exc:
                self._send_json(exc.status, {"error": str(exc)})

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

        def _post_agent(self):
            """Run the fixed read-only agent loop and return bounded audit via SSE."""
            try:
                body = self._read_json_body()
            except APIError as exc:
                self._send_json(exc.status, {"error": str(exc)})
                return
            if set(body) != {"chat_id", "model_id", "prompt"}:
                self._send_json(400, {"error": "chat_id, model_id and prompt are required"})
                return
            if any(not isinstance(body.get(key), str) for key in ("chat_id", "model_id", "prompt")):
                self._send_json(400, {"error": "chat_id, model_id and prompt must be strings"})
                return
            if not body["prompt"].strip() or len(body["prompt"]) > MAX_PROMPT_CHARS:
                self._send_json(400, {"error": f"prompt must contain 1 to {MAX_PROMPT_CHARS} characters"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Accel-Buffering", "no")
            self._write_cors_headers()
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.flush()
            cancel = threading.Event()
            disconnected = threading.Event()
            finished = threading.Event()
            run_ref = {"run": None}
            write_lock = threading.Lock()

            def cancel_run():
                disconnected.set()
                cancel.set()
                run = run_ref["run"]
                if run is not None:
                    cancel_backend = getattr(run.backend, "cancel_generation", None)
                    if callable(cancel_backend):
                        cancel_backend()

            def monitor_disconnect():
                heartbeat = time.monotonic()
                while not finished.wait(0.1):
                    try:
                        readable, _, _ = select.select([self.connection], [], [], 0)
                        if readable and self.connection.recv(1, socket.MSG_PEEK) == b"":
                            cancel_run()
                            return
                        if time.monotonic() - heartbeat >= 0.75:
                            with write_lock:
                                self.wfile.write(b": keep-alive\n\n")
                                self.wfile.flush()
                            heartbeat = time.monotonic()
                    except (OSError, ValueError, socket.timeout):
                        cancel_run()
                        return

            watcher = threading.Thread(target=monitor_disconnect, daemon=True)
            watcher.start()
            run = None
            try:
                self._send_event("status", {"status": "running", "message": "Checking local model and read-only tools…"})
                run = self.server.services.prepare_agent(body["chat_id"], body["model_id"], body["prompt"])
                run_ref["run"] = run
                if cancel.is_set():
                    cancel_run()
                result = run.run(cancel)
                if not cancel.is_set():
                    # result contains at most 12k response chars and the agent's
                    # bounded, value-redacted audit summary.
                    self._send_event("complete", result)
            except Exception as exc:
                if not disconnected.is_set():
                    safe_error = str(exc) if isinstance(exc, APIError) else "Local agent request failed"
                    try:
                        self._send_event("error", {"error": safe_error[:240]})
                    except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
                        cancel_run()
            finally:
                finished.set()
                watcher.join(timeout=0.5)
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
            if self.path not in {"/api/chat", "/api/agent", "/api/chats", "/api/downloads"} and not re.fullmatch(r"/api/downloads/[a-f0-9]{32}/cancel", self.path):
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


def serve_web(port: int = DEFAULT_PORT) -> None:
    """Serve the bundled Angular build and API from one same-origin loopback URL."""
    web_root = default_web_dist()
    if not (web_root / "index.html").is_file():
        raise RuntimeError(f"Angular production build is missing: {web_root / 'index.html'}; run the web build first")
    server = create_server(port, static_root=web_root)
    url = f"http://{LOOPBACK_HOST}:{server.server_address[1]}"
    print(f"AI Dream Web listening at {url}")
    try:
        import webbrowser
        if not webbrowser.open(url, new=2):
            print(f"Open this address in your browser: {url}")
    except (OSError, RuntimeError):
        print(f"Open this address in your browser: {url}")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def serve(port: int = DEFAULT_PORT) -> None:
    server = create_server(port)
    try:
        print(f"AI Dream local API listening at http://{LOOPBACK_HOST}:{server.server_address[1]}")
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
