"""Tests for AI Dream.desktop and open-ai-dream-app launcher."""

from configparser import ConfigParser
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DesktopAppLauncherTests(unittest.TestCase):
    def test_desktop_file_configuration_and_permissions(self):
        desktop_path = ROOT / "AI Dream.desktop"
        self.assertTrue(desktop_path.is_file(), "AI Dream.desktop must exist in repo root")

        # Must be executable for desktop environments
        mode = desktop_path.stat().st_mode
        self.assertTrue(bool(mode & stat.S_IXUSR), "AI Dream.desktop must have executable permissions")

        parser = ConfigParser(interpolation=None)
        parser.read(desktop_path)
        entry = dict(parser["Desktop Entry"])

        self.assertEqual(entry.get("name"), "AI Dream")
        self.assertEqual(entry.get("type"), "Application")
        self.assertEqual(entry.get("startupwmclass"), "AiDream")
        self.assertEqual(entry.get("terminal"), "false")
        self.assertTrue(entry.get("exec", "").endswith("open-ai-dream-app"))
        self.assertEqual(entry.get("exec"), entry.get("tryexec"))

    def test_open_ai_dream_app_bash_syntax_and_executability(self):
        script_path = ROOT / "open-ai-dream-app"
        self.assertTrue(script_path.is_file())
        mode = script_path.stat().st_mode
        self.assertTrue(bool(mode & stat.S_IXUSR), "open-ai-dream-app must be executable")

        # Bash syntax check (-n)
        syntax_check = subprocess.run(
            ["bash", "-n", str(script_path)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(syntax_check.returncode, 0, f"Bash syntax error: {syntax_check.stderr}")

    def test_open_ai_dream_app_contains_dynamic_port_and_lock_cleanup(self):
        content = (ROOT / "open-ai-dream-app").read_text(encoding="utf-8")
        self.assertIn("find_active_server_port", content)
        self.assertIn("cleanup_stale_locks", content)
        self.assertIn("SingletonLock", content)
        self.assertIn("free_port", content)
        # Supports fallback browsers
        self.assertIn("google-chrome", content)
        self.assertIn("chromium", content)
        self.assertIn("xdg-open", content)

    def test_launcher_executes_and_launches_browser_with_app_mode(self):
        """Simulate launcher run with mocked browser to verify port binding and arguments."""
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            fake_bin = temp_path / "bin"
            fake_bin.mkdir()

            # Mock google-chrome that logs invoked arguments and exits cleanly
            mock_chrome = fake_bin / "google-chrome"
            mock_chrome.write_text(
                "#!/usr/bin/env bash\n"
                'echo "$@" > "$MOCK_CHROME_ARGS"\n'
                "exit 0\n"
            )
            mock_chrome.chmod(0o755)

            chrome_args_file = temp_path / "chrome_args.txt"
            mock_data_dir = temp_path / "ai-dream-data"
            mock_cache_dir = temp_path / "ai-dream-cache"
            profile_dir = mock_data_dir / "chrome-profile"
            profile_dir.mkdir(parents=True)

            # Create a stale SingletonLock referencing a non-existent PID (999999)
            stale_lock = profile_dir / "SingletonLock"
            stale_lock.symlink_to("fake-host-999999")
            stale_socket = profile_dir / "SingletonSocket"
            stale_socket.symlink_to("/tmp/fake-socket")

            env = dict(
                os.environ,
                PATH=f"{fake_bin}:{os.environ.get('PATH', '')}",
                XDG_DATA_HOME=str(temp_path / "share"),
                XDG_CACHE_HOME=str(mock_cache_dir),
                MOCK_CHROME_ARGS=str(chrome_args_file),
            )

            # Point DATA_DIR in the test environment
            # Run open-ai-dream-app with mock browser
            # We pass a test port directly so it connects immediately or tests readiness
            result = subprocess.run(
                ["bash", str(ROOT / "open-ai-dream-app"), "--port=8765"],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=15,
            )

            self.assertEqual(result.returncode, 0, f"Launcher failed: stderr={result.stderr}")
            self.assertTrue(chrome_args_file.is_file(), "Browser was not executed by launcher")
            args = chrome_args_file.read_text()
            self.assertIn("--app=http://127.0.0.1:", args)
            self.assertIn("/chat", args)
            self.assertIn("--class=AiDream", args)


if __name__ == "__main__":
    unittest.main()
