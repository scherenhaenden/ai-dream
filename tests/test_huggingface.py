import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aidream.huggingface import DownloadCancelledError, HuggingFaceDownloader


class _Response:
    headers = {"Content-Length": "7"}

    def __init__(self):
        self.parts = [b"GGUF123", b""]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def read(self, _size):
        return self.parts.pop(0)


class _ChunkedResponse(_Response):
    headers = {"Content-Length": "6"}

    def __init__(self):
        self.parts = [b"abc", b"def", b""]


class HuggingFaceDownloaderTests(unittest.TestCase):
    def test_validates_public_repo_and_gguf_paths(self):
        self.assertEqual(HuggingFaceDownloader.validate_repo_id("org/model-gguf"), "org/model-gguf")
        for repo in ("https://huggingface.co/org/model", "../model", "org/model/extra", "org/../model"):
            with self.subTest(repo=repo), self.assertRaises(ValueError):
                HuggingFaceDownloader.validate_repo_id(repo)
        for filename in ("../model.gguf", "/tmp/model.gguf", "model.bin", "nested\\model.gguf"):
            with self.subTest(filename=filename), self.assertRaises(ValueError):
                HuggingFaceDownloader.validate_file(filename)

    def test_download_publishes_without_overwriting(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            progress = []
            with patch("aidream.huggingface.urllib.request.urlopen", return_value=_Response()):
                target = HuggingFaceDownloader(chunk_size=3).download(
                    "org/model", "quant/model.Q4_K_M.gguf", folder,
                    lambda received, total: progress.append((received, total)),
                )
            self.assertEqual(target.name, "model.Q4_K_M.gguf")
            self.assertEqual(target.read_bytes(), b"GGUF123")
            self.assertEqual(progress[-1], (7, 7))
            with patch("aidream.huggingface.urllib.request.urlopen", return_value=_Response()):
                with self.assertRaises(FileExistsError):
                    HuggingFaceDownloader().download("org/model", "model.Q4_K_M.gguf", folder)
            self.assertEqual(target.read_bytes(), b"GGUF123")
            self.assertEqual(list(folder.iterdir()), [target])

    def test_download_rejects_nonexistent_destination(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ValueError):
                HuggingFaceDownloader().download("org/model", "model.gguf", Path(td) / "missing")

    def test_cancel_cleans_partial_file_and_never_publishes_model(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            cancel = threading.Event()

            def on_progress(_received, _total):
                cancel.set()

            with patch("aidream.huggingface.urllib.request.urlopen", return_value=_ChunkedResponse()):
                with self.assertRaises(DownloadCancelledError):
                    HuggingFaceDownloader(chunk_size=3).download(
                        "org/model", "model.gguf", folder, on_progress, cancel_event=cancel,
                    )
            self.assertEqual(list(folder.iterdir()), [])

    def test_known_content_length_checks_available_disk_space(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            with patch("aidream.huggingface.urllib.request.urlopen", return_value=_Response()), \
                 patch("aidream.huggingface.shutil.disk_usage", return_value=SimpleNamespace(free=6)):
                with self.assertRaises(OSError) as caught:
                    HuggingFaceDownloader().download("org/model", "model.gguf", folder)
            self.assertEqual(caught.exception.errno, 28)
            self.assertEqual(list(folder.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
