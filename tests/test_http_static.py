from __future__ import annotations

import http.client
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from aidream.http_api import create_server, serve_web


class APIStub:
    def get(self, path):
        if path == "/api/health":
            return 200, {"data": {"status": "ok"}}
        return 404, {"error": "Not found"}


class StaticHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "dist"
        (self.root / "assets").mkdir(parents=True)
        (self.root / "index.html").write_text("<!doctype html><main>app shell</main>", encoding="utf-8")
        (self.root / "assets" / "main-12345678.js").write_text("console.log('app')", encoding="utf-8")
        (self.root / "plain.txt").write_text("local asset", encoding="utf-8")
        self.server = create_server(0, api=APIStub(), static_root=self.root)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._close_server)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def _close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def get(self, path):
        return urlopen(self.base + path, timeout=2)

    def test_serves_index_assets_with_safe_mime_cache_and_security_headers(self):
        with self.get("/") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "text/html")
            self.assertEqual(response.headers.get("Cache-Control"), "no-cache")
            self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
            self.assertEqual(response.headers.get("X-Frame-Options"), "DENY")
            self.assertIn("frame-ancestors 'none'", response.headers.get("Content-Security-Policy", ""))
            self.assertIn("app shell", response.read().decode())
        with self.get("/assets/main-12345678.js") as response:
            self.assertEqual(response.headers.get_content_type(), "application/javascript")
            self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable")
            self.assertEqual(response.read(), b"console.log('app')")
        with self.get("/plain.txt") as response:
            self.assertEqual(response.headers.get_content_type(), "text/plain")
            self.assertEqual(response.headers.get("Cache-Control"), "no-cache")

    def test_unknown_client_route_falls_back_but_missing_asset_does_not(self):
        with self.get("/chat/thread-123?from=home") as response:
            self.assertIn(b"app shell", response.read())
        with self.assertRaises(HTTPError) as caught:
            self.get("/assets/missing.js")
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()

    def test_api_endpoints_keep_priority_over_spa_fallback(self):
        with self.get("/api/health") as response:
            self.assertEqual(response.headers.get_content_type(), "application/json")
            self.assertIn(b'"status":"ok"', response.read())
        with self.assertRaises(HTTPError) as caught:
            self.get("/api/no-such-route")
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()

    def test_traversal_hidden_paths_and_escaping_symlinks_are_not_served(self):
        secret = Path(self.temp.name) / "secret.txt"
        secret.write_text("not for the web app", encoding="utf-8")
        (self.root / "leak.txt").symlink_to(secret)
        (self.root / ".private").write_text("hidden", encoding="utf-8")
        for path in ("/%2e%2e/secret.txt", "/leak.txt", "/.private"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                self.get(path)
            self.assertEqual(caught.exception.code, 404)
            caught.exception.close()
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=2)
        conn.putrequest("GET", "/%2e%2e/secret.txt", skip_host=True)
        conn.putheader("Host", f"127.0.0.1:{self.server.server_address[1]}")
        conn.endheaders()
        response = conn.getresponse()
        self.assertEqual(response.status, 404)
        self.assertNotIn(b"not for the web app", response.read())
        conn.close()

    def test_static_root_requires_in_root_index_and_app_web_reports_missing_build(self):
        with TemporaryDirectory() as temp:
            empty = Path(temp) / "empty"
            empty.mkdir()
            with self.assertRaisesRegex(ValueError, "index.html"):
                create_server(0, api=APIStub(), static_root=empty)
            with patch("aidream.http_api.default_web_dist", return_value=empty):
                with self.assertRaisesRegex(RuntimeError, "Angular production build is missing"):
                    serve_web(0)

    def test_static_server_stays_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=2)
        conn.putrequest("GET", "/", skip_host=True)
        conn.putheader("Host", "attacker.example")
        conn.endheaders()
        response = conn.getresponse()
        self.assertEqual(response.status, 400)
        conn.close()


if __name__ == "__main__":
    unittest.main()
