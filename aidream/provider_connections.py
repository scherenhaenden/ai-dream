"""Fail-closed storage and transport for OpenAI-compatible provider connections.

Connection metadata is stored separately from credentials. Secrets are kept by
the operating-system keyring when the optional ``keyring`` package has a real
secure backend; there is deliberately no file or environment-variable fallback.
"""
from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import tempfile
import threading
from typing import Any, Mapping, Protocol
from urllib.parse import urlsplit, urlunsplit
import uuid
import http.client


MAX_CONNECTIONS = 32
MAX_MODELS = 500
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_SECRET_SERVICE = "ai-dream/provider-connections"
_ID_RE = re.compile(r"^[a-f0-9]{32}$")


class ProviderConnectionError(ValueError):
    """Safe, user-presentable provider configuration error."""
    status = 400


class SecretStoreUnavailable(ProviderConnectionError):
    status = 503


class ProviderConnectionNotFound(ProviderConnectionError):
    status = 404


class SecretStore(Protocol):
    def available(self) -> bool: ...
    def set(self, reference: str, secret: str) -> None: ...
    def get(self, reference: str) -> str | None: ...
    def delete(self, reference: str) -> None: ...


class OSKeyringSecretStore:
    """Adapter for an installed OS keyring; insecure fallback backends are refused."""

    def _keyring(self):
        try:
            import keyring
            backend = keyring.get_keyring()
            backend_module = type(backend).__module__
            backend_name = f"{backend_module}.{type(backend).__name__}".lower()
            priority = getattr(backend, "priority", 0)
            os_backend = backend_module.startswith((
                "keyring.backends.SecretService", "keyring.backends.kwallet",
                "keyring.backends.macOS", "keyring.backends.Windows",
            ))
            if (not os_backend or not isinstance(priority, (int, float)) or priority <= 0
                    or "plaintext" in backend_name or "failkeyring" in backend_name):
                return None
            return keyring
        except Exception:
            return None

    def available(self) -> bool:
        return self._keyring() is not None

    def set(self, reference: str, secret: str) -> None:
        keyring = self._keyring()
        if keyring is None:
            raise SecretStoreUnavailable("OS secure credential storage is unavailable")
        try:
            keyring.set_password(_SECRET_SERVICE, reference, secret)
        except Exception as exc:
            raise SecretStoreUnavailable("OS secure credential storage could not save the credential") from exc

    def get(self, reference: str) -> str | None:
        keyring = self._keyring()
        if keyring is None:
            raise SecretStoreUnavailable("OS secure credential storage is unavailable")
        try:
            return keyring.get_password(_SECRET_SERVICE, reference)
        except Exception as exc:
            raise SecretStoreUnavailable("OS secure credential storage could not read the credential") from exc

    def delete(self, reference: str) -> None:
        keyring = self._keyring()
        if keyring is None:
            raise SecretStoreUnavailable("OS secure credential storage is unavailable")
        try:
            keyring.delete_password(_SECRET_SERVICE, reference)
        except Exception as exc:
            # Missing entries are harmless; keyring backends do not agree on
            # the concrete exception type for that case.
            if type(exc).__name__ not in {"PasswordDeleteError", "ItemNotFoundException"}:
                raise SecretStoreUnavailable("OS secure credential storage could not remove the credential") from exc


def validate_base_url(value: Any) -> str:
    """Validate a provider origin/path without making a network request.

    Public providers must use HTTPS. Plain HTTP is accepted only for literal
    loopback/local development services. Credentials, query strings, fragments,
    non-global IP literals, and ambiguous URL forms are rejected.
    """
    if not isinstance(value, str) or len(value) > 512:
        raise ProviderConnectionError("base_url must be a URL of at most 512 characters")
    raw = value.strip()
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as exc:
        raise ProviderConnectionError("base_url is invalid") from exc
    if (parts.scheme.lower() not in {"http", "https"} or not parts.hostname
            or parts.username is not None or parts.password is not None
            or parts.query or parts.fragment):
        raise ProviderConnectionError("base_url must be an HTTP(S) origin/path without credentials, query, or fragment")
    host = parts.hostname.rstrip(".").lower()
    if not host or any(ord(ch) < 33 or ch in "\\%" for ch in host):
        raise ProviderConnectionError("base_url host is invalid")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    is_loopback_name = host == "localhost" or host.endswith(".localhost")
    if address is not None:
        if not (address.is_global or address.is_loopback):
            raise ProviderConnectionError("base_url cannot target private, link-local, or reserved addresses")
        is_loopback_name = address.is_loopback
    if parts.scheme.lower() != "https" and not is_loopback_name:
        raise ProviderConnectionError("Non-loopback provider connections require HTTPS")
    path = parts.path.rstrip("/")
    if "\\" in path or any(segment in {".", ".."} for segment in path.split("/")):
        raise ProviderConnectionError("base_url path is invalid")
    netloc = host if port is None else f"{host}:{port}"
    if ":" in host and not host.startswith("["):
        netloc = f"[{host}]" if port is None else f"[{host}]:{port}"
    return urlunsplit((parts.scheme.lower(), netloc, path, "", ""))


