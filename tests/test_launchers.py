"""Static checks for desktop and console entry points."""

from configparser import ConfigParser
from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]


def _desktop(path: str) -> dict[str, str]:
    parser = ConfigParser(interpolation=None)
    parser.read(ROOT / path)
    return dict(parser["Desktop Entry"])


def test_desktop_shortcuts_select_distinct_modes():
    standalone = _desktop("AI Dream.desktop")
    web = _desktop("AI Dream Web.desktop")

    assert standalone["name"] == "AI Dream"
    assert standalone["exec"].endswith("/open-ai-dream")
    assert standalone["tryexec"] == standalone["exec"]
    assert web["name"] == "AI Dream Web"
    assert web["exec"].endswith("/open-ai-dream-web")
    assert web["tryexec"] == web["exec"]
    assert standalone["terminal"] == web["terminal"] == "true"


def test_shell_launchers_target_standalone_and_web_modes_with_diagnostics():
    standalone = (ROOT / "open-ai-dream").read_text()
    web = (ROOT / "open-ai-dream-web").read_text()

    assert "python3 -m aidream.ui" in standalone
    assert "python3 -m aidream web \"$@\"" in web
    assert "startup failed" in standalone
    assert "startup failed" in web
    assert 'readlink -f -- "$0"' in standalone
    assert 'readlink -f -- "$0"' in web


def test_installed_console_scripts_and_module_entrypoint_are_configured():
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())

    scripts = config["project"]["scripts"]
    assert scripts["aidream"] == "aidream.cli:main"
    assert scripts["aidream-gui"] == "aidream.ui:main"
    assert (ROOT / "aidream" / "__main__.py").is_file()

