import json
import tempfile
import unittest
from pathlib import Path

from aidream.benchmark import benchmark_one, save_result
from aidream.cli import build_parser


class _Backend:
    name = "fake"
    _base_url = None

    def __init__(self):
        self.loaded = False
    def load(self, model, placement=None, options=None):
        self.loaded = True
    def generate(self, prompt, options=None):
        return "one two three"
    def unload(self):
        self.loaded = False
    def capabilities(self):
        return type("Caps", (), {"executable": "llama-server"})()


class BenchmarkTests(unittest.TestCase):
    def test_cli_exposes_load_runtime_options_and_actions(self):
        parser = build_parser()
        args = parser.parse_args(["load", "model.gguf", "--gpu-layers", "24", "--split-mode", "layer",
                                  "--tensor-split", "1:1", "--main-gpu", "0", "--context-size", "4096",
                                  "--threads", "8", "--batch-size", "512", "--physical-batch-size", "128",
                                  "--max-concurrent", "2", "--flash-attention", "--mmap", "--fit", "off"])
        self.assertEqual(args.gpu_layers, 24)
        self.assertEqual(args.split_mode, "layer")
        self.assertEqual(args.tensor_split, "1:1")
        self.assertEqual(args.main_gpu, 0)
        self.assertEqual(args.context_size, 4096)
        self.assertEqual(args.physical_batch_size, 128)
        self.assertTrue(args.flash_attention)
        self.assertFalse(args.fit)
        self.assertEqual(parser.parse_args(["unload"]).command, "unload")
        self.assertEqual(parser.parse_args(["status"]).command, "status")
        self.assertEqual(parser.parse_args(["chat"]).command, "chat")
        self.assertEqual(parser.parse_args(["chat", "model.gguf", "--threads", "4"]).threads, 4)

    def test_result_serializes_and_appends_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.json"
            record = {"generation_tokens_per_second": 12.5, "load_settings": {"placement": {"device": "Vulkan0"}}}
            self.assertEqual(save_result(record, path), path)
            save_result({"generated_token_count": 4}, path)
            self.assertEqual(json.loads(path.read_text()), [record, {"generated_token_count": 4}])

    def test_benchmark_records_required_metrics_and_unloads(self):
        backend = _Backend()
        result = benchmark_one("model.gguf", "hello world", backend,
                               placement={"device": "Vulkan0", "split_mode": "layer", "tensor_split": "1:1"})
        self.assertGreaterEqual(result["model_load_seconds"], 0)
        self.assertIn("prompt_processing_tokens_per_second", result)
        self.assertIn("generation_tokens_per_second", result)
        self.assertEqual(result["prompt_token_count"], 2)
        self.assertEqual(result["generated_token_count"], 3)
        self.assertEqual(result["backend"], "fake")
        self.assertEqual(result["devices"], "Vulkan0")
        self.assertEqual(result["split_mode"], "layer")
        self.assertEqual(result["tensor_split"], "1:1")
        self.assertFalse(backend.loaded)


if __name__ == "__main__":
    unittest.main()
