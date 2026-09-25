# Local read-only JSON API

Start the optional API alongside the existing desktop/CLI workflows:

```sh
app serve
# or choose a local port
app serve --port 8765
```

The server always binds to `127.0.0.1`; there is no option to expose it to a
LAN interface. It accepts fixed GET/HEAD requests only. No model loading,
filesystem write, install, chat, or arbitrary file-read endpoint is exposed.
All successful responses use a `{ "data": ... }` envelope. Errors use a short
`{ "error": ... }` body.

- `GET /api/health` → `data.status`, `data.service`
- `GET /api/hardware` → `data.hardware` (the existing hardware snapshot)
- `GET /api/models` → `data.models` (up to 1,000 local `ModelRecord` objects)
- `GET /api/runtime` → `data.backends` (name, availability, and advertised capability fields)

Requests must send a Host header for `127.0.0.1:<port>` or
`localhost:<port>`. Other Host values are rejected. There are no browser write
routes; all mutating HTTP methods return 405 and no request body is consumed.
CORS reads are allowed only from the exact Angular development origin
`http://127.0.0.1:5173` and a same-origin production client, without credentials.
The server caps serialized responses at 4 MiB, limits simultaneous client and
service work, and returns a timeout response when a service call takes more than
six seconds. Responses are not cached. Model paths are returned because the
local desktop/web client needs model identity; the endpoint never opens files
requested by an HTTP caller.
