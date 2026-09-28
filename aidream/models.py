"""Read-only catalog for locally stored GGUF model files."""
from __future__ import annotations

import hashlib
import json
import os
import re
import struct
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ModelRecord:
    id: str
    path: str
    size: int
    format: str = "gguf"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def display_info(self) -> dict[str, Any]:
        """Return user-facing local model details without guessing missing facts."""
        meta = self.metadata
        name = meta.get("general.name") or meta.get("general.basename") or Path(self.path).name
        quantization = _quantization_label(meta, self.path)
        license_name = meta.get("general.license") or meta.get("general.license.name")
        source = meta.get("general.source.url") or meta.get("general.source.name") or "Local file"
        return {
            "id": self.id,
            "name": str(name),
            "format": self.format.upper(),
            "size_bytes": self.size,
            "size_human": _human_size(self.size),
            "quantization": quantization,
            "architecture": meta.get("general.architecture", "Unknown"),
            "context_length": meta.get(f"{meta.get('general.architecture', '')}.context_length"),
            "license": str(license_name) if license_name else "Not declared in GGUF metadata",
            "source": str(source),
            "path": self.path,
        }


_FILE_TYPE_QUANTIZATION = {
    0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 7: "Q8_0", 8: "Q5_0",
    9: "Q5_1", 10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M", 13: "Q3_K_L",
    14: "Q4_K_S", 15: "Q4_K_M", 16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K",
    19: "IQ2_XXS", 20: "IQ2_XS", 21: "IQ3_XXS", 22: "IQ1_S", 23: "IQ4_NL",
    24: "IQ3_S", 25: "IQ2_S", 26: "IQ4_XS", 27: "I8", 28: "I16", 29: "I32",
    30: "I64", 31: "F64", 32: "IQ1_M", 33: "BF16", 34: "Q4_0_4_4", 35: "Q4_0_4_8",
    36: "Q4_0_8_8",
}


def _quantization_label(metadata: dict[str, Any], path: str) -> str:
    file_type = metadata.get("general.file_type")
    if isinstance(file_type, int):
        label = _FILE_TYPE_QUANTIZATION.get(file_type)
        if label:
            return label
    # Many converters omit general.file_type. A filename hint is useful, but
    # deliberately presented as a hint rather than verified tensor metadata.
    match = re.search(r"(?i)(?:^|[-_.])(IQ\d_[A-Z0-9_]+|Q\d(?:_K(?:_[SML])?|_[01])|F16|F32|BF16)(?=$|[-_.])", Path(path).name)
    return match.group(1).upper() + " (filename)" if match else "Unknown"


def _human_size(size: int) -> str:
    if size < 0:
        return "Unknown"
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024 or unit == "TiB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return "Unknown"


def _read_exact(stream, size: int) -> bytes:
    data = stream.read(size)
    if len(data) != size:
        raise ValueError("truncated GGUF header")
    return data


def _string(stream) -> str:
    n = struct.unpack("<Q", _read_exact(stream, 8))[0]
    if n > 1_048_576:
        raise ValueError("unreasonably long GGUF string")
    return _read_exact(stream, n).decode("utf-8", errors="replace")


def _value(stream, kind: int, depth: int = 0) -> Any:
    # GGUF metadata value types (spec 2.x); arrays are bounded to avoid scanning
    # arbitrarily large data in a malformed file.
    fmts = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}
    if kind == 8:
        return _string(stream)
    if kind == 9:
        if depth > 2:
            raise ValueError("nested GGUF array")
        subtype, count = struct.unpack("<IQ", _read_exact(stream, 12))
        if count > 10000:
            raise ValueError("oversized GGUF metadata array")
        return [_value(stream, subtype, depth + 1) for _ in range(count)]
    fmt = fmts.get(kind)
    if fmt is None:
        raise ValueError("unknown GGUF metadata type")
    return struct.unpack("<" + fmt, _read_exact(stream, struct.calcsize(fmt)))[0]


def _metadata(path: Path) -> dict[str, Any]:
    """Read safe, lightweight identifying metadata from a GGUF header."""
    result: dict[str, Any] = {}
    try:
        with path.open("rb") as f:
            if _read_exact(f, 4) != b"GGUF":
                return result
            version, tensors, count = struct.unpack("<IQQ", _read_exact(f, 20))
            result.update(gguf_version=version, tensor_count=tensors)
            if count > 10000:
                return result
            keep = {"general.architecture", "general.name", "general.basename", "general.quantization_version", "general.file_type", "general.license", "general.license.name", "general.source.url", "general.source.name", "llama.context_length", "tokenizer.ggml.model"}
            for _ in range(count):
                key = _string(f)
                kind = struct.unpack("<I", _read_exact(f, 4))[0]
                value = _value(f, kind)
                if key in keep:
                    result[key] = value
    except (OSError, ValueError, struct.error):
        # Invalid or partial GGUF files remain discoverable; metadata is best effort.
        pass
    return result


