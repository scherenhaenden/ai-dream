"""Local registry for explicitly selected llama.cpp server installations.

The registry stores executable paths and probe results only. Removing an entry
never removes or modifies the executable it refers to.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any, Callable, Mapping
import uuid


_FORMAT_VERSION = 1
_EXECUTABLE_NAMES = {"llama-server", "server"}
_DEVICE_LINE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_-]*\d+)\s*:\s*(.*?)\s*$")
_CAPABILITY_FLAGS: dict[str, tuple[str, ...]] = {
    "gpu_layers": ("-ngl", "--n-gpu-layers"),
    "device_selection": ("--device",),
    "tensor_split": ("--tensor-split", "--tensor_split"),
    "split_mode": ("--split-mode",),
    "main_gpu": ("--main-gpu",),
    "context_size": ("-c", "--ctx-size"),
    "threads": ("-t", "--threads"),
    "threads_batch": ("-tb", "--threads-batch"),
    "batch_size": ("-b", "--batch-size"),
    "physical_batch_size": ("-ub", "--ubatch-size"),
    "max_concurrent": ("-np", "--parallel"),
    "continuous_batching": ("--cont-batching", "--continuous-batching", "--no-cont-batching"),
    "numa": ("--numa",),
    "kv_cache_type_k": ("-ctk", "--cache-type-k"),
    "kv_cache_type_v": ("-ctv", "--cache-type-v"),
    "mlock": ("--mlock",),
    "flash_attention": ("-fa", "--flash-attn"),
    "unified_kv_cache": ("--kv-unified",),
    "offload_kv_cache": ("--no-kv-offload",),
    "mmap": ("--mmap", "--no-mmap"),
    "keep_model_in_memory": ("--mlock",),
    "fit": ("--fit",),
    "reasoning": ("--reasoning",),
}


def default_registry_path() -> Path:
    """Return the per-user configuration path for runtime installations."""
    config_home = os.environ.get("XDG_CONFIG_HOME")
    root = Path(config_home).expanduser() if config_home and Path(config_home).expanduser().is_absolute() else Path.home() / ".config"
    return root / "ai-dream" / "runtime-installations.json"


@dataclass(frozen=True)
class RuntimeInstallation:
    id: str
    name: str
    kind: str
    executable: str
    enabled: bool
    version: str | None = None
    backend: str | None = None
    available: bool = False
    capabilities: Mapping[str, Any] | None = None
    devices: tuple[Mapping[str, str], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["devices"] = [dict(device) for device in self.devices]
        result["capabilities"] = dict(self.capabilities or {})
        return result


class RuntimeInstallationRegistry:
    """Persist, probe, enable, and remove llama.cpp installation records."""

    def __init__(self, path: str | os.PathLike[str] | None = None, *,
                 run: Callable[..., subprocess.CompletedProcess] = subprocess.run,
                 timeout: float = 10.0):
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.path = Path(path).expanduser() if path is not None else default_registry_path()
        self._run = run
        self.timeout = timeout

    def list_installations(self) -> list[dict[str, Any]]:
        return [record.to_dict() for record in self._read()]

    def register(self, executable: str | os.PathLike[str], *, name: str | None = None,
                 kind: str = "llama.cpp", enabled: bool = True) -> dict[str, Any]:
        """Add or update an installation by canonical executable path, then probe it."""
        if not isinstance(enabled, bool):
            raise ValueError("enabled must be a boolean")
        if not isinstance(kind, str) or not kind.strip() or len(kind) > 64:
            raise ValueError("kind must contain 1 to 64 characters")
        binary = self._validate_executable(executable)
        records = self._read()
        existing = next((item for item in records if item.executable == str(binary)), None)
        identity = existing.id if existing else uuid.uuid4().hex
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be text")
        display_name = name.strip() if isinstance(name, str) else ""
        if not display_name:
            display_name = binary.parent.name or binary.name
        if len(display_name) > 128 or "\x00" in display_name:
            raise ValueError("name must contain at most 128 characters")
        record = RuntimeInstallation(identity, display_name, kind.strip(), str(binary), enabled)
        probed = self._probe(record)
        records = [item for item in records if item.executable != str(binary)]
        records.append(probed)
        self._write(records)
        return probed.to_dict()

    def remove(self, installation_id: str) -> None:
        """Remove only the registry record; leave its executable untouched."""
        if not isinstance(installation_id, str) or not re.fullmatch(r"[a-f0-9]{32}", installation_id):
            raise ValueError("invalid runtime installation id")
        records = self._read()
        remaining = [item for item in records if item.id != installation_id]
        if len(remaining) == len(records):
            raise KeyError("runtime installation was not found")
        self._write(remaining)

    def set_enabled(self, installation_id: str, enabled: bool) -> dict[str, Any]:
        if not isinstance(installation_id, str) or not re.fullmatch(r"[a-f0-9]{32}", installation_id):
            raise ValueError("invalid runtime installation id")
        if not isinstance(enabled, bool):
            raise ValueError("enabled must be a boolean")
        records = self._read()
        updated = []
        found = None
        for item in records:
            if item.id == installation_id:
                item = RuntimeInstallation(**{**item.to_dict(), "enabled": enabled})
                found = item
            updated.append(item)
        if found is None:
            raise KeyError("runtime installation was not found")
        self._write(updated)
        return found.to_dict()

    def probe(self, installation_id: str) -> dict[str, Any]:
        if not isinstance(installation_id, str) or not re.fullmatch(r"[a-f0-9]{32}", installation_id):
            raise ValueError("invalid runtime installation id")
        records = self._read()
        updated: list[RuntimeInstallation] = []
        result = None
        for item in records:
            if item.id == installation_id:
                item = self._probe(item)
                result = item
            updated.append(item)
        if result is None:
            raise KeyError("runtime installation was not found")
        self._write(updated)
        return result.to_dict()

    def _probe(self, record: RuntimeInstallation) -> RuntimeInstallation:
        try:
            help_result = self._run([record.executable, "--help"], capture_output=True,
                                    text=True, timeout=self.timeout, check=False, shell=False)
            help_text = _output(help_result)
            help_ok = getattr(help_result, "returncode", 1) == 0 and bool(help_text.strip())
        except (OSError, subprocess.SubprocessError, TimeoutError) as exc:
            return RuntimeInstallation(**{**record.to_dict(), "available": False,
                                          "version": None, "backend": None,
                                          "capabilities": {"available": False, "executable": record.executable,
                                                           "device_listing": False, "details": f"--help probe failed: {exc}"},
                                          "devices": []})
        if not help_ok:
            return RuntimeInstallation(**{**record.to_dict(), "available": False,
                                          "version": None, "backend": None,
                                          "capabilities": {"available": False, "executable": record.executable,
                                                           "device_listing": False,
                                                           "details": "Server executable found, but --help failed; interface could not be verified."},
                                          "devices": []})
        capabilities: dict[str, Any] = {key: _has_flag(help_text, *flags)
                                        for key, flags in _CAPABILITY_FLAGS.items()}
        capabilities["chat_completions"] = ("/v1/chat/completions" in help_text
                                             or "chat completions" in help_text.lower())
        list_devices = _has_flag(help_text, "--list-devices", "--list_devices")
        capabilities.update(available=True, executable=record.executable,
                            device_listing=list_devices,
                            details="Capabilities reflect flags advertised by this executable.")
        devices: list[Mapping[str, str]] = []
        if list_devices:
            try:
                result = self._run([record.executable, "--list-devices"], capture_output=True,
                                   text=True, timeout=self.timeout, check=False, shell=False)
                if getattr(result, "returncode", 1) == 0:
                    devices = _parse_devices(_output(result))
            except (OSError, subprocess.SubprocessError, TimeoutError):
                # A failed optional listing does not invalidate help-derived controls.
                devices = []
        try:
            version_result = self._run([record.executable, "--version"], capture_output=True,
                                       text=True, timeout=self.timeout, check=False, shell=False)
            version = _version(_output(version_result))
        except (OSError, subprocess.SubprocessError, TimeoutError):
            version = None
        backend = _infer_backend(devices, help_text)
        return RuntimeInstallation(**{**record.to_dict(), "version": version, "backend": backend,
                                      "available": True, "capabilities": capabilities,
                                      "devices": devices})

    @staticmethod
    def _validate_executable(value: str | os.PathLike[str]) -> Path:
        try:
            path = Path(value).expanduser().resolve(strict=True)
        except (OSError, TypeError, ValueError) as exc:
            raise ValueError("executable must be an existing llama-server or server binary") from exc
        if path.name not in _EXECUTABLE_NAMES or not path.is_file() or not os.access(path, os.X_OK):
            raise ValueError("executable must be an executable file named llama-server or server")
        return path

    def _read(self) -> list[RuntimeInstallation]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, ValueError) as exc:
            raise ValueError(f"could not read runtime installation registry: {exc}") from exc
        if not isinstance(data, dict) or data.get("version") != _FORMAT_VERSION or not isinstance(data.get("installations"), list):
            raise ValueError("runtime installation registry has an invalid format")
        records = []
        seen_ids: set[str] = set()
        seen_paths: set[str] = set()
        for item in data["installations"]:
            if not isinstance(item, dict):
                raise ValueError("runtime installation registry contains an invalid record")
            try:
                record = RuntimeInstallation(
                    id=item["id"], name=item["name"], kind=item["kind"], executable=item["executable"],
                    enabled=item["enabled"], version=item.get("version"), backend=item.get("backend"),
                    available=item.get("available", False), capabilities=item.get("capabilities", {}),
                    devices=tuple(item.get("devices", ())))
            except (KeyError, TypeError) as exc:
                raise ValueError("runtime installation registry contains an invalid record") from exc
            if (not re.fullmatch(r"[a-f0-9]{32}", record.id) or not isinstance(record.name, str)
                    or not isinstance(record.kind, str) or not isinstance(record.executable, str)
                    or not isinstance(record.enabled, bool) or not isinstance(record.available, bool)
                    or not isinstance(record.capabilities, Mapping) or not isinstance(record.devices, tuple)
                    or record.id in seen_ids or record.executable in seen_paths):
                raise ValueError("runtime installation registry contains an invalid or duplicate record")
            seen_ids.add(record.id)
            seen_paths.add(record.executable)
            records.append(record)
        return records

    def _write(self, records: list[RuntimeInstallation]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"version": _FORMAT_VERSION,
                              "installations": [item.to_dict() for item in records]},
                             ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        fd, temporary = tempfile.mkstemp(prefix=".runtime-installations-", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def _has_flag(help_text: str, *flags: str) -> bool:
    return any(re.search(r"(?<![\w-])" + re.escape(flag) + r"(?![\w-])", help_text) for flag in flags)


def _output(result: subprocess.CompletedProcess) -> str:
    return "\n".join(part for part in (result.stdout, result.stderr) if isinstance(part, str))


def _parse_devices(output: str) -> list[Mapping[str, str]]:
    """Parse only runtime-native IDs from a `--list-devices` listing."""
    found: list[Mapping[str, str]] = []
    seen: set[str] = set()
    for line in output.splitlines():
        match = _DEVICE_LINE.match(line)
        if not match:
            continue
        runtime_id, name = match.groups()
        if not name or runtime_id in seen:
            continue
        seen.add(runtime_id)
        prefix = re.match(r"[A-Za-z][A-Za-z_-]*", runtime_id)
        found.append({"id": runtime_id, "runtime_id": runtime_id,
                      "backend": prefix.group(0) if prefix else "unknown", "name": name})
    return found


def _version(output: str) -> str | None:
    for line in output.splitlines():
        if line.strip():
            return line.strip()[:240]
    return None


def _infer_backend(devices: list[Mapping[str, str]], help_text: str) -> str | None:
    backends = {str(device.get("backend", "")) for device in devices if device.get("backend")}
    if len(backends) == 1:
        return next(iter(backends))
    for candidate in ("CUDA", "ROCm", "Vulkan", "Metal", "SYCL", "OpenCL"):
        if re.search(r"(?<![A-Za-z])" + candidate + r"(?![A-Za-z])", help_text, re.IGNORECASE):
            return candidate
    return None
