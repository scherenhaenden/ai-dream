"""Static checks for desktop and console entry points."""

from configparser import ConfigParser
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]


def _desktop(path: str) -> dict[str, str]:
    parser = ConfigParser(interpolation=None)
    parser.read(ROOT / path)
    return dict(parser["Desktop Entry"])


class LauncherTests(unittest.TestCase):
    def test_desktop_shortcuts_select_distinct_modes(self):
        standalone = _desktop("AI Dream.desktop")
        web = _desktop("AI Dream Web.desktop")

        self.assertEqual(standalone["name"], "AI Dream")
        self.assertTrue(standalone["exec"].endswith("/open-ai-dream"))
        self.assertEqual(standalone["tryexec"], standalone["exec"])
        self.assertEqual(web["name"], "AI Dream Web")
        self.assertTrue(web["exec"].endswith("/open-ai-dream-web"))
        self.assertEqual(web["tryexec"], web["exec"])
        self.assertEqual(standalone["terminal"], web["terminal"])
        self.assertEqual(standalone["terminal"], "true")


    def test_shell_launchers_target_standalone_and_web_modes_with_diagnostics(self):
        standalone = (ROOT / "open-ai-dream").read_text()
        web = (ROOT / "open-ai-dream-web").read_text()

        self.assertIn("python3 -m aidream.ui", standalone)
        self.assertIn('python3 -m aidream web "${web_args[@]}"', web)
        self.assertIn("web_args=(--restart", web)
        self.assertIn("startup failed", standalone)
        self.assertIn("startup failed", web)
        self.assertNotIn("read -r", standalone)
        self.assertNotIn("read -r", web)
        self.assertIn('readlink -f -- "$0"', standalone)
        self.assertIn('readlink -f -- "$0"', web)


    def test_installed_console_scripts_and_module_entrypoint_are_configured(self):
        config = tomllib.loads((ROOT / "pyproject.toml").read_text())

        scripts = config["project"]["scripts"]
        self.assertEqual(scripts["aidream"], "aidream.cli:main")
        self.assertEqual(scripts["aidream-gui"], "aidream.ui:main")
        self.assertTrue((ROOT / "aidream" / "__main__.py").is_file())

    def test_console_entrypoint_and_web_launcher_help_start_without_loading_models(self):
        console = subprocess.run([sys.executable, "-m", "aidream", "--help"], cwd=ROOT,
                                 capture_output=True, text=True, timeout=10)
        self.assertEqual(console.returncode, 0, console.stderr)
        self.assertIn("benchmark", console.stdout)
        web = subprocess.run([str(ROOT / "open-ai-dream-web"), "--help"], cwd=ROOT,
                             capture_output=True, text=True, timeout=10)
        self.assertEqual(web.returncode, 0, web.stderr)
        self.assertIn("usage: aidream", web.stdout)

    def test_standalone_launcher_surfaces_startup_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            shim = Path(directory) / "python3"
            shim.write_text("#!/bin/sh\necho simulated startup error >&2\nexit 7\n")
            shim.chmod(0o755)
            env = dict(os.environ, PATH=f"{directory}:{os.environ.get('PATH', '')}")
            result = subprocess.run([str(ROOT / "open-ai-dream")], cwd=ROOT, env=env,
                                    capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 7)
        self.assertIn("simulated startup error", result.stderr)
        self.assertIn("desktop startup failed", result.stderr)

    def test_web_desktop_launcher_restarts_managed_server_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            shim = Path(directory) / "python3"
            shim.write_text('#!/bin/sh\nprintf "%s\\n" "$*" > "$AIDREAM_ARGS"\n')
            shim.chmod(0o755)
            args_file = Path(directory) / "args"
            env = dict(os.environ, PATH=f"{directory}:{os.environ.get('PATH', '')}",
                       AIDREAM_ARGS=str(args_file))
            result = subprocess.run([str(ROOT / "open-ai-dream-web")], cwd=ROOT,
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(args_file.read_text().strip(), "-m aidream web --restart")

            result = subprocess.run([str(ROOT / "open-ai-dream-web"), "--stop"], cwd=ROOT,
                                    env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(args_file.read_text().strip(), "-m aidream web --stop")
