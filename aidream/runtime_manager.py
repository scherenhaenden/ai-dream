"""Detect and explicitly install the distro-managed llama.cpp server."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import subprocess
from typing import Callable, Sequence


@dataclass(frozen=True)
class RuntimeStatus:
    installed: bool
    executable: str | None
    version: str | None
    install_supported: bool
    install_command: tuple[str, ...] | None
    details: str


class RuntimeManager:
    """Inspect llama.cpp and provide an opt-in Ubuntu/Debian package install.

    Merely constructing the manager or calling :meth:`status` is read-only.
    Installation is only attempted by an explicit call to :meth:`install`.
    """

    package = "llama.cpp-tools"

    def __init__(self, *, which: Callable[[str], str | None] = shutil.which,
                 run: Callable[..., subprocess.CompletedProcess] = subprocess.run,
                 os_release: str | Path = "/etc/os-release",
                 euid: Callable[[], int] = getattr(os, "geteuid", lambda: 1)):
        self._which = which
        self._run = run
        self._os_release = Path(os_release)
        self._euid = euid

    def _supported(self) -> bool:
        try:
            data = {}
            for line in self._os_release.read_text(encoding="utf-8").splitlines():
                key, sep, value = line.partition("=")
                if sep:
                    data[key] = value.strip().strip('"').strip("'")
            ids = {data.get("ID", "").lower(), *data.get("ID_LIKE", "").lower().split()}
            return "ubuntu" in ids or "debian" in ids
        except OSError:
            return False

    def _install_command(self) -> tuple[str, ...] | None:
        if not self._supported() or not self._which("apt-get"):
            return None
        if self._euid() == 0:
            return ("apt-get", "install", "-y", self.package)
        if self._which("pkexec"):
            return ("pkexec", "apt-get", "install", "-y", self.package)
        if self._which("sudo"):
            return ("sudo", "apt-get", "install", "-y", self.package)
        return None

    def status(self) -> RuntimeStatus:
        executable = self._which("llama-server") or self._which("server")
        version: str | None = None
        if executable:
            try:
                result = self._run([executable, "--version"], capture_output=True,
                                   text=True, timeout=10, check=False)
                output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
                lines = [line.strip() for line in output.splitlines() if line.strip()]
                # Some Vulkan builds print driver warnings before the version.
                version_line = next((line for line in lines if "version:" in line.lower()), None)
                version = (version_line or (lines[0] if lines else ""))[:240] or None
            except (OSError, subprocess.SubprocessError):
                version = None
        supported = self._supported()
        command = self._install_command()
        if executable:
            details = "llama-server is available." + (f" Version: {version}." if version else " Version could not be read.")
        elif command:
            details = f"llama-server is not installed. An explicit install can use the system package {self.package}."
        elif supported:
            details = "llama-server is not installed; apt-get and a supported privilege helper are required to install it."
        else:
            details = "llama-server is not installed; automatic installation is supported only on Debian/Ubuntu with apt-get."
        return RuntimeStatus(bool(executable), executable, version, bool(command), command, details)

    def install(self) -> RuntimeStatus:
        """Install the OS package after explicit user invocation, then verify it."""
        before = self.status()
        if before.installed:
            return before
        command = before.install_command
        if not command:
            raise RuntimeError(before.details)
        try:
            result = self._run(list(command), capture_output=True, text=True,
                               timeout=None, check=False)
        except (OSError, subprocess.SubprocessError) as exc:
            raise RuntimeError(f"Could not install {self.package}: {exc}") from exc
        if result.returncode != 0:
            message = (result.stderr or result.stdout or "").strip()
            if result.returncode in (1, 126, 127) and any(x in message.lower() for x in ("cancel", "cancelled", "canceled", "authentication")):
                raise RuntimeError("Installation was cancelled or authorization was denied.")
            if not message:
                message = f"installer exited with status {result.returncode}"
            raise RuntimeError(f"Could not install {self.package}: {message}")
        after = self.status()
        if not after.installed:
            raise RuntimeError("Package installation completed, but llama-server could not be found afterward. Check that the package provides llama-server and that it is on PATH.")
        return after
