import time
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from aidream.http_api import ReadOnlyAPI


class DocumentSkillAPITests(unittest.TestCase):
    def test_voice_transcribe_skill_uses_selected_artifact_and_local_voice_tool(self):
        from aidream.voice import VoiceCapabilities, VoiceConfiguration

        with tempfile.TemporaryDirectory() as temp:
            model_path = Path(temp) / "ggml-fixture.bin"
            model_path.write_bytes(b"fixture model marker")

            class Voice:
                capabilities = VoiceCapabilities("espeak-fixture", None, "whisper-fixture")

                def configuration(self):
                    return VoiceConfiguration(self.capabilities, (model_path,))

                def transcribe(self, audio, model):
                    self.seen = (Path(audio).read_bytes(), Path(model))
                    return "fixture transcript"

            voice = Voice()
            service = ReadOnlyAPI(
                hardware=SimpleNamespace(detect=lambda: {}),
                catalog=SimpleNamespace(list_models=lambda: []),
                runtimes=SimpleNamespace(list_backends=lambda: []),
                local_voice=voice,
                voice_render_speech=lambda _executable, _text: b"",
            )
            try:
                audio_bytes = b"RIFF\x00\x00\x00\x00WAVEfixture audio bytes"
                audio = service.get_artifact_api().create(
                    audio_bytes, kind="audio", media_type="audio/wav", name="voice.wav",
                    owner_type="session", owner_id="voice-test", lifetime="session")
                self.assertEqual("ready", next(item for item in service._skill_summaries()
                                                 if item["id"] == "voice.transcribe")["status"])
                run = service.start_skill("voice.transcribe", {"inputs": {"audio": audio}})["data"]["run"]
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    run = service.run_manager.get(run["id"])
                    if run["state"] in {"succeeded", "failed", "cancelled"}:
                        break
                    time.sleep(0.01)
                self.assertEqual("succeeded", run["state"], run.get("error"))
                self.assertEqual("fixture transcript", run["outputs"][0]["text"])
                self.assertEqual(audio_bytes, voice.seen[0])
                self.assertEqual(model_path, voice.seen[1])
            finally:
                service.close()

    def test_voice_conversation_combines_fake_chat_route_with_audio_artifact(self):
        from aidream.voice import VoiceCapabilities, VoiceConfiguration

        stages = []

        class Model:
            id = "b" * 32
            path = "/fixture/model.gguf"
            metadata = {"general.name": "Fixture chat model"}

        class Backend:
            name = "fixture-runtime"
            runtime_id = "fixture-runtime"
            def capabilities(self): return SimpleNamespace(available=True, chat_completions=True, details="fake runtime")
            def can_load(self, _model): return True
            def load(self, _model, _placement=None, _options=None): pass
            def generate(self, _prompt, _options=None):
                stages.append("text.chat")
                return "I heard the archive location."
            def unload(self): pass

        with tempfile.TemporaryDirectory() as temp:
            model_path = Path(temp) / "ggml-fixture.bin"
            model_path.write_bytes(b"fixture model marker")

            class Voice:
                capabilities = VoiceCapabilities("espeak-fixture", None, "whisper-fixture")
                def configuration(self): return VoiceConfiguration(self.capabilities, (model_path,))
                def transcribe(self, _audio, _model):
                    stages.append("audio.transcribe")
                    return "Where is the archive stored?"

            def render_speech(_exe, _text):
                stages.append("audio.synthesize")
                return wav

            wav = b"RIFF\x00\x00\x00\x00WAVEfixture speech"
            service = ReadOnlyAPI(
                hardware=SimpleNamespace(detect=lambda: SimpleNamespace(
                    ram=SimpleNamespace(total_bytes=None, available_bytes=None), gpus=[])),
                catalog=SimpleNamespace(list_models=lambda: [Model()]),
                runtimes=SimpleNamespace(list_backends=lambda: [Backend()]),
                local_voice=Voice(), voice_render_speech=render_speech)
            try:
                audio = service.get_artifact_api().create(
                    b"RIFF\x00\x00\x00\x00WAVEfixture input", kind="audio", media_type="audio/wav",
                    name="question.wav", owner_type="session", owner_id="voice-flow", lifetime="session")
                run = service.start_skill("voice.conversation", {"inputs": {"audio": audio}})["data"]["run"]
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    run = service.run_manager.get(run["id"])
                    if run["state"] in {"succeeded", "failed", "cancelled"}:
                        break
                    time.sleep(0.01)
                self.assertEqual("succeeded", run["state"], run.get("error"))
                self.assertEqual(["audio.transcribe", "text.chat", "audio.synthesize"], stages)
                self.assertEqual("I heard the archive location.", run["outputs"][0]["text"])
                spoken = run["outputs"][1]
                self.assertEqual("audio", spoken["kind"])
                self.assertEqual("audio/wav", spoken["artifact"]["media_type"])
                self.assertEqual({"type": "run", "id": run["id"]}, spoken["artifact"]["owner"])
            finally:
                service.close()

    def test_voice_respond_uses_only_explicit_reviewed_transcript_then_synthesizes(self):
        from aidream.voice import VoiceCapabilities, VoiceConfiguration

        stages = []
        reviewed_transcript = "I checked the transcription and corrected the archive name."
        wav = b"RIFF\x00\x00\x00\x00WAVEfixture reply"

        class Model:
            id = "c" * 32
            path = "/fixture/model.gguf"
            metadata = {"general.name": "Fixture chat model"}

        class Backend:
            name = "fixture-runtime"
            runtime_id = "fixture-runtime"
            def capabilities(self): return SimpleNamespace(available=True, chat_completions=True, details="fake runtime")
            def can_load(self, _model): return True
            def load(self, _model, _placement=None, _options=None): pass
            def generate(self, prompt, _options=None):
                stages.append("text.chat")
                self.prompt = prompt
                return "The archive is in the sealed vault."
            def unload(self): pass

        class Voice:
            capabilities = VoiceCapabilities("espeak-fixture", None, None)
            def configuration(self): return VoiceConfiguration(self.capabilities, ())

        def render_speech(_exe, text):
            stages.append("audio.synthesize")
            self.assertEqual(text, "The archive is in the sealed vault.")
            return wav

        backend = Backend()
        service = ReadOnlyAPI(
            hardware=SimpleNamespace(detect=lambda: SimpleNamespace(
                ram=SimpleNamespace(total_bytes=None, available_bytes=None), gpus=[])),
            catalog=SimpleNamespace(list_models=lambda: [Model()]),
            runtimes=SimpleNamespace(list_backends=lambda: [backend]),
            local_voice=Voice(), voice_render_speech=render_speech)
        try:
            run = service.start_skill("voice.respond", {"inputs": {
                "transcript": {"kind": "text", "text": reviewed_transcript},
            }})["data"]["run"]
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                run = service.run_manager.get(run["id"])
                if run["state"] in {"succeeded", "failed", "cancelled"}:
                    break
                time.sleep(0.01)
            self.assertEqual("succeeded", run["state"], run.get("error"))
            self.assertEqual(["text.chat", "audio.synthesize"], stages)
            self.assertIn(reviewed_transcript, backend.prompt)
            self.assertEqual("The archive is in the sealed vault.", run["outputs"][0]["text"])
            self.assertEqual("audio", run["outputs"][1]["kind"])
        finally:
            service.close()

    def test_rag_skill_runs_with_fake_chat_route_and_returns_exact_citations(self):
        class Model:
            id = "a" * 32
            path = "/fixture/model.gguf"
            metadata = {"general.name": "Fixture model"}

        class Backend:
            name = "fixture-runtime"
            runtime_id = "fixture-runtime"

            def capabilities(self): return SimpleNamespace(available=True, chat_completions=True, details="fake runtime")
            def can_load(self, _model): return True
            def load(self, _model, _placement=None, _options=None): pass
            def generate(self, prompt, _options=None):
                self.last_prompt = prompt
                return "The archive is in a sealed vault [C1]."
            def unload(self): pass

        backend = Backend()
        service = ReadOnlyAPI(
            hardware=SimpleNamespace(detect=lambda: SimpleNamespace(
                ram=SimpleNamespace(total_bytes=None, available_bytes=None), gpus=[])),
            catalog=SimpleNamespace(list_models=lambda: [Model()]),
            runtimes=SimpleNamespace(list_backends=lambda: [backend]),
        )
        try:
            source_text = "The lunar sample archive is stored in a sealed vault."
            document = service.get_artifact_api().create(
                source_text.encode(), kind="document", media_type="text/plain",
                name="archive.txt", owner_type="session", owner_id="rag-test", lifetime="session")
            run = service.start_skill("document.answer-with-rag", {"inputs": {
                "document": document,
                "question": {"kind": "text", "text": "Where is the archive stored?"},
            }})["data"]["run"]
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                run = service.run_manager.get(run["id"])
                if run["state"] in {"succeeded", "failed", "cancelled"}:
                    break
                time.sleep(0.01)
            self.assertEqual("succeeded", run["state"], run.get("error"))
            outputs = run["outputs"]
            self.assertIn("[C1]", outputs[0]["text"])
            citation = outputs[1]["value"][0]
            self.assertEqual(source_text[citation["start_char"]:citation["end_char"]], citation["quote"])
            self.assertEqual("archive.txt", citation["document_name"])
            self.assertIn("Cite each factual claim", backend.last_prompt)
        finally:
            service.close()

    def test_render_skills_produce_owner_scoped_html_and_pdf_artifacts(self):
        service = ReadOnlyAPI(
            hardware=SimpleNamespace(detect=lambda: {}),
            catalog=SimpleNamespace(list_models=lambda: []),
            runtimes=SimpleNamespace(list_backends=lambda: []),
        )
        try:
            cases = (
                ("document.create-html", {"text": {"kind": "text", "text": "A <safe> note"}}, "text/html", b"&lt;safe&gt;"),
                ("document.create-pdf", {"text": {"kind": "text", "text": "A readable note"}}, "application/pdf", b"%PDF-1.4"),
                ("document.create-report", {"report": {"kind": "json", "value": {
                    "title": "Quarterly report", "summary": "Stable.",
                    "sections": [{"heading": "Results", "body": "All good."}],
                }}}, "text/html", b"Quarterly report"),
                ("document.create-report-pdf", {"report": {"kind": "json", "value": {
                    "title": "Quarterly report", "summary": "Stable.",
                    "sections": [{"heading": "Results", "kind": "text", "body": "All good."},
                                 {"heading": "Checks", "kind": "table", "columns": ["Name", "Status"],
                                  "rows": [["Tests", "Passed"]]}],
                }}}, "application/pdf", b"%PDF-1.4"),
            )
            for skill_id, inputs, media_type, expected in cases:
                with self.subTest(skill=skill_id):
                    run = service.start_skill(skill_id, {"inputs": inputs})["data"]["run"]
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        run = service.run_manager.get(run["id"])
                        if run["state"] in {"succeeded", "failed", "cancelled"}:
                            break
                        time.sleep(0.01)
                    self.assertEqual("succeeded", run["state"], run.get("error"))
                    document = next(item for item in run["outputs"] if item.get("kind") == "document")
                    artifact = document["artifact"]
                    self.assertEqual(media_type, artifact["media_type"])
                    self.assertEqual({"type": "run", "id": run["id"]}, artifact["owner"])
                    _envelope, content = service.get_artifact_api().content(
                        artifact["id"], owner_type="run", owner_id=run["id"])
                    self.assertIn(expected, content)
        finally:
            service.close()


if __name__ == "__main__":
    unittest.main()
