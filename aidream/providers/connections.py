"""Provider connections interface re-exported from the core fail-closed store.

Provides credential resolution through OS keyring, pinned-socket SSRF protection,
and atomic configuration storage.
"""
from __future__ import annotations

from aidream.provider_connections import (
    MAX_CONNECTIONS,
    MAX_MODELS,
    MAX_RESPONSE_BYTES,
    OSKeyringSecretStore,
    OpenAICompatibleTransport,
    ProviderConnectionError,
    ProviderConnectionNotFound,
    ProviderConnectionStore,
    ProviderConnections,
    ProviderResponse,
    ProviderTransport,
    SecretStore,
    SecretStoreUnavailable,
    validate_base_url,
)

__all__ = [
    "MAX_CONNECTIONS",
    "MAX_MODELS",
    "MAX_RESPONSE_BYTES",
    "OSKeyringSecretStore",
    "OpenAICompatibleTransport",
    "ProviderConnectionError",
    "ProviderConnectionNotFound",
    "ProviderConnectionStore",
    "ProviderConnections",
    "ProviderResponse",
    "ProviderTransport",
    "SecretStore",
    "SecretStoreUnavailable",
    "validate_base_url",
]
