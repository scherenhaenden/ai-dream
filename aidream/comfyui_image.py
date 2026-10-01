"""Explicit, loopback-only ComfyUI image-generation integration.

No service is discovered or contacted unless ``AI_DREAM_COMFYUI_URL`` is set.
Health and checkpoint discovery use read-only ComfyUI endpoints; workflow
submission happens only from ``generate_image`` after a user starts a skill.
"""
from __future__ import annotations

import hashlib
import json
import os
import ipaddress
import re
import time
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import (HTTPRedirectHandler, ProxyHandler, Request,
                            build_opener)

from aidream.runtime_adapters import RuntimeErrorCode, RuntimeFailure


_MAX_JSON = 4 * 1024 * 1024
_MAX_IMAGE = 32 * 1024 * 1024
_PROMPT_ID = re.compile(r"[A-Za-z0-9-]{1,128}\Z")
_CHECKPOINT = re.compile(r"[^\x00-\x1f\x7f]{1,512}\Z")
_SAMPLE_PNG = b"\x89PNG\r\n\x1a\n"
_SAMPLE_JPEG = b"\xff\xd8\xff"


def _valid_checkpoint_name(value: Any) -> bool:
    return (isinstance(value, str) and bool(_CHECKPOINT.fullmatch(value))
            and not value.startswith(("/", "\\")) and "\\" not in value
            and all(part not in {"", ".", ".."} for part in value.split("/")))


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ComfyUIBackend:
    """Use a separately installed ComfyUI service on an explicit loopback URL.

    This backend supports prompt-to-image generation and unmasked img2img
    editing. It does not assert that outputs are semantically good.
    """

    runtime_id = "comfyui-local"
    name = "ComfyUI (local)"
    local_only = True
    network_access = False

    def __init__(self, base_url: str, *, opener=None,
                 poll_interval: float = 0.5, workflow_timeout: float = 180.0):
        try:
            self.base_url = self._normalize_local_url(base_url)
            self.configuration_error = None
        except ValueError as exc:
            # Keep an invalid explicit setting visible as unavailable in the
            # capability diagnostics, without ever opening a connection.
            self.base_url = None
            self.configuration_error = str(exc)
        self._opener = opener or build_opener(ProxyHandler({}), _NoRedirect())
        self._poll_interval = max(0.05, min(float(poll_interval), 2.0))
        self._workflow_timeout = max(1.0, min(float(workflow_timeout), 300.0))
        self._loaded_model: Mapping[str, Any] | None = None
        self._checkpoint_cache: tuple[str, ...] = ()
        self._checkpoint_cache_at = 0.0
        self._active_prompt_id: str | None = None
        self._cancelled_prompt_id: str | None = None

    @classmethod
    def from_environment(cls, *, environ=None, **kwargs):
        value = (os.environ if environ is None else environ).get("AI_DREAM_COMFYUI_URL")
        if not isinstance(value, str) or not value.strip():
            return None
        return cls(value.strip(), **kwargs)

    @staticmethod
    def _normalize_local_url(value: str) -> str:
        if not isinstance(value, str) or len(value) > 512:
            raise ValueError("ComfyUI URL must be bounded text")
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("ComfyUI URL must use HTTP(S) with a loopback host and no credentials")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("ComfyUI URL must be a local origin without a path, query, or fragment")
        host = parsed.hostname.casefold()
        if host == "localhost":
            normalized_host = "127.0.0.1"
        else:
            try:
                address = ipaddress.ip_address(host)
            except ValueError as exc:
                raise ValueError("ComfyUI URL host must be localhost or a loopback IP address") from exc
            if not address.is_loopback:
                raise ValueError("ComfyUI URL host must be localhost or a loopback IP address")
            normalized_host = address.compressed
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not 1 <= port <= 65535:
            raise ValueError("ComfyUI URL port is invalid")
        host_part = f"[{normalized_host}]" if ":" in normalized_host else normalized_host
        return urlunsplit((parsed.scheme, f"{host_part}:{port}", "", "", ""))

    def _url(self, path: str) -> str:
        # Revalidate on every request so mutable configuration cannot widen
        # the transport beyond numeric loopback.
        if not self.base_url:
            raise RuntimeError("Invalid ComfyUI configuration: " + str(self.configuration_error or "missing local URL"))
        base = self._normalize_local_url(self.base_url)
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("ComfyUI request path must be local and absolute")
        return base + path

    def _request(self, path: str, *, method="GET", payload=None,
                 timeout=2.0, max_bytes=_MAX_JSON) -> bytes:
        url = self._url(path)
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(url, data=data, method=method,
                          headers={"Accept": "application/json, image/png",
                                   **({"Content-Type": "application/json"} if data is not None else {})})
        return self._open_request(url, request, timeout=timeout, max_bytes=max_bytes)

    def _request_bytes(self, path: str, data: bytes, content_type: str, *,
                       timeout=10.0, max_bytes=_MAX_JSON) -> bytes:
        url = self._url(path)
        request = Request(url, data=data, method="POST", headers={
            "Accept": "application/json", "Content-Type": content_type,
        })
        return self._open_request(url, request, timeout=timeout, max_bytes=max_bytes)

    def _open_request(self, url: str, request: Request, *, timeout: float,
                      max_bytes: int) -> bytes:
        try:
            response = self._opener.open(request, timeout=timeout)
        except HTTPError as exc:
            if 300 <= exc.code < 400:
                exc.close()
                raise RuntimeError("ComfyUI redirected the request; redirects are blocked for local-only access") from exc
            raise RuntimeError(f"ComfyUI returned HTTP {exc.code}") from exc
        except (URLError, OSError, TimeoutError) as exc:
            raise RuntimeError("ComfyUI is unreachable at the configured loopback URL") from exc
        with response:
            final_url = getattr(response, "geturl", lambda: url)()
            if self._normalize_local_url(urlsplit(final_url)._replace(path="", query="", fragment="").geturl()) != self.base_url:
                raise RuntimeError("ComfyUI response escaped the configured loopback origin")
            body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise RuntimeError("ComfyUI response exceeded the configured size limit")
        return body

    def _json(self, path: str, *, method="GET", payload=None) -> Any:
        try:
            value = json.loads(self._request(path, method=method, payload=payload).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("ComfyUI returned invalid JSON") from exc
        return value

    def _checkpoint_names(self) -> tuple[str, ...]:
        if time.monotonic() - self._checkpoint_cache_at < 1.0:
            return self._checkpoint_cache
        response = self._json("/object_info/CheckpointLoaderSimple")
        node = response.get("CheckpointLoaderSimple") if isinstance(response, Mapping) else None
        required = node.get("input", {}).get("required", {}) if isinstance(node, Mapping) else {}
        options = required.get("ckpt_name") if isinstance(required, Mapping) else None
        names = options[0] if isinstance(options, list) and options else ()
        if not isinstance(names, list):
            return ()
        self._checkpoint_cache = tuple(name for name in names[:512] if _valid_checkpoint_name(name))
        self._checkpoint_cache_at = time.monotonic()
        return self._checkpoint_cache

    def capabilities(self) -> dict[str, Any]:
        try:
            self._json("/system_stats")
            checkpoints = self._checkpoint_names()
        except (RuntimeError, ValueError, TypeError, AttributeError) as exc:
            return {"available": False, "image_generation": False, "image_editing": False,
                    "details": str(exc)[:240]}
        if not checkpoints:
            return {"available": False, "image_generation": False, "image_editing": False,
                    "details": "ComfyUI is reachable, but no local checkpoint models are listed."}
        return {"available": True, "image_generation": True, "image_editing": True,
                "details": (f"ComfyUI loopback service is reachable; {len(checkpoints)} checkpoint(s) listed. "
                            "Generation and unmasked img2img editing workflows are available; discovery did not run a workflow, "
                            "so output compatibility and quality remain unverified. "
                            "Queued jobs can be removed; active jobs cannot be stopped safely without ComfyUI's "
                            "global interrupt, so cancellation may wait for the current generation to finish.")}

    def list_models(self) -> list[dict[str, Any]]:
        names = self._checkpoint_names()
        models = []
        for name in names:
            digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:10]
            safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", name.rsplit("/", 1)[-1]).strip(".-")[:80]
            models.append({"id": f"{safe_name or 'checkpoint'}-{digest}", "checkpoint": name})
        return models

    def can_load(self, model: Any) -> bool:
        checkpoint = model.get("checkpoint") if isinstance(model, Mapping) else None
        return isinstance(checkpoint, str) and checkpoint in self._checkpoint_names()

    def load(self, model: Any, placement=None, options=None) -> None:
        self._checkpoint_cache_at = 0.0
        if not self.can_load(model):
            raise RuntimeError("The selected checkpoint is no longer listed by ComfyUI")
        # ComfyUI loads the checkpoint when the explicit workflow is queued;
        # this step only binds the selected checkpoint to the scheduler lease.
        self._loaded_model = dict(model)

    def unload(self) -> None:
        self._loaded_model = None

    @staticmethod
    def _queue_ids(queue: Any, key: str) -> set[str] | None:
        if not isinstance(queue, Mapping) or key not in queue or not isinstance(queue[key], list):
            return None
        entries = queue[key]
        return {entry[1] for entry in entries
                if isinstance(entry, (list, tuple)) and len(entry) > 1
                and isinstance(entry[1], str)}

    def cancel_generation(self) -> bool:
        """Remove this request only if it is still queued; never use global /interrupt."""
        prompt_id = self._active_prompt_id
        if prompt_id is None:
            return False
        try:
            queue = self._json("/queue")
            pending = self._queue_ids(queue, "queue_pending")
            running = self._queue_ids(queue, "queue_running")
            if pending is None or running is None:
                return False
            if prompt_id in running or prompt_id not in pending:
                return False
            # ComfyUI may return an empty 200 body for queue deletion. Confirm
            # the result from a fresh queue snapshot instead of assuming the
            # POST response shape or mistaking a job that started meanwhile.
            self._request("/queue", method="POST", payload={"delete": [prompt_id]})
            updated = self._json("/queue")
            updated_pending = self._queue_ids(updated, "queue_pending")
            updated_running = self._queue_ids(updated, "queue_running")
            if updated_pending is None or updated_running is None:
                return False
            if prompt_id in updated_pending:
                return False
            if prompt_id in updated_running:
                return False
            history = self._json(f"/history/{prompt_id}")
            if isinstance(history, Mapping) and prompt_id in history:
                return False
            self._cancelled_prompt_id = prompt_id
            return True
        except (RuntimeError, ValueError, TypeError, AttributeError):
            return False
        return False

    @staticmethod
    def _bounded_options(options: Mapping[str, Any] | None) -> dict[str, Any]:
        options = options or {}
        if not isinstance(options, Mapping):
            raise ValueError("Image generation options must be an object")
        allowed = {"width", "height", "steps", "cfg", "seed", "negative_prompt", "denoise"}
        unknown = set(options) - allowed
        if unknown:
            raise ValueError("Unsupported ComfyUI option(s): " + ", ".join(sorted(map(str, unknown))))
        result = {"width": 512, "height": 512, "steps": 20, "cfg": 7.0,
                  "seed": int.from_bytes(os.urandom(4), "big"), "negative_prompt": "",
                  "denoise": 0.65}
        result.update(options)
        for name in ("width", "height"):
            value = result[name]
            if type(value) is not int or not 256 <= value <= 1024 or value % 8:
                raise ValueError(f"{name} must be a multiple of 8 between 256 and 1024")
        if type(result["steps"]) is not int or not 1 <= result["steps"] <= 40:
            raise ValueError("steps must be an integer between 1 and 40")
        cfg = result["cfg"]
        if isinstance(cfg, bool) or not isinstance(cfg, (int, float)) or not 0 <= cfg <= 30:
            raise ValueError("cfg must be a number between 0 and 30")
        if type(result["seed"]) is not int or not 0 <= result["seed"] <= 2**53 - 1:
            raise ValueError("seed must be an integer between 0 and 2^53-1")
        if not isinstance(result["negative_prompt"], str) or len(result["negative_prompt"]) > 8000:
            raise ValueError("negative_prompt must be bounded text")
        denoise = result["denoise"]
        if isinstance(denoise, bool) or not isinstance(denoise, (int, float)) or not 0.0 < denoise <= 1.0:
            raise ValueError("denoise must be a number greater than 0 and at most 1")
        return result

    @staticmethod
    def _input_image(image: bytes) -> tuple[str, bytes]:
        if not isinstance(image, bytes) or not image or len(image) > _MAX_IMAGE:
            raise ValueError("Input image must be non-empty and at most 32 MiB")
        if image.startswith(_SAMPLE_PNG):
            return "image/png", image
        if image.startswith(_SAMPLE_JPEG):
            return "image/jpeg", image
        raise ValueError("ComfyUI img2img accepts only PNG or JPEG input with a valid signature")

    @staticmethod
    def _upload_name(value: Any) -> str:
        if (not isinstance(value, str) or not value or len(value) > 240
                or value in {".", ".."} or "/" in value or "\\" in value
                or any(ord(char) < 32 for char in value)):
            raise RuntimeError("ComfyUI returned an invalid uploaded image name")
        return value

    @staticmethod
    def _upload_subfolder(value: Any) -> str:
        if not isinstance(value, str) or len(value) > 512 or value.startswith(("/", "\\")) or "\\" in value:
            raise RuntimeError("ComfyUI returned an invalid upload subfolder")
        if value and any(part in {"", ".", ".."} for part in value.split("/")):
            raise RuntimeError("ComfyUI returned an invalid upload subfolder")
        return value

    def _upload_image(self, image: bytes) -> str:
        media_type, content = self._input_image(image)
        boundary = "----AIDream" + os.urandom(18).hex()
        filename = "ai-dream-input.png" if media_type == "image/png" else "ai-dream-input.jpg"
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n".encode(),
            f"Content-Type: {media_type}\r\n\r\n".encode(), content, b"\r\n",
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\nfalse\r\n".encode(),
            f"--{boundary}--\r\n".encode(),
        ]
        body = b"".join(parts)
        response = self._request_bytes("/upload/image", body,
                                       f"multipart/form-data; boundary={boundary}",
                                       max_bytes=64 * 1024)
        try:
            metadata = json.loads(response.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("ComfyUI returned invalid upload metadata") from exc
        if not isinstance(metadata, Mapping):
            raise RuntimeError("ComfyUI returned invalid upload metadata")
        name = self._upload_name(metadata.get("name"))
        subfolder = self._upload_subfolder(metadata.get("subfolder", ""))
        file_type = metadata.get("type", "input")
        if file_type != "input":
            raise RuntimeError("ComfyUI stored the uploaded image outside its input area")
        return f"{subfolder}/{name}" if subfolder else name

    @staticmethod
    def _workflow(prompt: str, settings: Mapping[str, Any], checkpoint: str,
                  input_image: str | None = None) -> dict[str, Any]:
        nodes = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt.strip(), "clip": ["1", 1]}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": settings["negative_prompt"], "clip": ["1", 1]}},
        }
        if input_image is None:
            nodes["2"] = {"class_type": "EmptyLatentImage", "inputs": {
                "width": settings["width"], "height": settings["height"], "batch_size": 1}}
            latent = ["2", 0]
            denoise = 1.0
        else:
            nodes["2"] = {"class_type": "LoadImage", "inputs": {"image": input_image}}
            nodes["8"] = {"class_type": "VAEEncode", "inputs": {
                "pixels": ["2", 0], "vae": ["1", 2]}}
            latent = ["8", 0]
            denoise = settings["denoise"]
        nodes["5"] = {"class_type": "KSampler", "inputs": {
            "seed": settings["seed"], "steps": settings["steps"], "cfg": settings["cfg"],
            "sampler_name": "euler", "scheduler": "normal", "denoise": denoise,
            "model": ["1", 0], "positive": ["3", 0], "negative": ["4", 0],
            "latent_image": latent}}
        nodes["6"] = {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}}
        nodes["7"] = {"class_type": "SaveImage", "inputs": {"filename_prefix": "ai-dream", "images": ["6", 0]}}
        return nodes

    def generate_image(self, prompt: str, *, options=None) -> dict[str, Any]:
        if self._loaded_model is None:
            raise RuntimeError("No ComfyUI checkpoint is selected")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 8000:
            raise ValueError("prompt must contain 1 to 8000 characters")
        settings = self._bounded_options(options)
        workflow = self._workflow(prompt, settings, self._loaded_model["checkpoint"])
        return self._run_workflow(workflow)

    def edit_image(self, image: bytes, instruction: str, *, options=None) -> dict[str, Any]:
        if self._loaded_model is None:
            raise RuntimeError("No ComfyUI checkpoint is selected")
        if not isinstance(instruction, str) or not instruction.strip() or len(instruction) > 8000:
            raise ValueError("instruction must contain 1 to 8000 characters")
        settings = self._bounded_options(options)
        uploaded_path = self._upload_image(image)
        workflow = self._workflow(instruction, settings, self._loaded_model["checkpoint"], uploaded_path)
        return self._run_workflow(workflow)

    def _run_workflow(self, workflow: Mapping[str, Any]) -> dict[str, Any]:
        queued = self._json("/prompt", method="POST", payload={"prompt": workflow})
        prompt_id = queued.get("prompt_id") if isinstance(queued, Mapping) else None
        if not isinstance(prompt_id, str) or not _PROMPT_ID.fullmatch(prompt_id):
            raise RuntimeError("ComfyUI did not return a valid workflow ID")
        self._active_prompt_id = prompt_id
        deadline = time.monotonic() + self._workflow_timeout
        try:
            while time.monotonic() < deadline:
                if self._cancelled_prompt_id == prompt_id:
                    raise RuntimeFailure(RuntimeErrorCode.CANCELLED,
                                         "Queued ComfyUI workflow was cancelled before it started")
                history = self._json(f"/history/{prompt_id}")
                item = history.get(prompt_id) if isinstance(history, Mapping) else None
                outputs = item.get("outputs", {}) if isinstance(item, Mapping) else {}
                images = [image for node in outputs.values() if isinstance(node, Mapping)
                          for image in node.get("images", []) if isinstance(image, Mapping)] if isinstance(outputs, Mapping) else []
                if images:
                    image = images[0]
                    filename, subfolder = image.get("filename"), image.get("subfolder", "")
                    if not isinstance(filename, str) or not filename or len(filename) > 240:
                        raise RuntimeError("ComfyUI returned an invalid output image reference")
                    if not isinstance(subfolder, str) or len(subfolder) > 512 or ".." in subfolder.split("/"):
                        raise RuntimeError("ComfyUI returned an invalid output subfolder")
                    query = urlencode({"filename": filename, "subfolder": subfolder, "type": "output"})
                    content = self._request("/view?" + query, max_bytes=_MAX_IMAGE)
                    if not content.startswith(_SAMPLE_PNG):
                        raise RuntimeError("ComfyUI output was not a PNG image")
                    return {"content_bytes": content, "media_type": "image/png", "name": filename}
                status = item.get("status", {}) if isinstance(item, Mapping) else {}
                if isinstance(status, Mapping) and status.get("status_str") == "error":
                    details = json.dumps(status, ensure_ascii=False).casefold()
                    if any(term in details for term in ("out of memory", "cuda oom", "memory allocation")):
                        raise RuntimeFailure(
                            RuntimeErrorCode.FAILED,
                            "ComfyUI ran out of memory. Reduce image dimensions or free local GPU memory, then retry.",
                            retryable=True,
                        )
                    raise RuntimeError("ComfyUI workflow failed; inspect the local ComfyUI queue for details")
                time.sleep(self._poll_interval)
            raise RuntimeError("ComfyUI workflow timed out; inspect the local ComfyUI queue")
        finally:
            self._active_prompt_id = None
            self._cancelled_prompt_id = None


__all__ = ["ComfyUIBackend"]
