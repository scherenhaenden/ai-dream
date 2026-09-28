"""CLI shell; domain behavior is delegated to core services."""

from __future__ import annotations

import argparse
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
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
    parser = argparse.ArgumentParser(prog="aidream", description="Local AI model manager")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("hardware", help="detect CPU, memory, and available accelerators")

    models = sub.add_parser("models", help="manage local model directories")
    model_cmd = models.add_subparsers(dest="models_command", required=True)
    add = model_cmd.add_parser("add", help="register a model directory without moving files")
    add.add_argument("path")
    model_cmd.add_parser("sources", help="list registered model directories")
    model_cmd.add_parser("scan", help="scan registered directories for GGUF models")
    model_cmd.add_parser("list", help="list discovered local models")
    remove_source = model_cmd.add_parser("remove", help="remove a model directory from the catalog")
    remove_source.add_argument("source_id")

    runtime = sub.add_parser("runtime", help="manage llama.cpp installations")
    runtime_cmd = runtime.add_subparsers(dest="runtime_command", required=True)
    runtime_cmd.add_parser("list", help="list registered llama.cpp installations")
    runtime_add = runtime_cmd.add_parser("add", help="register and probe a llama.cpp executable")
    runtime_add.add_argument("executable")
    runtime_add.add_argument("--name")
    runtime_add.add_argument("--kind", default="llama.cpp")
    runtime_add.add_argument("--disabled", action="store_true", help="register without enabling")
    runtime_remove = runtime_cmd.add_parser("remove", help="remove an installation record")
    runtime_remove.add_argument("installation_id")
    runtime_probe = runtime_cmd.add_parser("probe", help="refresh capabilities and devices")
    runtime_probe.add_argument("installation_id")
    runtime_devices = runtime_cmd.add_parser("devices", help="list detected runtime-native devices")
    runtime_devices.add_argument("installation_id", nargs="?")

    profiles = sub.add_parser("profiles", help="manage reusable model profiles")
    profile_cmd = profiles.add_subparsers(dest="profiles_command", required=True)
    profile_list = profile_cmd.add_parser("list", help="list profiles")
    profile_list.add_argument("--model-id")
    profile_show = profile_cmd.add_parser("show", help="show one profile")
    profile_show.add_argument("profile_id")
    profile_create = profile_cmd.add_parser("create", help="create a profile from JSON")
    profile_create_input = profile_create.add_mutually_exclusive_group(required=True)
    profile_create_input.add_argument("--json", help="profile object as JSON")
    profile_create_input.add_argument("--file", help="read profile JSON from a file")
    profile_update = profile_cmd.add_parser("update", help="update a profile from JSON fields")
    profile_update.add_argument("profile_id")
    profile_update_input = profile_update.add_mutually_exclusive_group(required=True)
    profile_update_input.add_argument("--json", help="profile changes as JSON")
    profile_update_input.add_argument("--file", help="read profile changes from a file")
    profile_delete = profile_cmd.add_parser("delete", help="delete a profile")
    profile_delete.add_argument("profile_id")

    sub.add_parser("backends", help="list available inference runtimes")
    serve = sub.add_parser("serve", help="serve the local JSON API on 127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    web = sub.add_parser("web", help="serve the bundled Angular application and API")
    web.add_argument("--port", type=int, default=8765)
    web.add_argument("--stop", action="store_true", help="stop a managed AI Dream web server")
    web.add_argument("--restart", action="store_true", help="stop then start the web server")
    run = sub.add_parser("run", help="load a model and chat in the terminal")
    _add_model_runtime_args(run)
    load = sub.add_parser("load", help="load a model without sending a chat prompt")
    _add_model_runtime_args(load)
    sub.add_parser("unload", help="unload the active model")
    sub.add_parser("status", help="show runtime status")
    chat = sub.add_parser("chat", help="chat with the selected model")
    _add_model_runtime_args(chat, model_required=False)
    bench = sub.add_parser("benchmark", help="benchmark a model configuration or matrix")
    _add_model_runtime_args(bench)
    bench.add_argument("--prompt", default="Explain what a local language model is in one paragraph.")
    bench.add_argument("--results", help="JSON result file (default: application data directory)")
    bench.add_argument("--matrix", help="JSON array of named placement objects")
    return parser


def _add_model_runtime_args(parser, model_required=True):
    parser.add_argument("model", nargs=None if model_required else "?",
                        help="model id or GGUF file path; omit to use active model" if not model_required else "model id or GGUF file path")
    parser.add_argument("--backend", default="auto")
    parser.add_argument("--gpu-layers", type=int)
    parser.add_argument("--device", help="runtime-native device id")
    parser.add_argument("--split-mode")
    parser.add_argument("--tensor-split")
    parser.add_argument("--main-gpu", type=int)
    parser.add_argument("--context-size", type=int)
    parser.add_argument("--threads", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--physical-batch-size", type=int)
    parser.add_argument("--max-concurrent", type=int)
    for name in ("flash-attention", "unified-kv-cache", "offload-kv-cache", "mmap", "keep-model-in-memory"):
        parser.add_argument("--" + name, action=argparse.BooleanOptionalAction, default=None)
    parser.add_argument("--fit", type=_bool_setting)


def _bool_setting(value):
    normalized = str(value).lower()
    if normalized in {"on", "true", "yes", "1"}:
        return True
    if normalized in {"off", "false", "no", "0"}:
        return False
    raise argparse.ArgumentTypeError("expected on/off, true/false, yes/no, or 1/0")


def _json_argument(raw, file_path):
    try:
        payload = Path(file_path).expanduser().read_text(encoding="utf-8") if file_path else raw
        result = json.loads(payload)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read valid JSON: {exc}") from exc
    if not isinstance(result, dict):
        raise ValueError("profile JSON must be an object")
    return result


def _runtime_settings(args):
    placement = {"gpu_layers": args.gpu_layers, "device": args.device,
                 "split_mode": args.split_mode, "tensor_split": args.tensor_split,
                 "main_gpu": args.main_gpu}
    placement = {key: value for key, value in placement.items() if value is not None}
    options = {"context_size": args.context_size, "threads": args.threads,
               "batch_size": args.batch_size, "physical_batch_size": args.physical_batch_size,
               "max_concurrent": args.max_concurrent, "flash_attention": args.flash_attention,
               "unified_kv_cache": args.unified_kv_cache, "offload_kv_cache": args.offload_kv_cache,
               "mmap": args.mmap, "keep_model_in_memory": args.keep_model_in_memory, "fit": args.fit}
    return placement, {key: value for key, value in options.items() if value is not None}


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
            elif args.models_command == "remove":
                catalog.remove_source(args.source_id)
                _print({"removed": True, "source_id": args.source_id})
            else:
                _print(catalog.list_models())
        elif args.command == "runtime":
            from aidream.runtime_installations import RuntimeInstallationRegistry
            registry = RuntimeInstallationRegistry()
            if args.runtime_command == "list":
                _print(registry.list_installations())
            elif args.runtime_command == "add":
                _print(registry.register(args.executable, name=args.name, kind=args.kind,
                                         enabled=not args.disabled))
            elif args.runtime_command == "remove":
                registry.remove(args.installation_id)
                _print({"removed": True, "installation_id": args.installation_id})
            elif args.runtime_command == "probe":
                _print(registry.probe(args.installation_id))
            else:
                installations = registry.list_installations()
                if args.installation_id is not None:
                    installations = [item for item in installations if item.get("id") == args.installation_id]
                    if not installations:
                        raise ValueError(f"Runtime installation not found: {args.installation_id}")
                _print([{"installation_id": item["id"], "runtime": item.get("name"),
                         "devices": item.get("devices", [])} for item in installations])
        elif args.command == "profiles":
            from aidream.model_profiles import ModelProfileStore
            profiles = ModelProfileStore()
            if args.profiles_command == "list":
                _print(profiles.list_profiles(args.model_id))
            elif args.profiles_command == "show":
                _print(profiles.get(args.profile_id))
            elif args.profiles_command == "create":
                _print(profiles.create(_json_argument(args.json, args.file)))
            elif args.profiles_command == "update":
                _print(profiles.update(args.profile_id, _json_argument(args.json, args.file)))
            else:
                profiles.delete(args.profile_id)
                _print({"deleted": True, "profile_id": args.profile_id})
        elif args.command == "serve":
            from aidream.http_api import serve
            serve(args.port)
        elif args.command == "web":
            if args.stop and args.restart:
                raise ValueError("--stop and --restart cannot be used together")
            from aidream.http_api import serve_web, stop_web_server
            if args.stop:
                stop_web_server(args.port)
            else:
                if args.restart:
                    stop_web_server(args.port, missing_ok=True)
                serve_web(args.port)
        elif args.command == "backends":
            from aidream.runtime import RuntimeRegistry
            _print([
                {"name": backend.name, "capabilities": backend.capabilities()}
                for backend in RuntimeRegistry().list_backends()
            ])
        elif args.command == "status":
            try:
                _print(_api_request("GET", "/api/runtime/status"))
            except RuntimeError:
                from aidream.runtime_manager import RuntimeManager
                _print({"server": RuntimeManager().status(), "runtime": {"loaded": False}})
        elif args.command in {"load", "unload", "chat"}:
            if args.command == "unload":
                return _runtime_action("unload")
            if args.command == "load":
                return _runtime_load(args)
            if args.command == "chat" and args.model is None:
                return _runtime_action("chat")
            return _run_chat(args, interactive=args.command in {"run", "chat"})
        elif args.command == "benchmark":
            return _run_benchmark(args)
        else:
            return _run_chat(args, interactive=True)
        return 0
    except (OSError, ValueError, RuntimeError, KeyError) as exc:
        print(f"app: {exc}", file=sys.stderr)
        return 2


def _select_model_backend(model_arg, backend_name):
    from aidream.models import ModelCatalog
    from aidream.runtime import RuntimeRegistry
    catalog = ModelCatalog()
    models = catalog.list_models()
    model = next((m for m in models if getattr(m, "id", None) == model_arg or
                  str(getattr(m, "path", "")) == model_arg), None)
    if model is None:
        path = Path(model_arg).expanduser()
        if path.suffix.lower() != ".gguf" or not path.is_file():
            raise ValueError(f"Model '{model_arg}' was not found; run 'aidream models scan' or pass an existing GGUF path")
        model = path
    registry = RuntimeRegistry()
    backends = registry.list_backends()
    if backend_name == "auto":
        backend = next((b for b in backends if b.capabilities().available and b.can_load(model)), None)
    else:
        backend = next((b for b in backends if getattr(b, "name", "") == backend_name), None)
    if backend is None:
        raise RuntimeError(f"Backend '{backend_name}' is unavailable. See 'aidream backends'.")
    return model, backend


def _run_chat(args: argparse.Namespace, *, interactive=True) -> int:
    model, backend = _select_model_backend(args.model, args.backend)
    placement, options = _runtime_settings(args)
    backend.load(model, placement, options)
    try:
        if not interactive:
            _print({"status": "loaded", "model": str(getattr(model, "id", getattr(model, "path", model))),
                    "backend": backend.name, "placement": placement, "options": options})
            return 0
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


def _runtime_action(action):
    if action == "unload":
        _print(_api_request("POST", "/api/runtime/unload", {}))
        return 0
    if action == "chat":
        while True:
            try:
                prompt = input("you> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return 0
            if prompt == "/exit":
                return 0
            if not prompt:
                continue
            result = _api_request("POST", "/api/runtime/chat", {"prompt": prompt})
            data = result.get("data", result)
            print("assistant> " + str(data.get("response", data.get("assistant", data.get("text", data)))))
    status = _api_request("GET", "/api/runtime/status")
    _print(status)
    return 0


def _runtime_load(args):
    from aidream.models import ModelCatalog
    placement, options = _runtime_settings(args)
    records = ModelCatalog().list_models()
    model = next((item for item in records if item.id == args.model or item.path == args.model), None)
    if model is None:
        candidate = Path(args.model).expanduser()
        if candidate.suffix.lower() != ".gguf" or not candidate.is_file():
            raise ValueError(f"Model '{args.model}' was not found in the catalog or as a GGUF file")
        # The API accepts catalog identifiers. Register the containing directory and resolve again.
        ModelCatalog().add_source(candidate.parent)
        model = next((item for item in ModelCatalog().list_models() if item.path == str(candidate)), None)
    if model is None:
        raise ValueError("Could not resolve model in the local catalog")
    result = _api_request("POST", "/api/runtime/load", {
        "model_id": model.id, "backend": None if args.backend == "auto" else args.backend,
        "placement": placement, "load": options,
    })
    _print(result)
    return 0


def _api_request(method, path, payload=None):
    url = "http://127.0.0.1:8765" + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url, data=data, method=method,
                      headers={"Content-Type": "application/json", "Host": "127.0.0.1:8765",
                               "Origin": "http://127.0.0.1:8765"})
    try:
        timeout_seconds = 240 if path == "/api/runtime/load" else 300 if path == "/api/runtime/chat" else 8
        with urlopen(request, timeout=timeout_seconds) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", str(exc))
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"AI Dream API rejected the request: {detail}") from exc
    except (URLError, OSError, TimeoutError) as exc:
        raise RuntimeError("AI Dream API is not running on 127.0.0.1:8765; start the desktop or run 'aidream web'") from exc
    return result


def _run_benchmark(args):
    from aidream.benchmark import benchmark_one, run_matrix, save_result
    model, backend = _select_model_backend(args.model, args.backend)
    placement, options = _runtime_settings(args)
    if args.matrix:
        try:
            configs = json.loads(args.matrix)
        except json.JSONDecodeError as exc:
            raise ValueError(f"--matrix must be a JSON array: {exc}") from exc
        if not isinstance(configs, list) or not configs or any(not isinstance(item, dict) for item in configs):
            raise ValueError("--matrix must be a non-empty JSON array of placement objects")
        from aidream.runtime import RuntimeRegistry
        result = run_matrix(model, args.prompt, lambda: backend,
            configs, options=options, results_path=args.results)
        print("Configuration | Load s | Prompt tok/s | Generation tok/s | Prompt tokens | Generated tokens")
        for item in result:
            print(f"{item['matrix_name']} | {item['model_load_seconds']:.3f} | "
                  f"{item['prompt_processing_tokens_per_second']:.2f} | {item['generation_tokens_per_second']:.2f} | "
                  f"{item['prompt_token_count']} | {item['generated_token_count']}")
        return 0
    result = benchmark_one(model, args.prompt, backend, placement=placement, options=options)
    result_path = save_result(result, args.results)
    _print({"result": result, "saved_to": result_path})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
