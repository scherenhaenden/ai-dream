"""Public Hugging Face GGUF discovery and safe downloads (no authentication)."""
from __future__ import annotations

import json
import errno
import hashlib
import os
import re
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Callable


_REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
_API = "https://huggingface.co/api"
Progress = Callable[[int, int | None], None]


class DownloadCancelledError(RuntimeError):
    """Raised when a caller cancels an in-progress model download."""


def _safe_tags(value) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(dict.fromkeys(
        tag.strip()[:200] for tag in value[:256]
        if isinstance(tag, str) and tag.strip()
    ))


def _safe_count(value) -> int:
    # Booleans are integers in Python but are not meaningful Hub counters.
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _hub_model(repo_id: str, data: dict, tags: tuple[str, ...] | None = None) -> HubModel:
    card = data.get("cardData")
    card = card if isinstance(card, dict) else {}
    merged_tags = tuple(dict.fromkeys((*_safe_tags(data.get("tags")), *_safe_tags(card.get("tags")))))
    if tags is not None:
        merged_tags = tuple(dict.fromkeys((*tags, *_safe_tags(card.get("tags")))))
    license_name = card.get("license")
    license_name = license_name.strip()[:200] if isinstance(license_name, str) and license_name.strip() else None
    modified = data.get("lastModified")
    modified = modified[:64] if isinstance(modified, str) else None
    pipeline = data.get("pipeline_tag")
    pipeline = pipeline[:100] if isinstance(pipeline, str) else None

    siblings = data.get("siblings")
    size_bytes: int | None = None
    if isinstance(siblings, list) and len(siblings) <= 10_000:
        sizes = []
        for sibling in siblings:
            if not isinstance(sibling, dict):
                sizes = []
                break
            size = sibling.get("size")
            if size is None and isinstance(sibling.get("lfs"), dict):
                size = sibling["lfs"].get("size")
            if not isinstance(size, int) or isinstance(size, bool) or size < 0:
                sizes = []
                break
            sizes.append(size)
        if siblings and len(sizes) == len(siblings):
            size_bytes = sum(sizes)

    return HubModel(
        repo_id=repo_id,
        downloads=_safe_count(data.get("downloads")),
        likes=_safe_count(data.get("likes")),
        pipeline_tag=pipeline,
        license=license_name,
        tags=merged_tags,
        last_modified=modified,
        size_bytes=size_bytes,
    )


