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
    pci_address: str | None = None
    virtual: bool = False
    pci_vendor_id: int | None = None
    pci_device_id: int | None = None

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


def _canonical_bdf(value: str) -> str | None:
    match = re.search(r"(?i)(?:([0-9a-f]{1,8}):)?([0-9a-f]{1,2}):([0-9a-f]{1,2})\.([0-7])", value.strip())
    if not match:
        return None
    domain, bus, device, function = match.groups()
    return f"{int(domain or '0', 16):04x}:{int(bus, 16):02x}:{int(device, 16):02x}.{function}"


def _nvidia() -> list[GPUInfo]:
    output = _run(["nvidia-smi", "--query-gpu=index,name,memory.total,memory.free,pci.bus_id", "--format=csv,noheader,nounits"])
    if not output:
        return []
    devices = []
    for line in output.splitlines():
        fields = [x.strip() for x in line.split(",", 4)]
        if len(fields) < 4:
            continue
        try:
            idx = int(fields[0])
        except ValueError:
            continue
        devices.append(GPUInfo(idx, "NVIDIA", fields[1], _bytes(fields[2]), _bytes(fields[3]), ["cuda"],
                               _canonical_bdf(fields[4]) if len(fields) > 4 else None))
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
        bdf_value = next((v for k, v in normalized.items() if "pci bus" in k or "bdf" in k or k.strip() == "bus"), "")
        total_b = _bytes(re.sub(r"[^\d.]", "", total), "MiB")
        used_b = _bytes(re.sub(r"[^\d.]", "", used), "MiB")
        devices.append(GPUInfo(int(match.group(1)), "AMD", name, total_b,
                               max(0, total_b - used_b) if total_b is not None and used_b is not None else None,
                               ["rocm"], _canonical_bdf(bdf_value)))
    return devices


def _sysfs_gpus() -> list[GPUInfo]:
    found: list[GPUInfo] = []
    root = Path("/sys/bus/pci/devices")
    try:
        devices = sorted(root.iterdir())
    except OSError:
        return found
    lspci_names = _lspci_names()
    for entry in devices:
        try:
            if int((entry / "class").read_text().strip(), 16) >> 16 != 0x03:
                continue
            vendor_id = (entry / "vendor").read_text().strip().lower()
            vendor = {"0x10de": "NVIDIA", "0x1002": "AMD", "0x8086": "Intel"}.get(vendor_id, vendor_id)
            address = entry.name.lower()
            name = lspci_names.get(address) or _pci_name(vendor_id, (entry / "device").read_text().strip().lower())
            # Keep an address suffix when no device database could name the device;
            # this prevents two identical generic adapters from collapsing.
            if not name:
                name = f"{vendor} GPU ({address})"
            device_id = (entry / "device").read_text().strip().lower()
            found.append(GPUInfo(len(found), vendor, name, backends=[], pci_address=_canonical_bdf(address),
                                 pci_vendor_id=int(vendor_id, 16), pci_device_id=int(device_id, 16)))
        except (OSError, ValueError):
            continue
    return found


def _lspci_names() -> dict[str, str]:
    output = _run(["lspci", "-Dnn"])
    result: dict[str, str] = {}
    if not output:
        return result
    for line in output.splitlines():
        match = re.match(r"^([0-9a-fA-F:.]+)\s+(?:VGA compatible controller|3D controller|Display controller)(?:\s+\[[^]]+\])?:\s*(.*)$", line, re.I)
        if not match:
            continue
        address, desc = match.groups()
        desc = re.sub(r"\s*\[[0-9a-fA-F]{4}:[0-9a-fA-F]{4}\]\s*$", "", desc).strip()
        canonical = _canonical_bdf(address)
        if canonical:
            result[canonical] = desc
    return result


def _pci_name(vendor_id: str, device_id: str) -> str | None:
    """Look up a PCI marketing name from common pci.ids locations."""
    paths = (Path("/usr/share/hwdata/pci.ids"), Path("/usr/share/misc/pci.ids"))
    try:
        vendor_num = vendor_id.removeprefix("0x").lower()
        device_num = device_id.removeprefix("0x").lower()
        for path in paths:
            try:
                lines = path.read_text(errors="replace").splitlines()
            except OSError:
                continue
            in_vendor = False
            for line in lines:
                if not line or line.startswith("#"):
                    continue
                if not line[0].isspace():
                    in_vendor = line.split()[0].lower() == vendor_num
                elif in_vendor and not line.startswith("\t\t") and line.split()[0].lower() == device_num:
                    return line.strip()[len(device_num):].strip()
    except (OSError, IndexError):
        pass
    return None


