import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, Mock

from aidream.voice import (MAX_TRANSCRIPT_BYTES, LocalVoice, RecordingWorker,
                           SpeechWorker, VoiceCapabilities, discover_whisper_models)


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

    def test_ffmpeg_flite_probe_discovers_voices_without_synthesizing(self):
        paths = {"espeak-ng": None, "espeak": None, "ffmpeg": "/usr/bin/ffmpeg",
                 "arecord": "/usr/bin/arecord", "whisper-cli": None, "whisper-cpp": None,
                 "spd-say": "/usr/bin/spd-say"}
        probe = Mock(return_value=SimpleNamespace(
            returncode=0,
            stderr="[Parsed_flite_0 @ 0x1234] kal\n[Parsed_flite_0 @ 0x1234] slt\n",
        ))
        with patch("aidream.voice.shutil.which", side_effect=lambda name: paths.get(name)):
            with patch("aidream.voice.subprocess.run", probe):
                voice = LocalVoice()
        self.assertEqual(voice.capabilities.flite_voices, ("kal", "slt"))
        self.assertEqual(voice.capabilities.details()["text_to_speech"]["provider"], "ffmpeg-flite")
        command = probe.call_args.args[0]
        self.assertIn("flite=list_voices=true", command)
        self.assertFalse(any("textfile=" in item for item in command))

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

    @unittest.skipUnless(os.name == "posix", "process-group recording is POSIX-only")
    def test_push_to_talk_recording_stops_early_and_finalizes_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "fake-arecord"
            script.write_text(
                "#!/usr/bin/env python3\n"
                "import pathlib, signal, sys, time\n"
                "out=pathlib.Path(sys.argv[-1]); pathlib.Path(str(out)+'.started').touch()\n"
                "def stop(sig, frame): out.write_bytes(b'fake wav'); sys.exit(0)\n"
                "signal.signal(signal.SIGINT, stop)\n"
                "while True: time.sleep(.02)\n", encoding="utf-8")
            script.chmod(0o755)
            output = root / "capture.wav"
            worker = RecordingWorker(str(script), output, max_seconds=17)
            marker = Path(str(output) + ".started")
            deadline = time.monotonic() + 3
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(marker.exists())
            worker.stop()
            self.assertEqual(worker.wait(timeout=3), output)
            self.assertEqual(output.read_bytes(), b"fake wav")

    @unittest.skipUnless(os.name == "posix", "process-group recording is POSIX-only")
    def test_push_to_talk_cancel_removes_partial_audio(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "fake-arecord"
            script.write_text(
                "#!/usr/bin/env python3\n"
                "import pathlib, sys, time\n"
                "out=pathlib.Path(sys.argv[-1]); out.write_bytes(b'partial'); pathlib.Path(str(out)+'.started').touch()\n"
                "while True: time.sleep(.02)\n", encoding="utf-8")
            script.chmod(0o755)
            output = root / "capture.wav"
            worker = RecordingWorker(str(script), output, max_seconds=17)
            marker = Path(str(output) + ".started")
            deadline = time.monotonic() + 3
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(marker.exists())
            worker.cancel()
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                worker.wait(timeout=3)
            self.assertFalse(output.exists())

    def test_recording_max_duration_is_bounded(self):
        voice = LocalVoice()
        voice.capabilities = VoiceCapabilities(None, "/bin/true", None)
        with tempfile.TemporaryDirectory() as tmp:
            for invalid in (0, 121, True):
                with self.assertRaises(ValueError):
                    voice.start_recording(Path(tmp) / "audio.wav", max_seconds=invalid)

    def test_worker_propagates_tool_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "bad-tts"
            script.write_text("#!/bin/sh\necho nope >&2\nexit 3\n", encoding="utf-8")
            script.chmod(0o755)
            worker = SpeechWorker(str(script), "hello")
            with self.assertRaisesRegex(RuntimeError, "status 3"):
                worker.wait(timeout=2)

    def test_transcribe_rejects_non_ggml_model_before_running_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audio, model = root / "audio.wav", root / "model.bin"
            audio.write_bytes(b"audio")
            model.write_bytes(b"not a whisper model")
            voice = LocalVoice()
            voice.capabilities = VoiceCapabilities(None, None, "/usr/bin/whisper-cli")
            with patch("aidream.voice.subprocess.run") as run:
                with self.assertRaisesRegex(ValueError, "ggml-\\*\\.bin"):
                    voice.transcribe(audio, model)
            run.assert_not_called()

    def test_transcribe_enforces_audio_limit_before_running_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audio, model = root / "audio.wav", root / "ggml-base.bin"
            audio.write_bytes(b"x" * 8)
            model.write_bytes(b"fixture")
            voice = LocalVoice()
            voice.capabilities = VoiceCapabilities(None, None, "/usr/bin/whisper-cli")
            with patch("aidream.voice.MAX_VOICE_INPUT_BYTES", 4), \
                    patch("aidream.voice.subprocess.run") as run:
                with self.assertRaisesRegex(ValueError, "must be from 1 to 4 bytes"):
                    voice.transcribe(audio, model)
            run.assert_not_called()

    def test_transcribe_bounds_child_output_and_returns_small_transcript(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            audio, model = root / "audio.wav", root / "ggml-base.bin"
            audio.write_bytes(b"audio")
            model.write_bytes(b"fixture")
            voice = LocalVoice()
            voice.capabilities = VoiceCapabilities(None, None, "/usr/bin/whisper-cli")

            def write_success(_command, **kwargs):
                kwargs["stdout"].write(b"  recognized words  ")
                return Mock(returncode=0)

            with patch("aidream.voice.subprocess.run", side_effect=write_success):
                self.assertEqual(voice.transcribe(audio, model), "recognized words")

            def write_too_much(_command, **kwargs):
                kwargs["stdout"].write(b"x" * (MAX_TRANSCRIPT_BYTES + 1))
                return Mock(returncode=0)

            with patch("aidream.voice.subprocess.run", side_effect=write_too_much):
                with self.assertRaisesRegex(RuntimeError, "output limit"):
                    voice.transcribe(audio, model)


if __name__ == "__main__":
    unittest.main()
