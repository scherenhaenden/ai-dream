from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from aidream.conversation import ChatStore
from aidream.http_api import APIError, ReadOnlyAPI


class FakeLogBackend:
    name = "llama.cpp"

    def __init__(self):
        self.lines = ["server started", "model loaded", "prompt evaluated"]
        self.requested_limit = None

    def recent_log_lines(self, limit=200):
        self.requested_limit = limit
        return self.lines[-limit:]

    def status(self):
        return {"loaded": True}


def make_api(temp, backend=None):
    api = ReadOnlyAPI(hardware=object(), catalog=object(), runtimes=object(),
                      chat_store=ChatStore(Path(temp) / "chats"))
    api._active_backend = backend
    return api


class LogsApiTests(unittest.TestCase):
    def test_logs_endpoint_returns_bounded_real_lines_and_source(self):
        with TemporaryDirectory() as temp:
            backend = FakeLogBackend()
            api = make_api(temp, backend)
            status, response = api.get("/api/logs", "limit=2")

        self.assertEqual(status, 200)
        self.assertEqual(backend.requested_limit, 2)
        self.assertEqual(response["data"], {
            "lines": ["model loaded", "prompt evaluated"], "source": "llama.cpp",
            "supported": True, "loaded": True, "limit": 2,
        })

    def test_logs_endpoint_reports_empty_when_no_backend_is_active(self):
        with TemporaryDirectory() as temp:
            api = make_api(temp)
            status, response = api.get("/api/logs")

        self.assertEqual(status, 200)
        self.assertEqual(response["data"], {
            "lines": [], "source": None, "supported": False, "loaded": False, "limit": 200,
        })

    def test_logs_endpoint_rejects_ambiguous_or_out_of_range_limits(self):
        with TemporaryDirectory() as temp:
            api = make_api(temp, FakeLogBackend())
            for query in ("limit=0", "limit=1001", "limit=1&limit=2", "limit=3&level=error", "limit=abc"):
                with self.subTest(query=query), self.assertRaises(APIError):
                    api.get("/api/logs", query)


if __name__ == "__main__":
    unittest.main()