def _vulkan() -> list[GPUInfo]:
    """Read actual enumerated physical devices from vulkaninfo --summary."""
    output = _run(["vulkaninfo", "--summary"], timeout=4.0)
    if not output:
        return []
    devices: list[GPUInfo] = []
    # The summary format groups properties beneath 'GPU<n>:'; require a deviceName
    # before emitting anything, so loader presence alone never claims Vulkan support.
    chunks = re.split(r"(?m)^GPU\d+:\s*$", output)
    for chunk in chunks[1:]:
        name_m = re.search(r"(?m)^\s*deviceName\s*=\s*(.+?)\s*$", chunk)
        vendor_m = re.search(r"(?m)^\s*vendorID\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*$", chunk)
        device_m = re.search(r"(?m)^\s*deviceID\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*$", chunk)
        type_m = re.search(r"(?m)^\s*deviceType\s*=\s*(.+?)\s*$", chunk)
        if not name_m or (type_m and "cpu" in type_m.group(1).casefold()):
            continue
        name = name_m.group(1).strip()
        vendor_id = int(vendor_m.group(1), 0) if vendor_m else None
        vendor = {0x10DE: "NVIDIA", 0x1002: "AMD", 0x8086: "Intel"}.get(vendor_id, f"PCI {vendor_id:04x}" if vendor_id is not None else "Unknown")
        virtual = bool(type_m and "virtual" in type_m.group(1).casefold())
        if virtual:
            name = f"{name} (virtual)"
        def pci_field(field: str) -> int | None:
            match = re.search(rf"(?m)^\s*pci{field}\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*$", chunk, re.I)
            return int(match.group(1), 0) if match else None
        domain, bus, device, function = (pci_field(k) for k in ("Domain", "Bus", "Device", "Function"))
        bdf = f"{domain or 0:04x}:{bus:02x}:{device:02x}.{function}" if bus is not None and device is not None and function is not None else None
        device_id = int(device_m.group(1), 0) if device_m else None
        devices.append(GPUInfo(len(devices), vendor, name, backends=["vulkan"], pci_address=bdf, virtual=virtual,
                               pci_vendor_id=vendor_id, pci_device_id=device_id))
    return devices


def _merge_gpus(providers: list[GPUInfo], pci: list[GPUInfo], vulkan: list[GPUInfo]) -> list[GPUInfo]:
    """Merge only one-to-one exact vendor/model matches; avoid guessed mappings."""
    result = [GPUInfo(g.index, g.vendor, g.name, g.memory_total_bytes, g.memory_free_bytes,
                      list(g.backends or []), g.pci_address, g.virtual,
                      g.pci_vendor_id, g.pci_device_id) for g in providers]
    def key(gpu: GPUInfo) -> tuple[str, str]:
        return gpu.vendor.casefold(), re.sub(r"\s+", " ", gpu.name).strip().casefold()
    for source in (pci, vulkan):
        consumed: set[int] = set()
        for candidate in source:
            match = next((i for i, existing in enumerate(result)
                          if i not in consumed and existing.pci_address and candidate.pci_address
                          and existing.pci_address == candidate.pci_address), None)
            if match is None:
                match = next((i for i, existing in enumerate(result)
                              if i not in consumed and existing.pci_vendor_id is not None
                              and existing.pci_device_id is not None
                              and existing.pci_vendor_id == candidate.pci_vendor_id
                              and existing.pci_device_id == candidate.pci_device_id), None)
            if match is None:
                match = next((i for i, existing in enumerate(result)
                              if i not in consumed and key(existing) == key(candidate)), None)
            if match is not None:
                consumed.add(match)
                existing = result[match]
                existing.backends = sorted(set(existing.backends or []) | set(candidate.backends or []))
                existing.memory_total_bytes = existing.memory_total_bytes or candidate.memory_total_bytes
                existing.memory_free_bytes = existing.memory_free_bytes or candidate.memory_free_bytes
                existing.pci_address = existing.pci_address or candidate.pci_address
                existing.virtual = existing.virtual or candidate.virtual
                if existing.pci_vendor_id is None:
                    existing.pci_vendor_id = candidate.pci_vendor_id
                if existing.pci_device_id is None:
                    existing.pci_device_id = candidate.pci_device_id
            else:
                # Every input record represents a distinct device within this source;
                # never match a later sibling against one appended from the same source.
                consumed.add(len(result))
                result.append(candidate)
    # Global stable indexes independent of overlapping vendor-local utility indexes.
    for index, gpu in enumerate(result):
        gpu.index = index
    return result


class HardwareService:
    """Detect host CPU, memory, OS and available GPU devices."""

    def detect(self) -> HardwareSnapshot:
        providers = _nvidia() + _rocm()
        pci = _sysfs_gpus()
        vulkan = _vulkan()
        gpus = _merge_gpus(providers, pci, vulkan)
        return HardwareSnapshot(_cpu(), _meminfo(), _os(), gpus)