class ModelCatalog:
    """Indexes configured directories without writing into or moving their contents."""

    def __init__(self, config_dir: str | os.PathLike[str] | None = None):
        self.config_dir = Path(config_dir).expanduser() if config_dir else Path.home() / ".config" / "ai-dream"
        self.sources_file = self.config_dir / "model-sources.json"

    def _load_sources(self) -> list[str]:
        try:
            data = json.loads(self.sources_file.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [str(x) for x in data if isinstance(x, str)]
        except (OSError, ValueError):
            pass
        return []

    def add_source(self, path: str | os.PathLike[str]) -> str:
        expanded = Path(path).expanduser().resolve()
        if not expanded.exists() or not expanded.is_dir():
            raise ValueError(f"model source must be an existing directory: {expanded}")
        sources = self._load_sources()
        canonical = str(expanded)
        if canonical not in sources:
            sources.append(canonical)
            self.config_dir.mkdir(parents=True, exist_ok=True)
            temp = self.sources_file.with_suffix(".json.tmp")
            temp.write_text(json.dumps(sources, indent=2) + "\n", encoding="utf-8")
            temp.replace(self.sources_file)
        return canonical

    def list_sources(self) -> list[str]:
        return self._load_sources()

    @staticmethod
    def _source_id(path: str | os.PathLike[str]) -> str:
        """Return an opaque, stable identifier for a canonical source path."""
        canonical = str(Path(path).expanduser().resolve())
        return hashlib.sha256(("ai-dream-model-source\0" + canonical).encode("utf-8")).hexdigest()[:32]

    def _managed_model_dir(self) -> Path:
        data_home = os.environ.get("XDG_DATA_HOME")
        root = Path(data_home).expanduser() if data_home and Path(data_home).expanduser().is_absolute() else Path.home() / ".local" / "share"
        return (root / "ai-dream" / "models").resolve()

    def list_source_details(self) -> list[dict[str, Any]]:
        """Describe registered model directories and the GGUF files they contain.

        Source IDs are stable hashes of canonical paths. `managed` identifies
        the application's own download directory; removing that source never
        removes its files.
        """
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        managed_root = self._managed_model_dir()
        for raw_path in self._load_sources():
            root = Path(raw_path).expanduser().resolve()
            canonical = str(root)
            if canonical in seen:
                continue
            seen.add(canonical)
            try:
                managed = root == managed_root or root.is_relative_to(managed_root)
            except (OSError, ValueError):
                managed = False
            exists = root.exists() and root.is_dir()
            readable = bool(exists and os.access(root, os.R_OK | os.X_OK))
            model_count = total_bytes = 0
            if readable:
                try:
                    for base, dirs, files in os.walk(root, followlinks=False):
                        dirs.sort()
                        for name in sorted(files):
                            if not name.lower().endswith(".gguf"):
                                continue
                            path = Path(base) / name
                            try:
                                if path.is_file():
                                    size = path.stat().st_size
                                    model_count += 1
                                    total_bytes += size
                            except OSError:
                                continue
                except OSError:
                    readable = False
                    model_count = total_bytes = 0
            result.append({"id": self._source_id(canonical), "path": canonical,
                           "canonical_path": canonical, "exists": exists,
                           "readable": readable, "managed": managed,
                           "model_count": model_count, "total_bytes": total_bytes})
        return result

    def remove_source(self, source_id: str) -> None:
        """Unregister a source by its opaque ID without touching model files."""
        if not isinstance(source_id, str) or not re.fullmatch(r"[a-f0-9]{32}", source_id):
            raise ValueError("invalid model source ID")
        sources = self._load_sources()
        remaining = [path for path in sources if self._source_id(path) != source_id]
        if len(remaining) == len(sources):
            raise KeyError(f"Model source not found: {source_id}")
        self.config_dir.mkdir(parents=True, exist_ok=True)
        temp = self.sources_file.with_suffix(".json.tmp")
        temp.write_text(json.dumps(remaining, indent=2) + "\n", encoding="utf-8")
        temp.replace(self.sources_file)

    def scan(self) -> list[ModelRecord]:
        found: dict[str, ModelRecord] = {}
        for source in self.list_sources():
            root = Path(source)
            if not root.is_dir():
                continue
            try:
                for base, dirs, files in os.walk(root, followlinks=False):
                    dirs.sort()
                    for name in sorted(files):
                        if not name.lower().endswith(".gguf"):
                            continue
                        path = Path(base) / name
                        try:
                            resolved = str(path.resolve(strict=True))
                            stat = path.stat()
                            if not path.is_file() or resolved in found:
                                continue
                            digest = hashlib.sha256(resolved.encode("utf-8")).hexdigest()[:24]
                            found[resolved] = ModelRecord(digest, resolved, stat.st_size, "gguf", _metadata(path))
                        except OSError:
                            continue
            except OSError:
                continue
        return sorted(found.values(), key=lambda item: (item.path.casefold(), item.path))

    def list_models(self) -> list[ModelRecord]:
        return self.scan()
