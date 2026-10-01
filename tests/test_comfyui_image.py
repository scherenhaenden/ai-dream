from __future__ import annotations

import json
import unittest
from urllib.error import HTTPError
from urllib.parse import urlsplit, urlunsplit

from aidream.comfyui_image import ComfyUIBackend
from aidream.image_runtime import LocalImageRuntimeAdapter


PNG = b"\x89PNG\r\n\x1a\n" + b"fake-png-content"
CHECKPOINT = "models/sdxl.safetensors"
MODEL_ID = "sdxl.safetensors-" + __import__("hashlib").sha256(CHECKPOINT.encode()).hexdigest()[:10]


class FakeResponse:
    def __init__(self, body: bytes, url: str):
        self.body = body
        self.url = url

    def read(self, limit=-1):
        return self.body[:limit]

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeComfyOpener:
    def __init__(self):
        self.requests = []
        self.running = False
        self.deleted = []
        self.starts_after_delete = False
        self.upload_body = None
        self.fail_upload = False

    def open(self, request, timeout=0):
        self.requests.append((request, timeout))
        url = request.full_url
        if url.endswith("/system_stats"):
            body = {"system": {}}
        elif "/object_info/CheckpointLoaderSimple" in url:
            body = {"CheckpointLoaderSimple": {"input": {"required": {
                "ckpt_name": [[CHECKPOINT, "../private.safetensors"], {}],
            }}}}
        elif url.endswith("/prompt"):
            body = {"prompt_id": "prompt-123"}
        elif url.endswith("/upload/image"):
            self.upload_body = request.data
            if self.fail_upload:
                body = {"name": "../escape.png", "subfolder": "", "type": "input"}
            else:
                return FakeResponse(b'{"name":"ai-dream-input.png","subfolder":"","type":"input"}',
                                    "http://127.0.0.1:8188/upload/image")
        elif url.endswith("/queue") and request.method == "GET":
            active = [[0, "prompt-123", {}]] if self.running else []
            pending = [] if self.running or "prompt-123" in self.deleted else [[0, "prompt-123", {}]]
            body = {"queue_running": active, "queue_pending": pending}
        elif url.endswith("/queue") and request.method == "POST":
            if self.starts_after_delete:
                self.running = True
            else:
                self.deleted.extend(json.loads(request.data).get("delete", []))
            return FakeResponse(b"", "http://127.0.0.1:8188/queue")
        elif url.endswith("/history/prompt-123"):
            body = {} if "prompt-123" in self.deleted else {
                "prompt-123": {"outputs": {"7": {"images": [
                    {"filename": "ai-dream_00001.png", "subfolder": "", "type": "output"},
                ]}}}}
        elif "/view?" in url:
            parsed = urlsplit(url)
            return FakeResponse(PNG, urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")))
        else:
            raise AssertionError(f"Unexpected ComfyUI request: {request.method} {url}")
        return FakeResponse(json.dumps(body).encode(), url)


class RedirectingOpener:
    def __init__(self):
        self.called = False

    def open(self, request, timeout=0):
        self.called = True
        from io import BytesIO
        raise HTTPError(request.full_url, 302, "redirect", {"Location": "http://example.com/"}, BytesIO())


class ComfyUIImageTests(unittest.TestCase):
    def test_requires_explicit_loopback_configuration_and_rejects_nonlocal_hosts(self):
        self.assertIsNone(ComfyUIBackend.from_environment(environ={}))
        opener = FakeComfyOpener()
        backend = ComfyUIBackend("http://127.0.0.1:8188", opener=opener)
        self.assertEqual(backend.base_url, "http://127.0.0.1:8188")
        self.assertIsNone(ComfyUIBackend("https://localhost:8443/", opener=opener).configuration_error)
        invalid = ComfyUIBackend("http://example.com:8188", opener=opener)
        self.assertFalse(invalid.capabilities()["available"])
        self.assertIn("loopback", invalid.capabilities()["details"])
        self.assertEqual(opener.requests, [])

    def test_read_only_discovery_lists_checkpoint_without_loading_or_submitting_workflow(self):
        opener = FakeComfyOpener()
        backend = ComfyUIBackend("http://localhost:8188", opener=opener)
        status = backend.capabilities()
        models = backend.list_models()
        descriptor = LocalImageRuntimeAdapter(backend).probe()

        self.assertTrue(status["available"])
        self.assertTrue(status["image_generation"])
        self.assertTrue(status["image_editing"])
        self.assertIn("unverified", status["details"])
        self.assertEqual(descriptor.features, frozenset({"image.generate", "image.edit"}))
        self.assertIn("global interrupt", descriptor.details)
        self.assertEqual([item["id"] for item in models], [MODEL_ID])
        self.assertIsNone(backend._loaded_model)
        self.assertTrue(all("127.0.0.1" in request.full_url for request, _ in opener.requests))
        self.assertFalse(any(request.method == "POST" for request, _ in opener.requests))

    def test_explicit_generation_submits_bounded_local_workflow_and_returns_png(self):
        opener = FakeComfyOpener()
        backend = ComfyUIBackend("http://127.0.0.1:8188", opener=opener, poll_interval=0.05)
        model = backend.list_models()[0]
        backend.load(model)
        result = backend.generate_image("A quiet mountain lake", options={"steps": 5, "seed": 42})

        self.assertEqual(result["content_bytes"], PNG)
        self.assertEqual(result["media_type"], "image/png")
        prompt_request = next(request for request, _ in opener.requests if request.full_url.endswith("/prompt"))
        workflow = json.loads(prompt_request.data)["prompt"]
        self.assertEqual(workflow["1"]["inputs"]["ckpt_name"], CHECKPOINT)
        self.assertEqual(workflow["2"]["inputs"], {"width": 512, "height": 512, "batch_size": 1})
        self.assertEqual(workflow["5"]["inputs"]["steps"], 5)
        self.assertEqual(workflow["5"]["inputs"]["seed"], 42)

    def test_explicit_edit_uploads_bounded_signed_input_and_submits_img2img_workflow(self):
        opener = FakeComfyOpener()
        backend = ComfyUIBackend("http://127.0.0.1:8188", opener=opener, poll_interval=0.05)
        backend.load(backend.list_models()[0])
        result = backend.edit_image(PNG, "Make the sky warmer", options={"steps": 6, "denoise": 0.4})

        self.assertEqual(result["content_bytes"], PNG)
        self.assertEqual(result["media_type"], "image/png")
        self.assertIn(b'name="image"; filename="ai-dream-input.png"', opener.upload_body)
        self.assertIn(PNG, opener.upload_body)
        upload_request, _ = next((request, timeout) for request, timeout in opener.requests
                                 if request.full_url.endswith("/upload/image"))
        self.assertTrue(upload_request.get_header("Content-type").startswith("multipart/form-data; boundary="))
        prompt_request = next(request for request, _ in opener.requests if request.full_url.endswith("/prompt"))
        workflow = json.loads(prompt_request.data)["prompt"]
        self.assertEqual(workflow["2"], {"class_type": "LoadImage", "inputs": {"image": "ai-dream-input.png"}})
        self.assertEqual(workflow["8"]["class_type"], "VAEEncode")
        self.assertEqual(workflow["5"]["inputs"]["latent_image"], ["8", 0])
        self.assertEqual(workflow["5"]["inputs"]["denoise"], 0.4)
        self.assertEqual(workflow["3"]["inputs"]["text"], "Make the sky warmer")

    def test_edit_rejects_bad_signature_or_unsafe_upload_metadata_before_queue(self):
        opener = FakeComfyOpener()
        backend = ComfyUIBackend("http://127.0.0.1:8188", opener=opener)
        backend.load(backend.list_models()[0])
        with self.assertRaisesRegex(ValueError, "PNG or JPEG"):
            backend.edit_image(b"not-an-image", "edit")
        self.assertFalse(any(request.full_url.endswith("/upload/image") for request, _ in opener.requests))

        opener = FakeComfyOpener()
        opener.fail_upload = True
        backend = ComfyUIBackend("http://127.0.0.1:8188", opener=opener)
        backend.load(backend.list_models()[0])
        with self.assertRaisesRegex(RuntimeError, "uploaded image name"):
            backend.edit_image(PNG, "edit")
        self.assertFalse(any(request.full_url.endswith("/prompt") for request, _ in opener.requests))

    def test_redirect_and_unsafe_generation_options_fail_closed(self):
        redirect = ComfyUIBackend("http://127.0.0.1:8188", opener=RedirectingOpener())
        status = redirect.capabilities()
        self.assertFalse(status["available"])
        self.assertIn("redirects are blocked", status["details"])

        backend = ComfyUIBackend("http://127.0.0.1:8188", opener=FakeComfyOpener())
        backend.load(backend.list_models()[0])
        with self.assertRaisesRegex(ValueError, "Unsupported ComfyUI option"):
            backend.generate_image("test", options={"url": "http://example.com"})
        with self.assertRaisesRegex(ValueError, "between 256 and 1024"):
            backend.generate_image("test", options={"width": 4096})

    def test_cancel_removes_only_this_queued_prompt_and_never_interrupts_active_jobs(self):
        opener = FakeComfyOpener()
        backend = ComfyUIBackend("http://127.0.0.1:8188", opener=opener)
        backend._active_prompt_id = "prompt-123"
        self.assertTrue(backend.cancel_generation())
        self.assertEqual([request.method for request, _ in opener.requests], ["GET", "POST", "GET", "GET"])
        self.assertTrue(all(not request.full_url.endswith("/interrupt") for request, _ in opener.requests))

        active_opener = FakeComfyOpener()
        active_opener.running = True
        active = ComfyUIBackend("http://127.0.0.1:8188", opener=active_opener)
        active._active_prompt_id = "prompt-123"
        self.assertFalse(active.cancel_generation())
        self.assertEqual([request.method for request, _ in active_opener.requests], ["GET"])

        raced_opener = FakeComfyOpener()
        raced_opener.starts_after_delete = True
        raced = ComfyUIBackend("http://127.0.0.1:8188", opener=raced_opener)
        raced._active_prompt_id = "prompt-123"
        self.assertFalse(raced.cancel_generation())
        self.assertEqual([request.method for request, _ in raced_opener.requests], ["GET", "POST", "GET"])


if __name__ == "__main__":
    unittest.main()
