from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from aidream.diagnostics import DiagnosticsLog, MAX_LOG_BYTES


class DiagnosticsLogTests(unittest.TestCase):
    def test_persists_root_cause_with_incident_id_and_without_prompt_input(self):
        with TemporaryDirectory() as temp:
            log = DiagnosticsLog(Path(temp) / "state" / "events.jsonl")
            try:
                try:
                    raise RuntimeError("llama-server exited with SIGABRT in llama_params_fit")
                except RuntimeError as cause:
                    raise ValueError("Local model could not be loaded") from cause
            except ValueError as error:
                event = log.record("chat.generate", error, incident_id="a" * 32, chat_id="b" * 32)

            self.assertEqual(event["incident_id"], "a" * 32)
            self.assertEqual(event["error_type"], "RuntimeError")
            self.assertIn("SIGABRT", event["detail"])
            self.assertNotIn("prompt", event)
            self.assertEqual(log.list(), [event])

    def test_rotates_old_events_and_returns_newest_first(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "events.jsonl"
            log = DiagnosticsLog(path)
            for _ in range(MAX_LOG_BYTES // 1900 + 2):
                log.record("test", "x" * 1900)
            newest = log.record("chat.generate", "latest")

            self.assertTrue(path.with_suffix(".jsonl.1").is_file())
            self.assertEqual(log.list(1), [newest])

    def test_invalid_limit_is_rejected(self):
        with TemporaryDirectory() as temp:
            log = DiagnosticsLog(Path(temp) / "events.jsonl")
            for limit in (0, 501, True, "2"):
                with self.subTest(limit=limit), self.assertRaises(ValueError):
                    log.list(limit)


if __name__ == "__main__":
    unittest.main()
