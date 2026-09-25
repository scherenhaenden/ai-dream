# Hugging Face repository metadata

`HuggingFaceDownloader.repository_details(repo_id)` performs one unauthenticated
request to the public Hub model API and returns a `HubModel`. Along with the
existing repository ID, download count, like count, and pipeline tag, the object
can expose the declared license, combined Hub/model-card tags, last-modified
timestamp, and a best-effort repository byte total.

Repository size is returned only when every sibling has a valid byte size. A
missing, partial, or malformed size leaves `size_bytes` as `None`; this avoids
presenting a lower bound as the complete size. `license`, `last_modified`, and
`pipeline_tag` are also optional and reflect public Hub metadata as declared by
the repository owner. Requests use the existing network timeout and a 2 MiB
response cap. Metadata parsing is defensive and does not require login or
download model files.
