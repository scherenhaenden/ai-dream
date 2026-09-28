"""Unit coverage for safe web server stop/restart controls."""

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from aidream import http_api
from aidream.cli import build_parser


class WebLifecycleTests(unittest.TestCase):
    def test_cli_accepts_stop_and_restart_actions(self):
        parser = build_parser()
        self.assertTrue(parser.parse_args(["web", "--stop"]).stop)
        self.assertTrue(parser.parse_args(["web", "--restart"]).restart)

    def test_web_process_command_recognizes_only_expected_entrypoints(self):
        self.assertTrue(http_api._is_ai_dream_web_command("python3 -m aidream web --port 8765"))
        self.assertTrue(http_api._is_ai_dream_web_command("/venv/bin/aidream web --port 8765"))
        self.assertFalse(http_api._is_ai_dream_web_command("python3 -m unrelated.web"))

    def test_stop_signals_only_verified_process_and_waits_for_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "web-8765.pid"
            marker.write_text("43210\n", encoding="ascii")
            with patch.object(http_api, "_web_pid_path", return_value=marker), \
                    patch.object(Path, "read_bytes", return_value=b"python3\0-m\0aidream\0web\0"), \
                    patch.object(http_api.os, "kill", side_effect=[None, ProcessLookupError]), \
                    patch.object(http_api.time, "sleep"):
                http_api.stop_web_server(8765)
            self.assertFalse(marker.exists())

    def test_stop_refuses_unrelated_process_without_signaling(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "web-8765.pid"
            marker.write_text("43210\n", encoding="ascii")
            with patch.object(http_api, "_web_pid_path", return_value=marker), \
                    patch.object(Path, "read_bytes", return_value=b"python3\0-m\0unrelated\0web\0"), \
                    patch.object(http_api.os, "kill") as kill:
                with self.assertRaisesRegex(RuntimeError, "refusing to stop"):
                    http_api.stop_web_server(8765)
            kill.assert_not_called()
            self.assertTrue(marker.exists())

    def test_stop_can_recover_pre_marker_ai_dream_server(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "web-8765.pid"
            with patch.object(http_api, "_web_pid_path", return_value=marker), \
                    patch.object(http_api, "_legacy_ai_dream_web_pids", return_value=[43210]), \
                    patch.object(http_api, "_signal_and_wait") as stop:
                http_api.stop_web_server(8765)
            stop.assert_called_once_with(43210, 8765)


if __name__ == "__main__":
    unittest.main()
