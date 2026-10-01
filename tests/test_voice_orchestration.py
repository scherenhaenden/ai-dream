import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

from aidream.voice_orchestration import (
    MAX_VOICE_TEXT_CHARS,
    VoiceOrchestrationError,
    create_local_voice_callbacks,
    local_voice_readiness,
)


def envelope(*, owner_type="session", lifetime="session", size=None):
    size = len(wav_fixture()) if size is None else size
    return {
        "schema_version": 1,
        "id": "art_0123456789abcdef",
        "kind": "audio",
        "media_type": "audio/wav",
        "name": "sample.wav",
        "storage": {"type": "session", "key": "opaque-audio-key"},
        "size_bytes": size,
        "lifetime": lifetime,
        "owner": {"type": owner_type, "id": "session-123"},
        "metadata": {},
    }


def wav_fixture():
    return b"RIFF\x00\x00\x00\x00WAVEdata"


class FakeLocalVoice:
    def __init__(self, model):
        self.capabilities = SimpleNamespace(
            stt_executable="/fake/whisper-cli", tts_executable="/fake/espeak",
            speech_to_text=True, text_to_speech=True,
        )
        self.model = model
        self.transcribe_calls = []

    def configuration(self):
        return SimpleNamespace(capabilities=self.capabilities, whisper_models=(self.model,))

    def transcribe(self, audio, model):
        path = Path(audio)
        self.transcribe_calls.append((path, path.read_bytes(), Path(model)))
        return "fixture transcript"


class VoiceOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model = Path(self.temp.name) / "ggml-fixture.bin"
        self.model.write_bytes(b"synthetic model marker; never loaded")
        self.voice = FakeLocalVoice(self.model)

    def tearDown(self):
        self.temp.cleanup()

    def test_readiness_only_observes_executable_and_installed_model(self):
        readiness = local_voice_readiness(self.voice)
        self.assertTrue(readiness["audio.transcribe"]["available"])
        self.assertTrue(readiness["audio.synthesize"]["available"])
        missing = FakeLocalVoice(self.model.with_name("missing.bin"))
        missing.capabilities.stt_executable = None
        readiness = local_voice_readiness(missing)
        self.assertFalse(readiness["audio.transcribe"]["available"])
        self.assertTrue(readiness["audio.synthesize"]["available"])

    def test_readiness_reports_ffmpeg_flite_provider_and_voice_without_loading_audio(self):
        voice = FakeLocalVoice(self.model)
        voice.capabilities.tts_executable = None
        voice.capabilities.flite_executable = "/usr/bin/ffmpeg"
        voice.capabilities.flite_voices = ("kal", "slt")
        readiness = local_voice_readiness(voice)
        self.assertTrue(readiness["audio.synthesize"]["available"])
        self.assertEqual(readiness["audio.synthesize"]["provider"], "ffmpeg-flite")
        self.assertEqual(readiness["audio.synthesize"]["selected_voice"], "kal")

    def test_ffmpeg_flite_synthesis_uses_private_text_file_and_emits_wav(self):
        voice = FakeLocalVoice(self.model)
        voice.capabilities.tts_executable = None
        voice.capabilities.flite_executable = "/usr/bin/ffmpeg"
        voice.capabilities.flite_voices = ("kal",)
        observed = {}

        def fake_run(command, **kwargs):
            observed["command"] = command
            observed["text"] = Path(command[command.index("-i") + 1].split("textfile=", 1)[1].split(":voice=", 1)[0]).read_text()
            observed["mode"] = Path(command[command.index("-i") + 1].split("textfile=", 1)[1].split(":voice=", 1)[0]).stat().st_mode & 0o777
            observed["kwargs"] = kwargs
            return SimpleNamespace(returncode=0, stdout=wav_fixture())

        callbacks = create_local_voice_callbacks(voice, read_artifact=lambda _artifact: b"")
        with patch("aidream.voice_orchestration.subprocess.run", side_effect=fake_run):
            result = callbacks["audio.synthesize"]({}, {"text": {"kind": "text", "text": "fixture speech"}})
        self.assertEqual(observed["text"], "fixture speech")
        self.assertEqual(observed["mode"], 0o600)
        self.assertIn("voice=kal", " ".join(observed["command"]))
        self.assertFalse(observed["kwargs"].get("shell", False))
        audio = result["audio"]
        self.assertEqual(audio["content_bytes"], wav_fixture())
        self.assertEqual(audio["metadata"]["generator"], "local-ffmpeg-flite")

    def test_transcribe_uses_selected_artifact_and_private_temp_file(self):
        reads = []

        def read_artifact(value):
            reads.append(value["id"])
            return wav_fixture()

        callbacks = create_local_voice_callbacks(self.voice, read_artifact=read_artifact)
        result = callbacks["audio.transcribe"]({}, {"audio": envelope()})
        self.assertEqual(result, {"transcript": {"kind": "text", "text": "fixture transcript"}})
        self.assertEqual(reads, ["art_0123456789abcdef"])
        path, content, model = self.voice.transcribe_calls[0]
        self.assertEqual(content, wav_fixture())
        self.assertEqual(model, self.model.resolve())
        self.assertFalse(path.exists(), "selected binary must be removed after transcription")

    def test_transcription_rejects_wrong_scope_and_size_before_read(self):
        reads = []
        callbacks = create_local_voice_callbacks(self.voice, read_artifact=lambda artifact: reads.append(artifact))
        with self.assertRaises(VoiceOrchestrationError):
            callbacks["audio.transcribe"]({}, {"audio": envelope(owner_type="run")})
        with self.assertRaises(VoiceOrchestrationError):
            callbacks["audio.transcribe"]({}, {"audio": envelope(size=33 * 1024 * 1024)})
        self.assertEqual(reads, [])

    def test_transcription_checks_content_size_and_emits_only_text(self):
        callbacks = create_local_voice_callbacks(self.voice, read_artifact=lambda _artifact: b"short")
        with self.assertRaisesRegex(VoiceOrchestrationError, "does not match"):
            callbacks["audio.transcribe"]({}, {"audio": envelope()})
        self.assertEqual(self.voice.transcribe_calls, [])

    def test_synthesis_returns_bounded_binary_audio_for_run_manager(self):
        synthetic_wav = wav_fixture()
        seen = []

        def render(executable, text):
            seen.append((executable, text))
            return synthetic_wav

        callbacks = create_local_voice_callbacks(self.voice, read_artifact=lambda _artifact: b"", render_speech=render)
        result = callbacks["audio.synthesize"]({}, {"text": {"kind": "text", "text": "hello there"}})
        self.assertEqual(seen, [("/fake/espeak", "hello there")])
        audio = result["audio"]
        self.assertEqual(audio["kind"], "audio")
        self.assertEqual(audio["media_type"], "audio/wav")
        self.assertEqual(audio["content_bytes"], synthetic_wav)
        self.assertEqual(audio["name"], "speech.wav")

    def test_synthesis_validates_text_and_wave_output(self):
        callbacks = create_local_voice_callbacks(
            self.voice,
            read_artifact=lambda _artifact: b"",
            render_speech=lambda _exe, _text: b"not audio",
        )
        with self.assertRaises(VoiceOrchestrationError):
            callbacks["audio.synthesize"]({}, {"text": {"kind": "text", "text": "x" * (MAX_VOICE_TEXT_CHARS + 1)}})
        with self.assertRaisesRegex(VoiceOrchestrationError, "invalid or oversized"):
            callbacks["audio.synthesize"]({}, {"text": {"kind": "text", "text": "hello"}})

    def test_unavailable_local_tools_fail_without_launching_a_process(self):
        unavailable = FakeLocalVoice(self.model)
        unavailable.capabilities.tts_executable = None
        unavailable.capabilities.text_to_speech = False
        unavailable.capabilities.stt_executable = None
        unavailable.capabilities.speech_to_text = False
        callbacks = create_local_voice_callbacks(unavailable, read_artifact=lambda _artifact: wav_fixture())
        with self.assertRaisesRegex(VoiceOrchestrationError, "unavailable"):
            callbacks["audio.synthesize"]({}, {"text": {"kind": "text", "text": "hello"}})
        with self.assertRaisesRegex(VoiceOrchestrationError, "unavailable"):
            callbacks["audio.transcribe"]({}, {"audio": envelope()})


if __name__ == "__main__":
    unittest.main()
