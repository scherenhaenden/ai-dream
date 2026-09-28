from pathlib import Path
import json
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from aidream.runtime import RuntimeRegistry
from aidream.vllm_runtime import VLLMBackend


VLLM_HELP = """
usage: vllm serve MODEL [options]
  --host HOST
  --port PORT
  --device-ids IDS
  --tensor-parallel-size N
  -tp N
  --max-model-len N
  --max-num-seqs N
"""


class VLLMBackendTest(unittest.TestCase):
    def _backend(self):
        with patch("aidream.vllm_runtime.subprocess.run") as run:
            run.return_value.stdout = VLLM_HELP
            run.return_value.stderr = ""
            run.return_value.returncode = 0
            return VLLMBackend("/usr/bin/vllm", port=8123)

    def test_registry_includes_vllm_without_replacing_llama_cpp(self):
        with patch("aidream.runtime.shutil.which", return_value=None), \
             patch("aidream.vllm_runtime.shutil.which", return_value=None):
            names = [backend.name for backend in RuntimeRegistry().list_backends()]
        self.assertEqual(names, ["llama.cpp", "vLLM"])

    def test_gguf_command_maps_equal_split_to_tensor_parallel(self):
        backend = self._backend()
        with tempfile.TemporaryDirectory() as td:
            model = Path(td) / "model.gguf"
            model.write_bytes(b"mock")
            command = backend.effective_command(
                model,
                {"device": "0,1", "tensor_split": "1,1"},
                {"context_size": 32768, "max_concurrent": 8},
            )
        self.assertEqual(command[:3], ["/usr/bin/vllm", "serve", str(model.resolve())])
        pairs = set(zip(command, command[1:]))
        self.assertIn(("--host", "127.0.0.1"), pairs)
        self.assertIn(("--port", "8123"), pairs)
        self.assertIn(("--device-ids", "0,1"), pairs)
        self.assertIn(("--tensor-parallel-size", "2"), pairs)
        self.assertIn(("--max-model-len", "32768"), pairs)
        self.assertIn(("--max-num-seqs", "8"), pairs)

    def test_native_huggingface_directory_is_accepted(self):
        backend = self._backend()
        with tempfile.TemporaryDirectory() as td:
            model = Path(td) / "hf-model"
            model.mkdir()
            (model / "config.json").write_text("{}", encoding="utf-8")
            self.assertTrue(backend.can_load(model))
            command = backend.effective_command(model)
        self.assertEqual(command[2], str(model.resolve()))

    def test_projector_gguf_is_rejected_like_llama_cpp(self):
        backend = self._backend()
        with tempfile.TemporaryDirectory() as td:
            projector = Path(td) / "mmproj-model.gguf"
            projector.write_bytes(b"mock")
            self.assertFalse(backend.can_load(projector))
            with self.assertRaisesRegex(ValueError, "vision projector"):
                backend.validate_load(projector)

            metadata_projector = Path(td) / "vision.gguf"
            metadata_projector.write_bytes(b"mock")
            model = SimpleNamespace(path=metadata_projector, metadata={"general.architecture": "clip"})
            self.assertFalse(backend.can_load(model))
            with self.assertRaisesRegex(ValueError, "vision projector"):
                backend.validate_load(model)

    def test_streaming_completion_includes_vllm_served_model(self):
        backend = self._backend()
        with tempfile.TemporaryDirectory() as td:
            model = Path(td) / "model.gguf"
            model.write_bytes(b"mock")
            backend._loaded_model = model.resolve()
            backend._base_url = "http://127.0.0.1:8123"
            backend._process = SimpleNamespace(poll=lambda: None)
            response = MagicMock()
            response.__enter__.return_value = response
            response.readline.side_effect = [
                b'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
                b"\n", b"data: [DONE]\n", b"\n",
            ]
            with patch("aidream.runtime.urlopen", return_value=response) as urlopen:
                self.assertEqual(backend.generate_stream("hello"), "ok")
            request = urlopen.call_args.args[0]
            payload = json.loads(request.data)
            self.assertEqual(payload["model"], str(model.resolve()))

    def test_tool_completion_includes_vllm_served_model(self):
        backend = self._backend()
        with tempfile.TemporaryDirectory() as td:
            model = Path(td) / "model.gguf"
            model.write_bytes(b"mock")
            backend._loaded_model = model.resolve()
            backend._base_url = "http://127.0.0.1:8123"
            backend._process = SimpleNamespace(poll=lambda: None)
            response = MagicMock()
            response.__enter__.return_value = response
            response.read.return_value = b'{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'
            with patch("aidream.runtime.urlopen", return_value=response) as urlopen:
                answer = backend.chat_with_tools([], [])
            self.assertEqual(answer["content"], "ok")
            request = urlopen.call_args.args[0]
            self.assertEqual(json.loads(request.data)["model"], str(model.resolve()))

    def test_help_probe_passes_executable_as_literal_argv_without_shell(self):
        executable = "/tmp/runtime;touch /tmp/unexpected"
        with patch("aidream.vllm_runtime.subprocess.run") as run:
            run.return_value.stdout = VLLM_HELP
            run.return_value.stderr = ""
            run.return_value.returncode = 0
            VLLMBackend(executable)
        argv, kwargs = run.call_args
        self.assertEqual(argv[0], [executable, "serve", "--help"])
        self.assertIs(kwargs["shell"], False)

    def test_asymmetric_llama_tensor_split_is_rejected(self):
        backend = self._backend()
        with self.assertRaisesRegex(ValueError, "equal tensor-parallel ranks"):
            backend._tensor_parallel_size("2,1")

    def test_llama_specific_load_options_are_rejected_instead_of_silently_ignored(self):
        backend = self._backend()
        with self.assertRaisesRegex(ValueError, "threads"):
            backend._load_options({"threads": 8})


if __name__ == "__main__":
    unittest.main()
