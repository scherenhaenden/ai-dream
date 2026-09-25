# Local image input (first slice)

`aidream.image_input` prepares local raster attachments for an OpenAI-compatible
chat-completions request. It deliberately does not call a remote service or
decode/re-encode the image. The llama.cpp server and the selected model must
both support vision for image understanding to work.

```python
from aidream.image_input import build_multimodal_message, load_image_attachment

image = load_image_attachment("/path/to/photo.png")
message = build_multimodal_message("Describe this photo", [image])
# Add `message` to the request's messages array.
```

The resulting message uses the usual OpenAI-compatible `content` array: a text
part followed by `image_url` parts whose URLs are local `data:` URIs. Supported
MIME types are detected from file signatures (PNG, JPEG, WebP), not extensions.
SVG, GIF, remote URLs, and unsupported formats are rejected.

Limits are intentionally bounded: 8 MiB per image, 12 MiB combined image bytes,
and four images per message. Only `user` and `system` roles are accepted by the
builder. The data URI adds base64 overhead to the JSON request, so callers should
also keep the server's overall request/body limit in mind. This API is not yet
wired into the desktop UI, persisted conversation format, streaming chat, or
image resizing/thumbnail generation.
