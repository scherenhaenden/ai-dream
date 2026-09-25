from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from aidream.runtime_manager import RuntimeManager


class RuntimeManagerTest(unittest.TestCase):
    def manager(self, root, found=None, run=None, euid=1000):
        release = Path(root) / "os-release"
        release.write_text('ID=ubuntu\nVERSION_ID="24.04"\n', encoding="utf-8")
        found = found or {}
        return RuntimeManager(which=lambda name: found.get(name), run=run or Mock(
            return_value=subprocess.CompletedProcess([], 0, "llama.cpp version 1", "")),
            os_release=release, euid=lambda: euid)

    def test_status_detects_version_without_installing(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Mock(return_value=subprocess.CompletedProcess([], 0, "llama.cpp version 1\n", ""))
            manager = self.manager(tmp, {"llama-server": "/usr/bin/llama-server", "apt-get": "/usr/bin/apt-get", "pkexec": "/usr/bin/pkexec"}, run)
            status = manager.status()
            self.assertTrue(status.installed)
            self.assertEqual(status.executable, "/usr/bin/llama-server")
            self.assertEqual(status.version, "llama.cpp version 1")
            self.assertTrue(status.install_supported)
            run.assert_called_once()

    def test_install_uses_pkexec_then_verifies(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            installed = {"value": False}
            def which(name):
                if name in ("llama-server", "server") and installed["value"]:
                    return "/usr/bin/llama-server"
                return {"apt-get": "/usr/bin/apt-get", "pkexec": "/usr/bin/pkexec"}.get(name)
            def run(command, **kwargs):
                calls.append(command)
                if "--version" in command:
                    return subprocess.CompletedProcess(command, 0, "version 1", "")
                installed["value"] = True
                return subprocess.CompletedProcess(command, 0, "", "")
            release = Path(tmp) / "release"
            release.write_text("ID=ubuntu\n", encoding="utf-8")
            manager = RuntimeManager(which=which, run=run, os_release=release, euid=lambda: 1000)
            result = manager.install()
            self.assertTrue(result.installed)
            self.assertEqual(calls[0], ["pkexec", "apt-get", "install", "-y", "llama.cpp-tools"])
            self.assertIn("--version", calls[1])

    def test_install_reports_authorization_cancellation(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Mock(return_value=subprocess.CompletedProcess([], 1, "", "Authentication cancelled"))
            manager = self.manager(tmp, {"apt-get": "/usr/bin/apt-get", "pkexec": "/usr/bin/pkexec"}, run)
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                manager.install()

    def test_unsupported_platform_has_no_install_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            release = Path(tmp) / "release"
            release.write_text("ID=fedora\n", encoding="utf-8")
            manager = RuntimeManager(which=lambda name: "/usr/bin/apt-get" if name == "apt-get" else None,
                                     os_release=release)
            status = manager.status()
            self.assertFalse(status.install_supported)
            self.assertIsNone(status.install_command)
            with self.assertRaisesRegex(RuntimeError, "only on Debian/Ubuntu"):
                manager.install()


if __name__ == "__main__":
    unittest.main()