@dataclass(frozen=True)
class ProviderResponse:
    status: int
    body: Mapping[str, Any] | None


class ProviderTransport(Protocol):
    def list_models(self, base_url: str, api_key: str) -> ProviderResponse: ...


class OpenAICompatibleTransport:
    """Small bounded HTTPS client with no proxy use or redirect following."""

    def __init__(self, *, timeout: float = 8.0):
        self.timeout = timeout

    @staticmethod
    def _addresses(host: str, port: int, *, loopback_allowed: bool) -> list[tuple]:
        try:
            results = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise ProviderConnectionError("Provider host could not be resolved") from exc
        if not results:
            raise ProviderConnectionError("Provider host resolved to no addresses")
        addresses = []
        for result in results:
            ip = ipaddress.ip_address(result[4][0])
            if not ip.is_global and not (loopback_allowed and ip.is_loopback):
                raise ProviderConnectionError("Provider host resolves to a private, link-local, or reserved address")
            addresses.append(result)
        return addresses

    def list_models(self, base_url: str, api_key: str) -> ProviderResponse:
        safe_url = validate_base_url(base_url)
        parts = urlsplit(safe_url)
        host = parts.hostname or ""
        port = parts.port or (443 if parts.scheme == "https" else 80)
        loopback_allowed = host == "localhost" or host.endswith(".localhost")
        try:
            loopback_allowed = loopback_allowed or ipaddress.ip_address(host).is_loopback
        except ValueError:
            pass
        addresses = self._addresses(host, port, loopback_allowed=loopback_allowed)
        # Pin the socket to the vetted address to avoid a second DNS lookup.
        family, socktype, proto, _canonname, sockaddr = addresses[0]
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(self.timeout)
        try:
            sock.connect(sockaddr)
            if parts.scheme == "https":
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
            target = (parts.path.rstrip("/") or "") + "/models"
            connection = http.client.HTTPConnection(host, port, timeout=self.timeout)
            connection.sock = sock
            connection.request("GET", target, headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "User-Agent": "AI-Dream/0.1",
                "Connection": "close",
            })
            response = connection.getresponse()
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ProviderConnectionError("Provider response exceeded the size limit")
            if 300 <= response.status < 400:
                raise ProviderConnectionError("Provider redirects are not followed")
            try:
                decoded = json.loads(body.decode("utf-8")) if body else None
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ProviderConnectionError("Provider returned an invalid model-list response") from exc
            return ProviderResponse(response.status, decoded if isinstance(decoded, Mapping) else None)
        except ProviderConnectionError:
            raise
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            raise ProviderConnectionError("Provider connection failed") from exc
        finally:
            try:
                sock.close()
            except OSError:
                pass


