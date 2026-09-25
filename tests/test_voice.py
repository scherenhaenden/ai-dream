import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from aidream.voice import LocalVoice, SpeechWorker, VoiceCapabilities, discover_whisper_models


class VoiceTests(unittest.TestCase):
    def test_capability_details_report_available_tools_and_setup_hints(self):
        caps = VoiceCapabilities("/usr/bin/espeak-ng", None, None)
        self.assertTrue(caps.details()["text_to_speech"]["available"])
        self.assertIn("alsa-utils", caps.setup_help())
        self.assertIn("whisper.cpp", caps.setup_help())

    def test_discovery_finds_only_whisper_ggml_bin_models(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ggml-base.bin").touch()
            (root / "ggml-large.bin.bak").touch()
            (root / "other.bin").touch()
            self.assertEqual(discover_whisper_models([root]), (root / "ggml-base.bin",))

    def test_configuration_returns_capabilities_and_models(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / "ggml-small.bin"
            model.touch()
            voice = LocalVoice()
            with patch.object(voice, "capabilities", VoiceCapabilities(None, "/bin/arecord", None)):
                config = voice.configuration([tmp])
            self.assertEqual(config.capabilities.recorder_executable, "/bin/arecord")
            self.assertEqual(config.whisper_models, (model,))

    def test_speak_async_validates_text_and_missing_tts(self):
        voice = LocalVoice()
        with patch.object(voice, "capabilities", VoiceCapabilities(None, None, None)):
            with self.assertRaises(RuntimeError):
                voice.speak_async("hello")
        voice.capabilities = VoiceCapabilities("/bin/true", None, None)
        with self.assertRaises(ValueError):
            voice.speak_async("  ")

    @unittest.skipUnless(os.name == "posix", "process-group cancellation is POSIX-only")
    def test_worker_cancel_terminates_its_own_subprocess(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "slow-tts"
            script.write_text("#!/usr/bin/env python3\nimport time\ntime.sleep(30)\n", encoding="utf-8")
            script.chmod(0o755)
            worker = SpeechWorker(str(script), "hello")
            deadline = time.monotonic() + 2
            while worker._process is None and time.monotonic() < deadline:
                time.sleep(0.01)
            worker.cancel()
            worker.wait(timeout=2)
            self.assertTrue(worker.done)
            self.assertTrue(worker.cancelled)

    def test_worker_propagates_tool_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "bad-tts"
            script.write_text("#!/bin/sh\necho nope >&2\nexit 3\n", encoding="utf-8")
            script.chmod(0o755)
            worker = SpeechWorker(str(script), "hello")
            with self.assertRaisesRegex(RuntimeError, "status 3"):
                worker.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