@dataclass(frozen=True)
class HubModel:
    repo_id: str
    downloads: int = 0
    likes: int = 0
    pipeline_tag: str | None = None
    license: str | None = None
    tags: tuple[str, ...] = ()
    last_modified: str | None = None
    size_bytes: int | None = None


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

    def _json(self, url: str, max_bytes: int = 2 * 1024 * 1024):
        req = urllib.request.Request(url, headers={"User-Agent": "AI-Dream/0.1", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                body = response.read(max_bytes + 1)
                if len(body) > max_bytes:
                    raise RuntimeError("Hugging Face metadata response exceeded the size limit.")
                return json.loads(body)
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
            tags = _safe_tags(item.get("tags"))
            if "gguf" in tags or item["id"].lower().endswith("-gguf"):
                models.append(_hub_model(item["id"], item, tags=tags))
        return models

    def repository_details(self, repo_id: str) -> HubModel:
        """Fetch public Hub details and a best-effort total repository size."""
        repo_id = self.validate_repo_id(repo_id)
        encoded_repo = urllib.parse.quote(repo_id, safe="/")
        data = self._json(f"{_API}/models/{encoded_repo}?blobs=true")
        if not isinstance(data, dict) or not isinstance(data.get("id"), str):
            raise RuntimeError("Hugging Face returned unexpected repository details.")
        return _hub_model(data["id"], data)

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
                 progress: Progress | None = None, revision: str = "main",
                 cancel_event: Event | None = None) -> Path:
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
        identity = {"repo_id": repo_id, "file_name": file_name, "revision": revision}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]
        part = dest / f".aidream-{key}.part"
        meta = dest / f".aidream-{key}.json"
        try:
            if cancel_event and cancel_event.is_set():
                raise DownloadCancelledError("Download cancelled.")
            offset, saved = self._load_partial(part, meta, identity)
            headers = {"User-Agent": "AI-Dream/0.1"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
                if saved.get("etag"):
                    headers["If-Range"] = saved["etag"]
            req = urllib.request.Request(url, headers=headers)
            try:
                response = urllib.request.urlopen(req, timeout=self.timeout)
            except urllib.error.HTTPError as exc:
                if offset and exc.code == 416:
                    self._discard_partial(part, meta)
                    offset, saved = 0, {}
                    req = urllib.request.Request(url, headers={"User-Agent": "AI-Dream/0.1"})
                    response = urllib.request.urlopen(req, timeout=self.timeout)
                else:
                    raise
            status = getattr(response, "status", getattr(response, "code", 200))
            etag = response.headers.get("ETag")
            valid_range = status == 206 and self._range_starts_at(response, offset)
            unsafe_entity = not saved.get("etag") or not etag or saved.get("etag") != etag
            if offset and (not valid_range or unsafe_entity):
                response.close()
                self._discard_partial(part, meta)
                offset, saved = 0, {}
                req = urllib.request.Request(url, headers={"User-Agent": "AI-Dream/0.1"})
                response = urllib.request.urlopen(req, timeout=self.timeout)
                status = getattr(response, "status", getattr(response, "code", 200))
                etag = response.headers.get("ETag")
            if status == 206 and offset == 0:
                response.close()
                raise RuntimeError("Hugging Face returned an unexpected partial response.")
            with response:
                total = self._response_total(response, status, offset)
                if total is not None and shutil.disk_usage(dest).free < max(0, total - offset):
                    raise OSError(errno.ENOSPC, f"Not enough free space for download ({total - offset} bytes required).", str(dest))
                received = offset
                mode = "ab" if offset else "wb"
                self._write_partial_meta(meta, {**identity, "etag": etag, "total": total, "received": received})
                with open(part, mode) as out:
                    while True:
                        if cancel_event and cancel_event.is_set():
                            raise DownloadCancelledError("Download cancelled.")
                        chunk = response.read(self.chunk_size)
                        if not chunk:
                            break
                        if cancel_event and cancel_event.is_set():
                            raise DownloadCancelledError("Download cancelled.")
                        out.write(chunk)
                        received += len(chunk)
                        out.flush()
                        os.fsync(out.fileno())
                        self._write_partial_meta(meta, {**identity, "etag": etag, "total": total, "received": received})
                        if progress:
                            progress(received, total)
                    out.flush()
                    os.fsync(out.fileno())
            if total is not None and received != total:
                raise RuntimeError(f"Download ended early ({received} of {total} bytes).")
            if cancel_event and cancel_event.is_set():
                raise DownloadCancelledError("Download cancelled.")
            # Hard-link publication is atomic and fails if another process created the
            # destination after our initial exists check.
            os.link(part, final)
            self._discard_partial(part, meta)
            return final
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Hugging Face download failed with HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not download from Hugging Face: {exc.reason}") from exc
        finally:
            if cancel_event and cancel_event.is_set():
                self._discard_partial(part, meta)

    @staticmethod
    def _load_partial(part: Path, meta: Path, identity: dict) -> tuple[int, dict]:
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("invalid partial metadata")
            size = part.stat().st_size
            if any(data.get(k) != v for k, v in identity.items()) or data.get("received") != size:
                raise ValueError("partial metadata mismatch")
            total = data.get("total")
            if not isinstance(data.get("received"), int) or (total is not None and (not isinstance(total, int) or size > total)):
                raise ValueError("invalid partial metadata")
            return size, data
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            HuggingFaceDownloader._discard_partial(part, meta)
            return 0, {}

    @staticmethod
    def _response_total(response, status: int, offset: int) -> int | None:
        if status == 206:
            match = re.fullmatch(r"bytes \d+-\d+/(\d+|\*)", response.headers.get("Content-Range", ""))
            if match and match.group(1) != "*":
                return int(match.group(1))
        value = response.headers.get("Content-Length")
        if value and value.isdigit():
            return offset + int(value) if status == 206 else int(value)
        return None

    @staticmethod
    def _range_starts_at(response, offset: int) -> bool:
        value = response.headers.get("Content-Range", "")
        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", value)
        return bool(match and int(match.group(1)) == offset and int(match.group(2)) >= offset)

    @staticmethod
    def _write_partial_meta(meta: Path, data: dict) -> None:
        fd, name = tempfile.mkstemp(prefix=meta.name, suffix=".tmp", dir=meta.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, meta)
        finally:
            try:
                os.unlink(name)
            except FileNotFoundError:
                pass

    @staticmethod
    def _discard_partial(part: Path, meta: Path) -> None:
        for path in (part, meta):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
