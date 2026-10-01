"""Bounded orchestration callbacks for already-installed local voice tools.

Readiness probes may run bounded help/voice-list commands but never synthesize,
record, download, or load a speech model. Audio work starts only in an explicit
workflow callback.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from pathlib import Path
import subprocess
import tempfile
import re
from typing import Any

from aidream.artifacts.contracts import ArtifactEnvelope, validate_artifact_envelope
from aidream.voice import LocalVoice

MAX_VOICE_INPUT_BYTES = 32 * 1024 * 1024
MAX_VOICE_TEXT_CHARS = 4_000
MAX_TRANSCRIPT_CHARS = 16_000
MAX_SYNTHESIZED_AUDIO_BYTES = 16 * 1024 * 1024
VOICE_TIMEOUT_SECONDS = 180
TTS_TIMEOUT_SECONDS = 30
_AUDIO_EXTENSIONS = {
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg", "audio/webm": ".webm", "audio/flac": ".flac",
    "audio/mp4": ".m4a",
}


class VoiceOrchestrationError(ValueError):
    """Invalid voice request or unavailable local voice capability."""


def local_voice_readiness(voice: LocalVoice, *, whisper_model: str | Path | None = None) -> dict[str, Any]:
    """Report installed tool/model presence without synthesis or recording."""
    config = voice.configuration()
    model = _select_whisper_model(config.whisper_models, whisper_model, required=False)
    stt_available = bool(config.capabilities.speech_to_text and model is not None)
    tts_executable = getattr(config.capabilities, "tts_executable", None)
    flite_executable = getattr(config.capabilities, "flite_executable", None)
    flite_voices = tuple(getattr(config.capabilities, "flite_voices", ()))
    tts_provider = "espeak" if tts_executable else "ffmpeg-flite" if flite_executable and flite_voices else None
    tts_available = tts_provider is not None
    stt_reasons = []
    if not config.capabilities.speech_to_text:
        stt_reasons.append("Install whisper.cpp and put whisper-cli on PATH.")
    if config.capabilities.speech_to_text and model is None:
        stt_reasons.append("No installed whisper.cpp GGML model was found; configure an existing model file.")
    return {
        "audio.transcribe": {"available": stt_available, "model_configured": model is not None,
                             "reasons": stt_reasons},
        "audio.synthesize": {"available": tts_available, "provider": tts_provider,
                             "voices": list(flite_voices) if tts_provider == "ffmpeg-flite" else [],
                             "selected_voice": (("kal" if "kal" in flite_voices else flite_voices[0])
                                                if tts_provider == "ffmpeg-flite" and flite_voices else None),
                             "reasons": [] if tts_available else [
                                 "No local TTS provider found. Install espeak-ng or FFmpeg built with libflite."]},
    }


def create_local_voice_callbacks(
    voice: LocalVoice,
    *,
    read_artifact: Callable[[ArtifactEnvelope], bytes],
    whisper_model: str | Path | None = None,
    render_speech: Callable[[str, str], bytes] | None = None,
) -> dict[str, Callable[[Mapping[str, Any], Mapping[str, Any]], Mapping[str, Any]]]:
    """Create typed executor callbacks for ``audio.transcribe`` and synthesize.

    ``read_artifact`` must enforce the artifact store's owner scope. Binary run
    outputs are returned as bytes in the standard typed form; RunManager moves
    them into its bounded artifact store before publishing run events.
    ``render_speech`` is injectable for tests; production defaults to the
    already-discovered espeak executable with fixed arguments and a timeout.
    """
    if not callable(read_artifact):
        raise TypeError("read_artifact must be callable")
    config = voice.configuration()
    model_path = _select_whisper_model(config.whisper_models, whisper_model, required=False)
    render = render_speech

    def transcribe(_node: Mapping[str, Any], inputs: Mapping[str, Any]) -> Mapping[str, Any]:
        executable = config.capabilities.stt_executable
        if not executable:
            raise VoiceOrchestrationError("Local speech-to-text is unavailable; install whisper.cpp.")
        if model_path is None:
            raise VoiceOrchestrationError("No installed whisper.cpp model is available; configure an existing model file.")
        artifact = _validated_audio(inputs.get("audio"))
        try:
            audio_bytes = read_artifact(artifact)
        except Exception as exc:
            raise VoiceOrchestrationError("Could not read the selected audio artifact.") from exc
        if not isinstance(audio_bytes, bytes) or len(audio_bytes) != artifact["size_bytes"]:
            raise VoiceOrchestrationError("Selected audio artifact content does not match its envelope size.")
        if not audio_bytes or len(audio_bytes) > MAX_VOICE_INPUT_BYTES:
            raise VoiceOrchestrationError(f"Audio input must be from 1 byte to {MAX_VOICE_INPUT_BYTES} bytes.")
        suffix = _AUDIO_EXTENSIONS[artifact["media_type"]]
        try:
            with tempfile.TemporaryDirectory(prefix="ai-dream-voice-") as temporary:
                directory = Path(temporary)
                directory.chmod(0o700)
                path = directory / ("selected-audio" + suffix)
                path.write_bytes(audio_bytes)
                path.chmod(0o600)
                transcript = voice.transcribe(path, model_path)
        except Exception as exc:
            raise VoiceOrchestrationError("Local speech transcription failed.") from exc
        if not isinstance(transcript, str):
            raise VoiceOrchestrationError("Local speech transcription returned an invalid result.")
        transcript = transcript.strip()
        if not transcript or len(transcript) > MAX_TRANSCRIPT_CHARS:
            raise VoiceOrchestrationError("Transcription was empty or exceeded its output limit.")
        return {"transcript": {"kind": "text", "text": transcript}}

    def synthesize(_node: Mapping[str, Any], inputs: Mapping[str, Any]) -> Mapping[str, Any]:
        executable = getattr(config.capabilities, "tts_executable", None)
        ffmpeg = getattr(config.capabilities, "flite_executable", None)
        voices = tuple(getattr(config.capabilities, "flite_voices", ()))
        if render is None and not executable and not (ffmpeg and voices):
            raise VoiceOrchestrationError(
                "Local text-to-speech is unavailable; install espeak-ng or FFmpeg built with libflite.")
        text_artifact = inputs.get("text")
        text = text_artifact.get("text") if isinstance(text_artifact, Mapping) and text_artifact.get("kind") == "text" else None
        voice_artifact = inputs.get("voice")
        requested_voice = (voice_artifact.get("text") if isinstance(voice_artifact, Mapping)
                           and voice_artifact.get("kind") == "text" else None)
        if requested_voice == "auto":
            requested_voice = None
        if requested_voice is not None and (not isinstance(requested_voice, str)
                                            or not re.fullmatch(r"[a-z0-9_-]{1,40}", requested_voice)):
            raise VoiceOrchestrationError("Selected local Flite voice is invalid.")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_VOICE_TEXT_CHARS:
            raise VoiceOrchestrationError(f"Speech text must contain 1 to {MAX_VOICE_TEXT_CHARS} characters.")
        try:
            if render is not None:
                if requested_voice is not None:
                    raise VoiceOrchestrationError("Voice selection is unavailable with the injected speech renderer.")
                audio = render(executable or ffmpeg or "", text.strip())
            elif executable:
                if requested_voice is not None:
                    raise VoiceOrchestrationError("The installed espeak route does not report selectable voices.")
                audio = _render_espeak(executable, text.strip())
            else:
                voice_name = requested_voice or ("kal" if "kal" in voices else voices[0])
                if voice_name not in voices:
                    raise VoiceOrchestrationError("Selected local Flite voice is not in the current discovered voice list.")
                audio = _render_ffmpeg_flite(ffmpeg, text.strip(), voice_name)
        except Exception as exc:
            if isinstance(exc, VoiceOrchestrationError):
                raise
            raise VoiceOrchestrationError("Local speech synthesis failed.") from exc
        if not isinstance(audio, bytes) or not _is_wav(audio) or len(audio) > MAX_SYNTHESIZED_AUDIO_BYTES:
            raise VoiceOrchestrationError("Speech synthesizer returned invalid or oversized WAV audio.")
        return {"audio": {
            "kind": "audio", "media_type": "audio/wav", "name": "speech.wav",
            "content_bytes": audio,
            "metadata": {"generator": "local-espeak" if executable else "local-ffmpeg-flite",
                         "voice": None if executable else voice_name,
                         "text_chars": len(text.strip())},
        }}

    return {"audio.transcribe": transcribe, "audio.synthesize": synthesize}


def _validated_audio(value: Any) -> ArtifactEnvelope:
    try:
        artifact = validate_artifact_envelope(value)
    except (TypeError, ValueError) as exc:
        raise VoiceOrchestrationError("Audio input must be a valid selected artifact envelope.") from exc
    if artifact["kind"] != "audio" or artifact["media_type"] not in _AUDIO_EXTENSIONS:
        raise VoiceOrchestrationError("Selected artifact must use a supported audio media type.")
    if artifact["owner"]["type"] not in {"session", "user"}:
        raise VoiceOrchestrationError("Audio input must be selected from a session or user-owned artifact.")
    if artifact["lifetime"] not in {"session", "persistent"}:
        raise VoiceOrchestrationError("Audio input must remain available for the duration of the run.")
    if not 0 < artifact["size_bytes"] <= MAX_VOICE_INPUT_BYTES:
        raise VoiceOrchestrationError(f"Audio input must be from 1 byte to {MAX_VOICE_INPUT_BYTES} bytes.")
    return artifact


def _select_whisper_model(models, configured: str | Path | None, *, required: bool) -> Path | None:
    installed: list[Path] = []
    for value in models:
        try:
            path = Path(value).expanduser().resolve(strict=True)
            if path.is_file() and path.name.startswith("ggml-") and path.suffix == ".bin":
                installed.append(path)
        except (OSError, RuntimeError):
            continue
    if configured is not None:
        try:
            selected = Path(configured).expanduser().resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise VoiceOrchestrationError("Configured whisper model is not an installed local file.") from exc
        if selected not in installed:
            raise VoiceOrchestrationError("Configured whisper model is not in the discovered local model list.")
        return selected
    if installed:
        return sorted(installed)[0]
    if required:
        raise VoiceOrchestrationError("No installed whisper.cpp model was found.")
    return None


def _render_espeak(executable: str, text: str) -> bytes:
    try:
        result = subprocess.run(
            [executable, "--stdout", text], check=False, capture_output=True,
            timeout=TTS_TIMEOUT_SECONDS, close_fds=True,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise VoiceOrchestrationError("Could not finish local speech synthesis within its time limit.") from exc
    if result.returncode != 0:
        raise VoiceOrchestrationError("Local speech synthesizer returned a failure status.")
    if len(result.stdout) > MAX_SYNTHESIZED_AUDIO_BYTES:
        raise VoiceOrchestrationError("Synthesized audio exceeded its byte limit.")
    return result.stdout


def _render_ffmpeg_flite(executable: str, text: str, voice: str) -> bytes:
    """Synthesize bounded local PCM WAV through FFmpeg's compiled Flite filter."""
    if not re.fullmatch(r"[a-z0-9_-]{1,40}", voice):
        raise VoiceOrchestrationError("Selected local Flite voice is invalid.")
    try:
        with tempfile.TemporaryDirectory(prefix="ai-dream-flite-", dir="/tmp") as temporary:
            directory = Path(temporary)
            directory.chmod(0o700)
            text_path = directory / "speech.txt"
            text_path.write_text(text, encoding="utf-8")
            text_path.chmod(0o600)
            result = subprocess.run(
                [executable, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                 f"flite=textfile={text_path}:voice={voice}", "-t", "30", "-ac", "1", "-ar", "22050",
                 "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"],
                check=False, capture_output=True, timeout=TTS_TIMEOUT_SECONDS, close_fds=True,
            )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise VoiceOrchestrationError("Could not finish local Flite speech synthesis within its time limit.") from exc
    if result.returncode != 0:
        raise VoiceOrchestrationError("Local FFmpeg Flite synthesis failed.")
    if len(result.stdout) > MAX_SYNTHESIZED_AUDIO_BYTES:
        raise VoiceOrchestrationError("Synthesized audio exceeded its byte limit.")
    return result.stdout


def _is_wav(value: bytes) -> bool:
    return len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WAVE"


__all__ = [
    "MAX_VOICE_INPUT_BYTES", "MAX_VOICE_TEXT_CHARS", "MAX_TRANSCRIPT_CHARS",
    "MAX_SYNTHESIZED_AUDIO_BYTES", "VoiceOrchestrationError",
    "create_local_voice_callbacks", "local_voice_readiness",
]