class ProviderConnectionStore:
    """Atomic private-file metadata store; it never contains credential values."""

    def __init__(self, path: str | os.PathLike[str] | None = None):
        if path is None:
            config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
            if not config_home.is_absolute():
                config_home = Path.home() / ".config"
            path = config_home / "ai-dream" / "provider-connections.json"
        self.path = Path(path).expanduser()
        self._lock = threading.RLock()

    def _read(self) -> dict[str, dict[str, Any]]:
        if self.path.is_symlink():
            raise ProviderConnectionError("Provider metadata file must not be a symbolic link")
        try:
            data = json.loads(self.path.read_text("utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ProviderConnectionError("Provider metadata could not be read") from exc
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("connections"), dict):
            raise ProviderConnectionError("Provider metadata has an unsupported format")
        items = data["connections"]
        if len(items) > MAX_CONNECTIONS:
            raise ProviderConnectionError("Provider metadata exceeds the connection limit")
        return items

    def _write(self, items: Mapping[str, Mapping[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.is_symlink():
            raise ProviderConnectionError("Provider metadata file must not be a symbolic link")
        fd, temp_name = tempfile.mkstemp(prefix=".provider-connections-", dir=self.path.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"version": 1, "connections": items}, stream, ensure_ascii=False,
                          separators=(",", ":"), allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, self.path)
            os.chmod(self.path, 0o600)
        finally:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(value) for _, value in sorted(self._read().items())]

    def get(self, connection_id: str) -> dict[str, Any]:
        with self._lock:
            item = self._read().get(connection_id)
            if item is None:
                raise ProviderConnectionNotFound("Provider connection not found")
            return dict(item)

    def put(self, connection: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            items = self._read()
            items[connection["id"]] = dict(connection)
            self._write(items)
            return dict(connection)

    def remove(self, connection_id: str) -> dict[str, Any]:
        with self._lock:
            items = self._read()
            if connection_id not in items:
                raise ProviderConnectionNotFound("Provider connection not found")
            del items[connection_id]
            self._write(items)
            return {"deleted": True}


class ProviderConnections:
    """CRUD, safe public projections, and fakeable OpenAI-compatible discovery."""

    def __init__(self, store: ProviderConnectionStore | None = None,
                 secret_store: SecretStore | None = None,
                 transport: ProviderTransport | None = None):
        self.store = store or ProviderConnectionStore()
        self.secret_store = secret_store or OSKeyringSecretStore()
        self.transport = transport or OpenAICompatibleTransport()

    def storage_status(self) -> dict[str, Any]:
        try:
            available = bool(self.secret_store.available())
        except Exception:
            available = False
        return {"available": available,
                "reason": None if available else "OS secure credential storage is unavailable"}

    @staticmethod
    def _public(item: Mapping[str, Any]) -> dict[str, Any]:
        return {"id": item["id"], "name": item["name"], "provider_type": item["provider_type"],
                "base_url": item["base_url"], "enabled": item["enabled"],
                "secret_ref": item.get("secret_ref"),
                "credential_configured": bool(item.get("secret_ref"))}

    @staticmethod
    def _validate_id(connection_id: str) -> str:
        if not isinstance(connection_id, str) or not _ID_RE.fullmatch(connection_id):
            raise ProviderConnectionNotFound("Provider connection not found")
        return connection_id

    @staticmethod
    def _name(value: Any) -> str:
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or "\x00" in value:
            raise ProviderConnectionError("name must contain 1 to 80 characters")
        return value.strip()

    def list(self) -> dict[str, Any]:
        return {"connections": [self._public(item) for item in self.store.list()],
                "secure_storage": self.storage_status()}

    def get(self, connection_id: str) -> dict[str, Any]:
        return self._public(self.store.get(self._validate_id(connection_id)))

    def create(self, body: Mapping[str, Any]) -> dict[str, Any]:
        allowed = {"name", "base_url", "api_key", "enabled"}
        if set(body) - allowed or not {"name", "base_url"} <= set(body):
            raise ProviderConnectionError("name and base_url are required; only api_key and enabled are optional")
        if "enabled" in body and not isinstance(body["enabled"], bool):
            raise ProviderConnectionError("enabled must be a boolean")
        existing = self.store.list()
        if len(existing) >= MAX_CONNECTIONS:
            raise ProviderConnectionError("Provider connection limit reached")
        key = body.get("api_key")
        if key is not None and (not isinstance(key, str) or not key or len(key) > 4096 or "\x00" in key):
            raise ProviderConnectionError("api_key must contain 1 to 4096 characters")
        if body.get("enabled", False) and not key:
            raise ProviderConnectionError("A secure credential is required before enabling this connection")
        connection_id = uuid.uuid4().hex
        secret_ref = uuid.uuid4().hex if key else None
        item = {"id": connection_id, "name": self._name(body["name"]),
                "provider_type": "openai-compatible", "base_url": validate_base_url(body["base_url"]),
                "enabled": bool(body.get("enabled", False)), "secret_ref": secret_ref}
        if key:
            self.secret_store.set(secret_ref, key)
        try:
            self.store.put(item)
        except Exception:
            if secret_ref:
                try:
                    self.secret_store.delete(secret_ref)
                except Exception:
                    pass
            raise
        return self._public(item)

    def update(self, connection_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        connection_id = self._validate_id(connection_id)
        allowed = {"name", "base_url", "api_key", "clear_api_key", "enabled"}
        if not isinstance(body, Mapping) or set(body) - allowed or not body:
            raise ProviderConnectionError("Only name, base_url, api_key, clear_api_key, and enabled may be updated")
        item = self.store.get(connection_id)
        updated = dict(item)
        if "name" in body:
            updated["name"] = self._name(body["name"])
        if "base_url" in body:
            updated["base_url"] = validate_base_url(body["base_url"])
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                raise ProviderConnectionError("enabled must be a boolean")
            updated["enabled"] = body["enabled"]
        if "api_key" in body and "clear_api_key" in body:
            raise ProviderConnectionError("Provide api_key or clear_api_key, not both")
        new_ref = None
        if "api_key" in body:
            key = body["api_key"]
            if not isinstance(key, str) or not key or len(key) > 4096 or "\x00" in key:
                raise ProviderConnectionError("api_key must contain 1 to 4096 characters")
            new_ref = uuid.uuid4().hex
            self.secret_store.set(new_ref, key)
            updated["secret_ref"] = new_ref
        elif "clear_api_key" in body:
            if body["clear_api_key"] is not True:
                raise ProviderConnectionError("clear_api_key must be true")
            updated["secret_ref"] = None
            updated["enabled"] = False
        if updated["enabled"]:
            if not updated.get("secret_ref"):
                raise ProviderConnectionError("A secure credential is required before enabling this connection")
            credential = self.secret_store.get(updated["secret_ref"])
            if not credential:
                raise ProviderConnectionError("The secure credential is unavailable; save it again before enabling")
        try:
            self.store.put(updated)
        except Exception:
            if new_ref:
                try:
                    self.secret_store.delete(new_ref)
                except Exception:
                    pass
            raise
        old_ref = item.get("secret_ref")
        if old_ref and old_ref != updated.get("secret_ref"):
            self.secret_store.delete(old_ref)
        return self._public(updated)

    def delete(self, connection_id: str) -> dict[str, Any]:
        connection_id = self._validate_id(connection_id)
        item = self.store.get(connection_id)
        result = self.store.remove(connection_id)
        if item.get("secret_ref"):
            self.secret_store.delete(item["secret_ref"])
        return result

    def _models(self, connection_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        item = self.store.get(self._validate_id(connection_id))
        if not item["enabled"]:
            raise ProviderConnectionError("Provider connection is disabled")
        reference = item.get("secret_ref")
        if not reference:
            raise SecretStoreUnavailable("No secure credential is configured for this connection")
        api_key = self.secret_store.get(reference)
        if not api_key:
            raise SecretStoreUnavailable("The secure credential is unavailable; save it again")
        try:
            response = self.transport.list_models(item["base_url"], api_key)
        except ProviderConnectionError:
            raise
        except Exception as exc:
            # Do not surface transport exception text: it may contain headers,
            # endpoint query strings, proxy settings, or the API credential.
            raise ProviderConnectionError("Provider request failed") from exc
        if response.status < 200 or response.status >= 300:
            raise ProviderConnectionError(f"Provider returned HTTP {response.status}")
        data = response.body.get("data") if isinstance(response.body, Mapping) else None
        if not isinstance(data, list) or len(data) > MAX_MODELS:
            raise ProviderConnectionError("Provider returned an invalid model-list response")
        result = []
        for model in data:
            if not isinstance(model, Mapping) or not isinstance(model.get("id"), str):
                continue
            model_id = model["id"].strip()
            if not model_id or len(model_id) > 256 or "\x00" in model_id:
                continue
            result.append({"id": f"provider:{connection_id}:{model_id}", "provider_model_id": model_id,
                           "connection_id": connection_id, "connection_name": item["name"],
                           "provider_type": item["provider_type"], "name": str(model.get("name") or model_id)[:256],
                           "source": "remote-provider"})
        return item, result

    def test(self, connection_id: str) -> dict[str, Any]:
        item, models = self._models(connection_id)
        return {"connection_id": item["id"], "connected": True, "model_count": len(models)}

    def models(self, connection_id: str | None = None) -> dict[str, Any]:
        if connection_id is not None:
            _item, models = self._models(connection_id)
            return {"models": models}
        all_models = []
        for item in self.store.list():
            if item.get("enabled"):
                _connection, models = self._models(item["id"])
                all_models.extend(models)
        return {"models": all_models}
