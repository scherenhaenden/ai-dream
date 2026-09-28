import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from aidream import cli
from aidream.cli import build_parser
from aidream.models import ModelCatalog


class ControlPlaneCliTest(unittest.TestCase):
    def run_cli(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = cli.main(list(args))
        return result, output.getvalue()

    def test_models_remove_unregisters_source_without_touching_files(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            models = root / 'models'
            models.mkdir()
            model_file = models / 'small.gguf'
            model_file.write_bytes(b'model-data')
            with patch.dict(os.environ, {'HOME': str(root), 'XDG_CONFIG_HOME': str(root / 'config')}):
                catalog = ModelCatalog()
                catalog.add_source(models)
                source_id = catalog.list_source_details()[0]['id']
                result, output = self.run_cli('models', 'remove', source_id)
                self.assertEqual(result, 0)
                self.assertTrue(json.loads(output)['removed'])
                self.assertEqual(catalog.list_sources(), [])
                self.assertTrue(model_file.exists())

    def test_local_gguf_folder_can_be_added_rescanned_listed_and_loaded_by_id(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            models = root / "Models"
            models.mkdir()
            model_path = models / "first-test-model.gguf"
            model_path.write_bytes(b"not-a-real-model")
            environment = {"HOME": str(root), "XDG_CONFIG_HOME": str(root / "config")}
            with patch.dict(os.environ, environment):
                result, add_output = self.run_cli("models", "add", str(models))
                self.assertEqual(result, 0)
                self.assertEqual(json.loads(add_output), str(models.resolve()))

                result, list_output = self.run_cli("models", "list")
                self.assertEqual(result, 0)
                listed = json.loads(list_output)
                self.assertEqual(len(listed), 1)
                self.assertEqual(listed[0]["path"], str(model_path.resolve()))
                model_id = listed[0]["id"]

                result, rescan_output = self.run_cli("models", "rescan")
                self.assertEqual(result, 0)
                self.assertEqual(json.loads(rescan_output)[0]["id"], model_id)

                with patch.object(cli, "_api_request", return_value={"status": "loaded"}) as api:
                    result, load_output = self.run_cli(
                        "load", model_id, "--gpu-layers", "12", "--context-size", "2048"
                    )
                self.assertEqual(result, 0)
                self.assertEqual(json.loads(load_output)["status"], "loaded")
                api.assert_called_once_with("POST", "/api/runtime/load", {
                    "model_id": model_id, "backend": None,
                    "placement": {"gpu_layers": 12},
                    "load": {"context_size": 2048},
                })

    def test_models_scan_remains_compatible_as_rescan_alias(self):
        self.assertEqual(build_parser().parse_args(["models", "scan"]).models_command, "scan")
        self.assertEqual(build_parser().parse_args(["models", "rescan"]).models_command, "rescan")

    def test_runtime_add_list_devices_probe_and_remove_use_registry_service(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            binary = root / 'llama-server'
            binary.write_text('#!/bin/sh\nif [ "$1" = "--help" ]; then echo "usage --device --list-devices"; exit 0; fi\nif [ "$1" = "--version" ]; then echo "version: test"; exit 0; fi\nif [ "$1" = "--list-devices" ]; then echo "Vulkan0: Test Adapter"; exit 0; fi\n')
            binary.chmod(0o755)
            environment = {'XDG_CONFIG_HOME': str(root / 'config')}
            with patch.dict(os.environ, environment):
                result, output = self.run_cli('runtime', 'add', str(binary), '--name', 'test')
                self.assertEqual(result, 0)
                installation = json.loads(output)
                identity = installation['id']
                self.assertTrue(installation['available'])
                result, output = self.run_cli('runtime', 'devices')
                self.assertEqual(result, 0)
                devices = json.loads(output)
                self.assertEqual(devices[0]['devices'][0]['id'], 'Vulkan0')
                result, output = self.run_cli('runtime', 'probe', identity)
                self.assertEqual(result, 0)
                self.assertEqual(json.loads(output)['id'], identity)
                result, output = self.run_cli('runtime', 'list')
                self.assertEqual(result, 0)
                self.assertEqual(len(json.loads(output)), 1)
                result, _ = self.run_cli('runtime', 'remove', identity)
                self.assertEqual(result, 0)
                self.assertTrue(binary.exists())

    def test_profiles_crud_and_json_validation(self):
        with tempfile.TemporaryDirectory() as td:
            with patch.dict(os.environ, {'XDG_DATA_HOME': td}):
                result, output = self.run_cli('profiles', 'create', '--json',
                    '{"name":"Portable","placement":{"gpu_layers":12},"load":{"context_size":4096}}')
                self.assertEqual(result, 0)
                profile = json.loads(output)
                identity = profile['id']
                result, output = self.run_cli('profiles', 'show', identity)
                self.assertEqual(result, 0)
                self.assertEqual(json.loads(output)['name'], 'Portable')
                result, output = self.run_cli('profiles', 'update', identity, '--json',
                    '{"name":"Updated","placement":{"main_gpu":1}}')
                self.assertEqual(result, 0)
                updated = json.loads(output)
                self.assertEqual(updated['name'], 'Updated')
                self.assertEqual(updated['placement'], {'gpu_layers': 12, 'main_gpu': 1})
                result, output = self.run_cli('profiles', 'list')
                self.assertEqual(result, 0)
                self.assertEqual(len(json.loads(output)), 1)
                result, output = self.run_cli('profiles', 'delete', identity)
                self.assertEqual(result, 0)
                self.assertTrue(json.loads(output)['deleted'])
                result, _ = self.run_cli('profiles', 'create', '--json', '[]')
                self.assertEqual(result, 2)

    def test_profile_json_can_come_from_file(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'profile.json'
            path.write_text('{"name":"From file"}', encoding='utf-8')
            with patch.dict(os.environ, {'XDG_DATA_HOME': str(Path(td) / 'data')}):
                result, output = self.run_cli('profiles', 'create', '--file', str(path))
                self.assertEqual(result, 0)
                self.assertEqual(json.loads(output)['name'], 'From file')


if __name__ == '__main__':
    unittest.main()
