"""Benchmark execution and durable JSON result storage."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
import time
from typing import Any, Mapping
from urllib.request import Request, urlopen


def default_results_path() -> Path:
    data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")).expanduser()
    return data_home / "ai-dream" / "benchmarks.json"


def save_result(result: Mapping[str, Any], path: str | Path | None = None) -> Path:
    """Append a JSON-safe result atomically to the benchmark result array."""
    destination = Path(path) if path else default_results_path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        existing = json.loads(destination.read_text(encoding="utf-8")) if destination.exists() else []
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read benchmark results at {destination}: {exc}") from exc
    if not isinstance(existing, list):
        raise ValueError("benchmark results file must contain a JSON array")
    existing.append(dict(result))
    payload = json.dumps(existing, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=".benchmarks-", dir=destination.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return destination


def _token_count(backend, text: str) -> int:
    """Use llama-server's tokenizer endpoint when available; estimate only as fallback."""
    base_url = getattr(backend, "_base_url", None)
    if base_url:
        try:
            request = Request(base_url + "/tokenize", data=json.dumps({"content": text}).encode(),
                              headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(request, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
            tokens = data.get("tokens") if isinstance(data, dict) else None
            if isinstance(tokens, list):
                return len(tokens)
        except Exception:
            pass
    # Labelled fallback is useful on older servers without /tokenize.
    return len(re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE))


def _server_metrics(backend) -> dict[str, float]:
    """Read llama-server's Prometheus counters when that build exposes them."""
    base_url = getattr(backend, "_base_url", None)
    if not base_url:
        return {}
    try:
        with urlopen(base_url + "/metrics", timeout=3) as response:
            body = response.read(512 * 1024).decode("utf-8", errors="replace")
    except Exception:
        return {}
    result = {}
    for line in body.splitlines():
        if not line or line.startswith("#"):
            continue
        name, _, raw = line.partition(" ")
        # llama.cpp releases have used both llamacpp and llama-server prefixes.
        key = name.rsplit(":", 1)[-1]
        if key in {"prompt_tokens_total", "prompt_seconds_total", "tokens_predicted_total", "predicted_tokens_total", "predicted_seconds_total"}:
            try:
                result[key] = float(raw.strip())
            except ValueError:
                pass
    return result


def benchmark_one(model: Any, prompt: str, backend: Any, *, placement=None,
                  options=None, generation_options=None) -> dict[str, Any]:
    started = time.perf_counter()
    backend.load(model, placement or {}, options or {})
    loaded_at = time.perf_counter()
    try:
        prompt_tokens = _token_count(backend, prompt)
        before_metrics = _server_metrics(backend)
        generation_started = time.perf_counter()
        output = backend.generate(prompt, generation_options or {})
        ended = time.perf_counter()
        after_metrics = _server_metrics(backend)
        generated_tokens = _token_count(backend, output)
        prompt_tokens_delta = after_metrics.get("prompt_tokens_total", 0) - before_metrics.get("prompt_tokens_total", 0)
        prompt_seconds_delta = after_metrics.get("prompt_seconds_total", 0) - before_metrics.get("prompt_seconds_total", 0)
        server_prompt_rate = (prompt_tokens_delta / prompt_seconds_delta
                              if prompt_tokens_delta > 0 and prompt_seconds_delta > 0 else None)
        predicted_seconds = after_metrics.get("predicted_seconds_total", 0) - before_metrics.get("predicted_seconds_total", 0)
        predicted_count = (after_metrics.get("tokens_predicted_total", after_metrics.get("predicted_tokens_total", 0))
                           - before_metrics.get("tokens_predicted_total", before_metrics.get("predicted_tokens_total", 0)))
        server_generation_rate = (predicted_count / predicted_seconds
                                  if predicted_count > 0 and predicted_seconds > 0 else None)
        generation_seconds = max(ended - generation_started, 1e-9)
        caps = backend.capabilities()
        return {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model": str(getattr(model, "id", getattr(model, "path", model))),
            "model_load_seconds": loaded_at - started,
            "prompt_processing_tokens_per_second": server_prompt_rate if server_prompt_rate is not None else 0.0,
            "generation_tokens_per_second": server_generation_rate if server_generation_rate is not None else generated_tokens / generation_seconds,
            "prompt_token_count": prompt_tokens,
            "generated_token_count": generated_tokens,
            "token_count_method": "llama-server /tokenize" if getattr(backend, "_base_url", None) else "text estimate",
            "server_metrics_available": server_prompt_rate is not None or server_generation_rate is not None,
            "backend": getattr(backend, "name", "unknown"),
            "devices": (placement or {}).get("device"),
            "split_mode": (placement or {}).get("split_mode"),
            "tensor_split": (placement or {}).get("tensor_split"),
            "load_settings": {"placement": dict(placement or {}), "options": dict(options or {})},
            "runtime": {"executable": getattr(caps, "executable", None)},
        }
    finally:
        backend.unload()


def run_matrix(model: Any, prompt: str, backend_factory, configs, *, options=None,
               generation_options=None, results_path=None) -> list[dict[str, Any]]:
    results = []
    for config in configs:
        placement = config.get("placement", config)
        result = benchmark_one(model, prompt, backend_factory(), placement=placement,
                               options=options, generation_options=generation_options)
        result["matrix_name"] = config.get("name", "configuration")
        save_result(result, results_path)
        results.append(result)
    return results
