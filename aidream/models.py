"""Read-only catalog for locally stored GGUF model files."""
from __future__ import annotations

import hashlib
import json
import os
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
            keep = {"general.architecture", "general.name", "general.basename", "general.quantization_version", "general.file_type", "llama.context_length", "tokenizer.ggml.model"}
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
