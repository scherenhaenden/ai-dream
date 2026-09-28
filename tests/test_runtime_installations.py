import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from aidream.runtime_installations import RuntimeInstallationRegistry


class RuntimeInstallationRegistryTest(unittest.TestCase):
    def make_server(self, root: Path, name="llama-server", help_text=None):
        binary = root / name
        help_text = help_text if help_text is not None else """
usage: llama-server [options]
  -ngl, --n-gpu-layers N
  --device LIST
  --tensor-split LIST
  --split-mode MODE
  --main-gpu N
  -c, --ctx-size N
  -t, --threads N
  -b, --batch-size N
  -ub, --ubatch-size N
  -np, --parallel N
  -fa, --flash-attn
  --kv-unified
  --no-kv-offload
  --mmap | --no-mmap
  --mlock
  --fit
  --list-devices
"""
        code = f'''#!/usr/bin/env python3
import sys
if "--help" in sys.argv:
    print({help_text!r})
elif "--list-devices" in sys.argv:
    print("Available devices:\\n  ROCm0: AMD Radeon Fake\\n  Vulkan1: Fake Vulkan GPU\\n  CUDA0: Fake CUDA GPU")
elif "--version" in sys.argv:
    print("llama.cpp version: fake-123")
else:
    raise SystemExit(3)
'''
        binary.write_text(code, encoding="utf-8")
        binary.chmod(0o755)
        return binary

    def test_register_persists_probed_capabilities_and_runtime_devices(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            install_dir = root / "server build"
            install_dir.mkdir()
            binary = self.make_server(install_dir)
            registry = RuntimeInstallationRegistry(root / "config" / "installations.json")

            item = registry.register(binary, name="Test build")

            self.assertEqual(item["name"], "Test build")
            self.assertEqual(item["executable"], str(binary.resolve()))
            self.assertTrue(item["available"])
            self.assertEqual(item["version"], "llama.cpp version: fake-123")
            self.assertTrue(item["capabilities"]["split_mode"])
            self.assertTrue(item["capabilities"]["main_gpu"])
            self.assertTrue(item["capabilities"]["device_listing"])
            self.assertEqual([device["id"] for device in item["devices"]], ["ROCm0", "Vulkan1", "CUDA0"])
            self.assertEqual([device["backend"] for device in item["devices"]], ["ROCm", "Vulkan", "CUDA"])
            self.assertEqual(registry.list_installations(), [item])
            persisted = json.loads((root / "config" / "installations.json").read_text())
            self.assertEqual(persisted["version"], 1)

    def test_register_same_executable_updates_record_without_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = self.make_server(root)
            registry = RuntimeInstallationRegistry(root / "registry.json")
            first = registry.register(binary, name="First")
            second = registry.register(binary, name="Second", enabled=False)
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(second["name"], "Second")
            self.assertFalse(second["enabled"])
            self.assertEqual(len(registry.list_installations()), 1)

    def test_device_command_is_never_run_without_advertised_option(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            help_text = "usage: llama-server\n  --ctx-size N\n"
            binary = self.make_server(root, help_text=help_text)
            calls = []

            def run(argv, **kwargs):
                calls.append((argv, kwargs))
                return subprocess.run(argv, **kwargs)

            registry = RuntimeInstallationRegistry(root / "registry.json", run=run)
            item = registry.register(binary)
            self.assertEqual(item["devices"], [])
            self.assertFalse(item["capabilities"]["device_listing"])
            self.assertFalse(item["capabilities"]["device_selection"])
            self.assertEqual([call[0][1] for call in calls], ["--help", "--version"])
            self.assertTrue(all(call[1]["shell"] is False for call in calls))

    def test_device_probe_passes_executable_and_arguments_without_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = self.make_server(root)
            observed = []

            def run(argv, **kwargs):
                observed.append((list(argv), kwargs))
                return subprocess.run(argv, **kwargs)

            registry = RuntimeInstallationRegistry(root / "registry.json", run=run)
            registry.register(binary)
            self.assertEqual(observed[0][0], [str(binary.resolve()), "--help"])
            self.assertEqual(observed[1][0], [str(binary.resolve()), "--list-devices"])
            self.assertTrue(all(call[1]["shell"] is False for call in observed))
            self.assertTrue(all(call[1]["timeout"] == 10.0 for call in observed))

    def test_remove_deletes_registry_record_but_not_server_binary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = self.make_server(root)
            registry = RuntimeInstallationRegistry(root / "registry.json")
            item = registry.register(binary)
            registry.remove(item["id"])
            self.assertEqual(registry.list_installations(), [])
            self.assertTrue(binary.is_file())
            with self.assertRaises(KeyError):
                registry.remove(item["id"])

    def test_only_executable_llama_server_or_server_files_are_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry = RuntimeInstallationRegistry(root / "registry.json")
            wrong_name = root / "not-server"
            wrong_name.write_text("#!/bin/sh\nexit 0\n")
            wrong_name.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "named llama-server or server"):
                registry.register(wrong_name)
            non_executable = root / "server"
            non_executable.write_text("placeholder")
            with self.assertRaisesRegex(ValueError, "executable file"):
                registry.register(non_executable)
            with self.assertRaisesRegex(ValueError, "existing llama-server or server"):
                registry.register(root / "missing" / "llama-server")

    def test_help_failure_marks_installation_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = self.make_server(root)

            def run(argv, **kwargs):
                if argv[-1] == "--help":
                    return subprocess.CompletedProcess(argv, 2, "", "bad option")
                return subprocess.CompletedProcess(argv, 0, "", "")

            registry = RuntimeInstallationRegistry(root / "registry.json", run=run)
            item = registry.register(binary)
            self.assertFalse(item["available"])
            self.assertFalse(item["capabilities"]["device_listing"])
            self.assertEqual(item["devices"], [])

    def test_probe_timeout_is_reported_and_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = self.make_server(root)

            def run(argv, **kwargs):
                raise subprocess.TimeoutExpired(argv, kwargs["timeout"])

            registry = RuntimeInstallationRegistry(root / "registry.json", run=run, timeout=0.25)
            item = registry.register(binary)
            self.assertFalse(item["available"])
            self.assertIn("probe failed", item["capabilities"]["details"])

    def test_enabled_state_and_unknown_capability_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = self.make_server(root, help_text="usage: llama-server\n  --ctx-size N\n")
            registry = RuntimeInstallationRegistry(root / "registry.json")
            item = registry.register(binary)
            disabled = registry.set_enabled(item["id"], False)
            self.assertFalse(disabled["enabled"])
            self.assertTrue(disabled["available"])
            self.assertFalse(disabled["capabilities"]["fit"])
            enabled = registry.set_enabled(item["id"], True)
            self.assertTrue(enabled["enabled"])


if __name__ == "__main__":
    unittest.main()
