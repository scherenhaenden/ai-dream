"""Public Hugging Face GGUF discovery and safe downloads (no authentication)."""
from __future__ import annotations

import json
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


_REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_API = "https://huggingface.co/api"
Progress = Callable[[int, int | None], None]


@dataclass(frozen=True)
class HubModel:
    repo_id: str
    downloads: int = 0
    likes: int = 0
    pipeline_tag: str | None = None


class HuggingFaceDownloader:
    """Search public model repos and download GGUFs without overwriting files."""

    def __init__(self, timeout: float = 20.0, chunk_size: int = 1024 * 1024):
        self.timeout = timeout
        self.chunk_size = chunk_size

    @staticmethod
    def validate_repo_id(repo_id: str) -> str:
        repo_id = repo_id.strip()
        if not _REPO_RE.fullmatch(repo_id) or ".." in repo_id or "--" in repo_id:
            raise ValueError("Repository must be a public Hugging Face ID like owner/model.")
        return repo_id

    @staticmethod
    def validate_file(file_name: str) -> str:
        # Hub siblings can contain subdirectories; reject absolute/traversal paths.
        p = Path(file_name)
        if (not file_name or p.is_absolute() or ".." in p.parts or "\\" in file_name
                or any(part in ("", ".") for part in file_name.split("/"))
                or not file_name.lower().endswith(".gguf")):
            raise ValueError("Choose a valid .gguf file from the repository.")
        return file_name

    def _json(self, url: str):
        req = urllib.request.Request(url, headers={"User-Agent": "AI-Dream/0.1", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Hugging Face returned HTTP {exc.code} for a public request.") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not reach Hugging Face: {exc.reason}") from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise RuntimeError("Hugging Face returned an invalid response.") from exc

    def search(self, query: str, limit: int = 30) -> list[HubModel]:
        query = query.strip()
        if len(query) > 200:
            raise ValueError("Search text is too long.")
        if not 1 <= limit <= 100:
            raise ValueError("Search limit must be between 1 and 100.")
        params = urllib.parse.urlencode({"search": query, "filter": "gguf", "limit": limit, "sort": "downloads", "direction": "-1"})
        data = self._json(f"{_API}/models?{params}")
        if not isinstance(data, list):
            raise RuntimeError("Hugging Face model search returned an unexpected response.")
        models = []
        for item in data:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                continue
            tags = item.get("tags") or []
            if "gguf" in tags or item["id"].lower().endswith("-gguf"):
                models.append(HubModel(item["id"], int(item.get("downloads") or 0), int(item.get("likes") or 0), item.get("pipeline_tag")))
        return models

    def list_gguf_files(self, repo_id: str, revision: str = "main") -> list[str]:
        repo_id = self.validate_repo_id(repo_id)
        if not re.fullmatch(r"[A-Za-z0-9._/-]{1,128}", revision) or ".." in revision.split("/"):
            raise ValueError("Invalid repository revision.")
        encoded_repo = urllib.parse.quote(repo_id, safe="/")
        data = self._json(f"{_API}/models/{encoded_repo}/tree/{urllib.parse.quote(revision, safe='')}?recursive=true")
        if not isinstance(data, list):
            raise RuntimeError("Hugging Face returned an unexpected file list.")
        names = []
        for item in data:
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                name = item["path"]
                try:
                    self.validate_file(name)
                except ValueError:
                    continue
                names.append(name)
        return sorted(set(names), key=str.casefold)

    def download(self, repo_id: str, file_name: str, destination: str | os.PathLike[str],
                 progress: Progress | None = None, revision: str = "main") -> Path:
        repo_id = self.validate_repo_id(repo_id)
        file_name = self.validate_file(file_name)
        if not re.fullmatch(r"[A-Za-z0-9._/-]{1,128}", revision) or ".." in revision.split("/"):
            raise ValueError("Invalid repository revision.")
        dest = Path(destination).expanduser().resolve()
        if not dest.is_dir():
            raise ValueError("Download destination must be an existing directory.")
        # Flatten Hub subdirectories to a filename to prevent path traversal and keep
        # the user's model directory easy to scan.
        final = dest / Path(file_name).name
        if final.exists():
            raise FileExistsError(f"Refusing to overwrite existing file: {final}")
        parts = [urllib.parse.quote(p, safe="") for p in file_name.split("/")]
        url = f"https://huggingface.co/{urllib.parse.quote(repo_id, safe='/')}/resolve/{urllib.parse.quote(revision, safe='')}/{'/'.join(parts)}?download=true"
        req = urllib.request.Request(url, headers={"User-Agent": "AI-Dream/0.1"})
        tmp_name = None
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                total_header = response.headers.get("Content-Length")
                total = int(total_header) if total_header and total_header.isdigit() else None
                fd, tmp_name = tempfile.mkstemp(prefix=".aidream-download-", suffix=".part", dir=dest)
                received = 0
                with os.fdopen(fd, "wb") as out:
                    while True:
                        chunk = response.read(self.chunk_size)
                        if not chunk:
                            break
                        out.write(chunk)
                        received += len(chunk)
                        if progress:
                            progress(received, total)
                    out.flush()
                    os.fsync(out.fileno())
            if total is not None and received != total:
                raise RuntimeError(f"Download ended early ({received} of {total} bytes).")
            # Hard-link publication is atomic and fails if another process created the
            # destination after our initial exists check.
            os.link(tmp_name, final)
            return final
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Hugging Face download failed with HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not download from Hugging Face: {exc.reason}") from exc
        finally:
            if tmp_name:
                try:
                    os.unlink(tmp_name)
                except FileNotFoundError:
                    pass
