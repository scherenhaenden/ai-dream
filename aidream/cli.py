"""CLI shell; domain behavior is delegated to core services."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any


def _jsonable(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if hasattr(value, "__dict__"):
        return vars(value)
    return value


def _print(value: Any) -> None:
    print(json.dumps(_jsonable(value), indent=2, ensure_ascii=False, default=str))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="app", description="Local AI model manager")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("hardware", help="detect CPU, memory, and available accelerators")

    models = sub.add_parser("models", help="manage local model directories")
    model_cmd = models.add_subparsers(dest="models_command", required=True)
    add = model_cmd.add_parser("add", help="register a model directory without moving files")
    add.add_argument("path")
    model_cmd.add_parser("sources", help="list registered model directories")
    model_cmd.add_parser("scan", help="scan registered directories for GGUF models")
    model_cmd.add_parser("list", help="list discovered local models")

    sub.add_parser("backends", help="list available inference runtimes")
    run = sub.add_parser("run", help="load a model and chat in the terminal")
    run.add_argument("model", help="model id or GGUF file path")
    run.add_argument("--backend", default="auto")
    run.add_argument("--gpu-layers", type=int, help="GPU layers, when supported by the selected backend")
    run.add_argument("--device", help="runtime device name, when supported by the selected backend")
    run.add_argument("--tensor-split", help="runtime tensor split, when supported by the selected backend")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "hardware":
            from aidream.hardware import HardwareService
            _print(HardwareService().detect())
        elif args.command == "models":
            from aidream.models import ModelCatalog
            catalog = ModelCatalog()
            if args.models_command == "add":
                _print(catalog.add_source(args.path))
            elif args.models_command == "sources":
                _print(catalog.list_sources())
            elif args.models_command == "scan":
                _print(catalog.scan())
            else:
                _print(catalog.list_models())
        elif args.command == "backends":
            from aidream.runtime import RuntimeRegistry
            _print([
                {"name": backend.name, "capabilities": backend.capabilities()}
                for backend in RuntimeRegistry().list_backends()
            ])
        else:
            return _run_chat(args)
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"app: {exc}", file=sys.stderr)
        return 2


def _run_chat(args: argparse.Namespace) -> int:
    from aidream.models import ModelCatalog
    from aidream.runtime import RuntimeRegistry

    catalog = ModelCatalog()
    models = catalog.list_models()
    model = next((m for m in models if getattr(m, "id", None) == args.model or
                  str(getattr(m, "path", "")) == args.model), None)
    if model is None:
        path = Path(args.model).expanduser()
        if path.suffix.lower() != ".gguf" or not path.is_file():
            raise ValueError(f"Model '{args.model}' was not found; run 'app models scan' or pass an existing GGUF path")
        model = path
    registry = RuntimeRegistry()
    backends = registry.list_backends()
    if args.backend == "auto":
        backend = next((b for b in backends if b.capabilities().available and b.can_load(model)), None)
    else:
        backend = next((b for b in backends if getattr(b, "name", "") == args.backend), None)
    if backend is None:
        raise RuntimeError(f"Backend '{args.backend}' is unavailable. See 'app backends'.")
    placement = {}
    if args.gpu_layers is not None:
        placement["gpu_layers"] = args.gpu_layers
    if args.device is not None:
        placement["device"] = args.device
    if args.tensor_split is not None:
        placement["tensor_split"] = args.tensor_split
    backend.load(model, placement)
    try:
        print("Model ready. Enter /exit to unload and quit.")
        while True:
            prompt = input("you> ").strip()
            if prompt == "/exit":
                break
            if not prompt:
                continue
            response = backend.generate(prompt)
            print(f"assistant> {response}")
    finally:
        backend.unload()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
