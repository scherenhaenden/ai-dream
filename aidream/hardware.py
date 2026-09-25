"""Best-effort local hardware discovery (Linux first, no Python dependencies)."""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass
class CPUInfo:
    name: str
    logical_cores: int
    physical_cores: int | None = None


@dataclass
class MemoryInfo:
    total_bytes: int | None
    available_bytes: int | None


@dataclass
class OSInfo:
    system: str
    release: str
    version: str
    architecture: str
    distribution: str | None = None


@dataclass
class GPUInfo:
    index: int
    vendor: str
    name: str
    memory_total_bytes: int | None = None
    memory_free_bytes: int | None = None
    backends: list[str] | None = None

    def __post_init__(self) -> None:
        if self.backends is None:
            self.backends = []


@dataclass
class HardwareSnapshot:
    cpu: CPUInfo
    ram: MemoryInfo
    os: OSInfo
    gpus: list[GPUInfo]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _run(args: list[str], timeout: float = 2.0) -> str | None:
    """Run an optional system probe without shell evaluation."""
    if not shutil.which(args[0]):
        return None
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return result.stdout if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def _meminfo() -> MemoryInfo:
    values: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            match = re.match(r"^(MemTotal|MemAvailable):\s+(\d+)\s+kB", line)
            if match:
                values[match.group(1)] = int(match.group(2)) * 1024
    except OSError:
        pass
    return MemoryInfo(values.get("MemTotal"), values.get("MemAvailable"))


def _cpu() -> CPUInfo:
    name = platform.processor() or platform.machine() or "Unknown CPU"
    physical = None
    try:
        text = Path("/proc/cpuinfo").read_text(errors="replace")
        names = re.findall(r"^model name\s*:\s*(.+)$", text, re.M)
        if names:
            name = names[0].strip()
        pairs = set(re.findall(r"^physical id\s*:\s*(\S+)\s*$", text, re.M))
        cores = re.findall(r"^cpu cores\s*:\s*(\d+)\s*$", text, re.M)
        if pairs and cores:
            physical = len(pairs) * int(cores[0])
        elif cores:
            physical = int(cores[0])
    except OSError:
        pass
    return CPUInfo(name, os.cpu_count() or 1, physical)


def _os() -> OSInfo:
    dist = None
    try:
        data: dict[str, str] = {}
        for line in Path("/etc/os-release").read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep:
                data[key] = value.strip().strip('"')
        dist = data.get("PRETTY_NAME") or data.get("NAME")
    except OSError:
        pass
    return OSInfo(platform.system(), platform.release(), platform.version(), platform.machine(), dist)


def _bytes(value: str, unit: str = "MiB") -> int | None:
    try:
        n = float(value.strip())
        if n < 0:
            return None
        return int(n * (1024**2 if unit.lower() in ("mib", "mb") else 1024**3))
    except (ValueError, AttributeError):
        return None


def _nvidia() -> list[GPUInfo]:
    output = _run(["nvidia-smi", "--query-gpu=index,name,memory.total,memory.free", "--format=csv,noheader,nounits"])
    if not output:
        return []
    devices = []
    for line in output.splitlines():
        fields = [x.strip() for x in line.split(",", 3)]
        if len(fields) != 4:
            continue
        try:
            idx = int(fields[0])
        except ValueError:
            continue
        devices.append(GPUInfo(idx, "NVIDIA", fields[1], _bytes(fields[2]), _bytes(fields[3]), ["cuda"]))
    return devices


def _rocm() -> list[GPUInfo]:
    output = _run(["rocm-smi", "--json"])
    if not output:
        return []
    try:
        data = json.loads(output)
    except (ValueError, TypeError):
        return []
    devices: list[GPUInfo] = []
    # rocm-smi output uses GPU[0] records, with key names varying by version.
    for key, record in data.items():
        if not isinstance(record, dict) or not key.lower().startswith("gpu"):
            continue
        match = re.search(r"(\d+)", key)
        if not match:
            continue
        normalized = {str(k).lower().replace("_", " "): str(v) for k, v in record.items()}
        name = next((v for k, v in normalized.items() if "product name" in k or " card series" in k), "AMD GPU")
        total = next((v for k, v in normalized.items() if "vram total" in k or "memory total" in k), "")
        used = next((v for k, v in normalized.items() if "vram used" in k or "memory used" in k), "")
        total_b = _bytes(re.sub(r"[^\d.]", "", total), "MiB")
        used_b = _bytes(re.sub(r"[^\d.]", "", used), "MiB")
        devices.append(GPUInfo(int(match.group(1)), "AMD", name, total_b,
                               max(0, total_b - used_b) if total_b is not None and used_b is not None else None,
                               ["rocm"]))
    return devices


def _sysfs_gpus() -> list[GPUInfo]:
    found: list[GPUInfo] = []
    root = Path("/sys/bus/pci/devices")
    try:
        devices = sorted(root.iterdir())
    except OSError:
        return found
    for entry in devices:
        try:
            if int((entry / "class").read_text().strip(), 16) >> 16 != 0x03:
                continue
            vendor_id = (entry / "vendor").read_text().strip().lower()
            vendor = {"0x10de": "NVIDIA", "0x1002": "AMD", "0x8086": "Intel"}.get(vendor_id, vendor_id)
            name = vendor + " GPU"
            # PCI device IDs are not reliably human-readable without pci.ids/lspci.
            found.append(GPUInfo(len(found), vendor, name, backends=[]))
        except (OSError, ValueError):
            continue
    return found


class HardwareService:
    """Detect host CPU, memory, OS and available GPU devices."""

    def detect(self) -> HardwareSnapshot:
        gpus = _nvidia()
        if not gpus:
            gpus = _rocm()
        if not gpus:
            gpus = _sysfs_gpus()
        return HardwareSnapshot(_cpu(), _meminfo(), _os(), gpus)
