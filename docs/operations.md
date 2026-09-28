# Operations and local data

AI Dream runs locally on Linux. The Python backend needs Python 3.10 or newer.
Text generation requires a usable `llama-server` from llama.cpp and a GGUF chat
model. The Tk interface additionally requires Python's Tk support. The Angular
interface requires a browser; building its production assets requires the
Node/npm toolchain described by `web/package.json` and `web/package-lock.json`.
Voice programs and PDF parsing are optional and enable only their respective
features.

## Launch the available interfaces

From the repository root, build the Angular assets once and launch the browser
interface:

```sh
npm --prefix web ci
npm --prefix web run build
./open-ai-dream-web
```

The launcher runs `python3 -m aidream web`, serves both Angular and the JSON
API on `http://127.0.0.1:8765`, and asks the system browser to open that URL.
The desktop launcher adds `--restart` by default, which stops a previous
AI Dream server on that port only after checking its recorded PID and command.
Use `python3 -m aidream web --stop` to stop the managed server, or
`python3 -m aidream web --restart` to stop and start it again. The server handles
Ctrl+C and SIGTERM with a graceful shutdown. Use `./open-ai-dream-web --port 8780`
if an unrelated application owns port 8765; the launcher will never stop it.
`AI Dream Web.desktop`
in the repository root launches the same browser interface with one click. It
contains absolute paths to this checkout; update its `Exec`, `TryExec`, and
`Path` entries if the checkout is moved. A dated preview, when present, has its
own launcher and `BUILD-INFO.txt` under `build/linux/DD.MM.YYYY/`.

The Tk interface starts with `./open-ai-dream`. It supplies controls that are
not yet present in Angular, including image/document attachment selection,
local voice, and detailed runtime/preset settings. The command line needs no
Tk window:

```sh
python3 -m aidream hardware
python3 -m aidream models add /absolute/path/to/models
python3 -m aidream models rescan
python3 -m aidream models list
python3 -m aidream backends
python3 -m aidream run /absolute/path/to/model.gguf
```

`python3 -m aidream serve --port 8765` starts just the API, which is useful
alongside `npm --prefix web run start` during frontend development. The Vite
development server uses `http://127.0.0.1:5173`; the API only allows that
specific development origin or its own production origin for writes. The
terminal chat exits with `/exit`. An editable package installation adds the
`app` and `app-gui` commands (`python3 -m pip install -e .`, preferably inside a
virtual environment).

## First local inference

1. Check `python3 -m aidream backends`. A usable llama.cpp backend needs
   `llama-server` on `PATH`. Install a compatible llama.cpp package using your
   distribution's package manager if it is missing. The backend contains a
   Debian/Ubuntu installation service, but no current CLI, Tk or HTTP action
   invokes it; launching AI Dream never installs system packages.
2. In the Tk window, click **Add folder**, choose the directory containing your
   `.gguf` files, then click **Scan**. Scanning indexes paths and does not move
   files. The model list refreshes after adding a folder.
3. Select a chat-capable GGUF, choose the runtime settings, and click **Load
   model**. Loading does not send a prompt. **Runtime status** confirms whether
   it is loaded; **Unload model** stops it and **Reload model** applies the
   currently selected model and load settings. A projector GGUF is catalogued
   but cannot run as a standalone chat model. Runtime device names come from
   llama.cpp rather than the hardware-list numbering.
4. If a load option is not supported by the detected executable, its UI
   control is disabled or the backend rejects the request. An explicit tensor
   split disables llama.cpp auto-fit by default because the installed build
   reproduced an abort with both options together.

The browser's Hub downloads use the managed model directory. Tk's Hub dialog
can choose an existing destination directory. Hub access covers public
repositories; network access is needed for search and download, while local
inference does not call the Hub.

## Local files and ownership

| Purpose | Default path | Behavior |
|---|---|---|
| Registered model folders | `~/.config/ai-dream/model-sources.json` | Folder paths only; model bytes stay in place |
| Chats | `$XDG_DATA_HOME/ai-dream/chats/*.json` | One atomically replaced JSON file per chat |
| Reusable presets | `$XDG_DATA_HOME/ai-dream/presets.json` | Validated local settings |
| Browser Hub downloads | `$XDG_DATA_HOME/ai-dream/models/` | Completed GGUFs are registered as a model source |
| Interrupted Hub transfer | `.aidream-*.part` plus `.aidream-*.json` in the destination | Resume metadata is checked before reuse |
| Discovered Whisper models | `$XDG_DATA_HOME/ai-dream/whisper/`, `~/.cache/whisper/`, `/usr/share/whisper.cpp/`, or `AI_DREAM_WHISPER_MODEL` | Existing `ggml-*.bin` files are discovered; none are downloaded automatically |

If `XDG_DATA_HOME` is unset, AI Dream uses `~/.local/share`. Back up the
configuration file, chat directory, presets file, and downloaded model files
separately. Deleting a chat removes its JSON record but leaves its referenced
image and document files alone. Saved attachments are references to existing
local files; moving or modifying those files stops them from being restored.
See [chat attachment history](chat-attachment-history.md) for exact matching.

## Optional input tools

`espeak-ng` or `espeak` enables local text-to-speech, `arecord` enables
microphone capture, and `whisper-cli` or `whisper-cpp` plus an installed
Whisper GGML model enables transcription. Voice is currently a Tk workflow.
Text-based PDF extraction needs `pypdf`; scanned PDFs are not OCRed. The
individual [voice](voice.md), [image](image-input.md), and
[document](document-input.md) guides give limits and error behavior.

## Common failures

| Symptom | Check |
|---|---|
| Browser launcher says the Angular build is missing | Run `npm --prefix web ci` and `npm --prefix web run build` from this checkout; the server expects `web/dist/index.html`. |
| Browser does not open automatically | Read the URL printed by `./open-ai-dream-web` and open it manually in a local browser. |
| Runtime is unavailable | Check `python3 -m aidream backends` and that `llama-server` is executable on `PATH`. |
| No models appear | Add and scan an existing directory; confirm it contains `.gguf` files and is readable. |
| Browser cannot write to the API in development | Use `http://127.0.0.1:5173`, with the API running on the selected loopback port. Other origins are rejected. |
| A saved attachment is missing after reopening a chat | Check that the original file still has the same path, size, modification time, and SHA-256 digest. |
| Voice controls are unavailable | Check the optional local executables and select an installed Whisper model for transcription. |

The HTTP server binds only to IPv4 loopback. See the [API contract](local-http-api.md)
for its limits, origin rules, streaming events, and errors. Current and planned
features are tracked in [ROADMAP.md](../ROADMAP.md).

## Development checks and preview builds

The Python tests use the standard library's `unittest`; some HTTP/runtime
tests open loopback sockets. From the repository root:

```sh
python3 -m unittest discover -s tests -q
npm --prefix web run typecheck
npm --prefix web run build
```

These tests use fakes and local HTTP fixtures for most integrations. A passing
unit suite does not establish that an arbitrary llama.cpp build, GPU driver or
GGUF model loads on a different machine. The dated Linux preview's
`BUILD-INFO.txt` records its source revision and the checks made on the build
machine. `build/` is ignored by Git and there is no checked-in packaging
command; a preview must include the Python package, launcher files,
`pyproject.toml`, and the complete `web/dist` output. Desktop files contain
absolute paths and need to be adjusted for their final location.
