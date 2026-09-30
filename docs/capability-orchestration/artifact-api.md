# Artifact API transport contract

`aidream.artifacts.api.ArtifactAPI` is the transport-neutral adapter for the
temporary `ArtifactStore`. It returns typed metadata or raw bytes separately;
an HTTP handler can map `ArtifactAPIError.status` and `.to_dict()` to the local
API error response. The adapter itself does not expose filesystem paths.

## Routes

```text
POST   /api/artifacts
GET    /api/artifacts?owner_type=session&owner_id=<opaque-id>
GET    /api/artifacts/<artifact-id>/metadata?owner_type=session&owner_id=<opaque-id>
GET    /api/artifacts/<artifact-id>/content?owner_type=session&owner_id=<opaque-id>
DELETE /api/artifacts/<artifact-id>?owner_type=session&owner_id=<opaque-id>
```

Upload sends the binary file as the raw HTTP request body. Control fields are
headers, so binary content is not base64-encoded or duplicated in JSON:

```text
Content-Type: image/png
X-AI-Dream-Artifact-Kind: image
X-AI-Dream-Artifact-Name: screenshot.png
X-AI-Dream-Artifact-Owner-Type: session
X-AI-Dream-Artifact-Owner-ID: <opaque-id>
X-AI-Dream-Artifact-Lifetime: session
```

The initial transport contract omits custom metadata on upload; the adapter
accepts optional bounded JSON metadata for internal producers. A future HTTP
extension can add metadata after agreeing on a bounded encoding.

Before reading the body, the handler must require a valid non-negative
`Content-Length` no larger than the store's `max_artifact_bytes`, then read
exactly that many bytes in bounded chunks. Reject transfer-encoded/chunked
requests until the handler has an explicit streaming limit. The API adapter
also checks body length, per-store total bytes, artifact count and metadata
schema as defense in depth.

The upload response is `{ "data": { "artifact": <ArtifactEnvelope> } }`;
list returns `{ "data": { "artifacts": [...] } }`; metadata returns the same
single-artifact envelope. Content returns raw bytes with the envelope's
validated `media_type`, exact `Content-Length`, and `X-Content-Type-Options:
nosniff`. Delete returns `{ "data": { "deleted": true } }`. Missing artifacts
and owner mismatches return the same not-found error to avoid confirming
another owner's artifact ID.

Owner type is restricted to `run`, `session`, or `user`; lifetime is restricted
to `ephemeral` or `session`. Persistent storage requires a separate durable
store. Owner scoping filters records but is not an authentication boundary;
the HTTP layer must retain loopback Host/Origin protections. Envelopes carry
opaque storage keys only. Never accept a filesystem path as a storage key or
return the temporary root to a client.

The HTTP routes are not wired by this change. Wiring still needs review of the
request body reader, response streaming, route dispatch, Origin/Host checks and
pre-allocation size rejection in `aidream/http_api.py`.
