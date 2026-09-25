# Local model details

The local GGUF catalog exposes a `ModelRecord` for every discovered file. Call
`ModelRecord.display_info()` to get a small presentation-ready mapping with the
name, format, exact byte size and IEC-formatted size, quantization, architecture,
context length (when present), license, source, and local path.

GGUF header values are authoritative when present. Quantization is read from
`general.file_type`; if converters omit it, a recognizable filename suffix is
reported with `(filename)` so it is not mistaken for verified metadata. Missing
license and source values are reported explicitly instead of inferred. The raw
header metadata remains available on `ModelRecord.metadata`, and `to_dict()`
continues to serialize the original record shape.

This API is ready for the model details panel to consume. Displaying these fields
in the desktop UI is a separate integration step.
