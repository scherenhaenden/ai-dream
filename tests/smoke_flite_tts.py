#!/usr/bin/env python3
"""CPU-only smoke: synthesize and inspect a local Flite WAV without a model."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aidream.voice import LocalVoice
from aidream.voice_orchestration import create_local_voice_callbacks, local_voice_readiness


def main() -> int:
    voice = LocalVoice()
    readiness = local_voice_readiness(voice)
    synthesis = readiness["audio.synthesize"]
    if not synthesis["available"]:
        raise SystemExit("No supported local TTS route is installed; no provider was run.")
    callbacks = create_local_voice_callbacks(voice, read_artifact=lambda _artifact: b"")
    output = callbacks["audio.synthesize"]({}, {"text": {"kind": "text", "text": "Local CPU audio format check."}})["audio"]
    if output["media_type"] != "audio/wav" or not output["content_bytes"].startswith(b"RIFF"):
        raise AssertionError("Local TTS did not return a RIFF WAV artifact")

    directory = Path(tempfile.mkdtemp(prefix="ai-dream-flite-smoke-"))
    wav = directory / "speech.wav"
    wav.write_bytes(output["content_bytes"])
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise SystemExit("ffprobe is missing; the generated WAV artifact bytes were produced but not validated.")
    result = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=codec_name,sample_rate,channels", "-of", "default=noprint_wrappers=1", str(wav)],
        check=True, capture_output=True, text=True, timeout=10,
    )
    observed = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if observed.get("codec_name") != "pcm_s16le" or observed.get("sample_rate") != "22050" or observed.get("channels") != "1":
        raise AssertionError(f"Unexpected Flite WAV stream metadata: {observed}")
    if len(output["content_bytes"]) < 1024:
        raise AssertionError("Flite WAV output is suspiciously small")
    print(f"Local {synthesis['provider']} CPU synthesis produced valid {observed['sample_rate']} Hz mono PCM WAV.")
    print(f"Rendered WAV artifact: {wav}")
    print("No neural model, GPU, cloud endpoint, or audio input was used.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
