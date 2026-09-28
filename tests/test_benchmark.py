import json
import tempfile
import unittest
from pathlib import Path

from aidream.benchmark import benchmark_one, comparison_table, run_matrix, save_result
from aidream.cli import build_parser


class _Backend:
    name = "fake"
    _base_url = None

    def __init__(self):
        self.loaded = False
        self.load_calls = []
    def load(self, model, placement=None, options=None):
        self.loaded = True
        self.load_calls.append((model, placement, options))
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

    def test_result_serialization_rejects_non_json_values_clearly(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "not JSON serializable"):
                save_result({"bad": object()}, Path(directory) / "results.json")

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

    def test_matrix_applies_per_row_options_and_persists_each_result(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "matrix.json"
            backends = []

            def make_backend():
                backend = _Backend()
                backends.append(backend)
                return backend

            rows = run_matrix(
                "model.gguf", "hello world", make_backend,
                [
                    {"name": "GPU0", "placement": {"device": "ROCm0"}},
                    {"name": "dual GPU layer 2:1", "placement": {
                        "devices": ["ROCm0", "ROCm1"], "split_mode": "layer",
                        "tensor_split": "2:1"}, "options": {"context_size": 2048}},
                ],
                options={"gpu_layers": 32}, results_path=path,
            )
            self.assertEqual([row["matrix_name"] for row in rows], ["GPU0", "dual GPU layer 2:1"])
            self.assertEqual(rows[1]["devices"], ["ROCm0", "ROCm1"])
            self.assertEqual(backends[0].load_calls[0][2], {"gpu_layers": 32})
            self.assertEqual(backends[1].load_calls[0][2], {"gpu_layers": 32, "context_size": 2048})
            self.assertEqual(len(json.loads(path.read_text(encoding="utf-8"))), 2)
            self.assertTrue(all(not backend.loaded for backend in backends))

    def test_matrix_rejects_invalid_rows(self):
        with self.assertRaisesRegex(ValueError, "at least one"):
            run_matrix("m", "p", _Backend, [])
        with self.assertRaisesRegex(ValueError, "configuration 1 must be an object"):
            run_matrix("m", "p", _Backend, ["GPU0"])
        with self.assertRaisesRegex(ValueError, "placement must be an object"):
            run_matrix("m", "p", _Backend, [{"placement": "GPU0"}])

    def test_comparison_table_contains_every_run_and_metrics(self):
        table = comparison_table([
            {"matrix_name": "GPU0", "model_load_seconds": 1.25,
             "prompt_processing_tokens_per_second": 10, "generation_tokens_per_second": 20,
             "prompt_token_count": 8, "generated_token_count": 32},
            {"matrix_name": "dual GPU", "model_load_seconds": 2,
             "prompt_processing_tokens_per_second": 11, "generation_tokens_per_second": 21,
             "prompt_token_count": 8, "generated_token_count": 32},
        ])
        self.assertIn("GPU0", table)
        self.assertIn("dual GPU", table)
        self.assertIn("Prompt tok/s", table)
        self.assertIn("32", table)


if __name__ == "__main__":
    unittest.main()
