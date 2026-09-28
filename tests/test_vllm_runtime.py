from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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
