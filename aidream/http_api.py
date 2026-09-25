"""Read-only JSON HTTP adapter for local UI clients.

The server binds only IPv4 loopback and exposes a fixed set of GET endpoints.
It does not accept request bodies or perform filesystem mutations.
"""
from __future__ import annotations

from dataclasses import asdict, is_dataclass
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
import threading
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


class ReadOnlyAPI:
    """Fixed read-only snapshot endpoints backed by existing application services."""

    def __init__(self, *, hardware=None, catalog=None, runtimes=None):
        if hardware is None:
            from aidream.hardware import HardwareService
            hardware = HardwareService()
        if catalog is None:
            from aidream.models import ModelCatalog
            catalog = ModelCatalog()
        if runtimes is None:
            from aidream.runtime import RuntimeRegistry
            runtimes = RuntimeRegistry()
        self.hardware = hardware
        self.catalog = catalog
        self.runtimes = runtimes

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

        def _reject_write(self):
            # There are deliberately no HTTP write endpoints yet. Do not read or act on a body.
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
            if not self._origin_ok():
                self._send_json(403, {"error": "Origin is not allowed"})
                return
            self.send_response(204)
            self.send_header("Allow", "GET, HEAD, OPTIONS")
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self._write_cors_headers()
            self.end_headers()

    server = _BoundedHTTPServer((LOOPBACK_HOST, port), Handler, services)
    original_close = server.server_close

    def close():
        original_close()
        server._service_pool.shutdown(wait=False, cancel_futures=True)

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
