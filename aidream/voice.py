"""Optional offline speech tools with capability discovery and clear errors."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
import subprocess


@dataclass(frozen=True)
class VoiceCapabilities:
    tts_executable: str | None
    recorder_executable: str | None
    stt_executable: str | None
    @property
    def text_to_speech(self) -> bool: return self.tts_executable is not None
    @property
    def recording(self) -> bool: return self.recorder_executable is not None
    @property
    def speech_to_text(self) -> bool: return self.stt_executable is not None
    def setup_help(self) -> str:
        missing = []
        if not self.text_to_speech: missing.append("install espeak-ng (or espeak) for offline speech output")
        if not self.recording: missing.append("install alsa-utils for microphone recording")
        if not self.speech_to_text: missing.append("install whisper.cpp and put whisper-cli on PATH for offline transcription")
        return "; ".join(missing) if missing else "Offline voice input and output are available."


class LocalVoice:
    """Run local TTS, microphone capture, and whisper.cpp transcription tools."""
    def __init__(self):
        self.capabilities = VoiceCapabilities(
            shutil.which("espeak-ng") or shutil.which("espeak"),
            shutil.which("arecord"), shutil.which("whisper-cli") or shutil.which("whisper-cpp"))

    def speak(self, text: str) -> None:
        if not self.capabilities.tts_executable:
            raise RuntimeError("Offline text-to-speech unavailable; " + self.capabilities.setup_help())
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Text to speak cannot be empty")
        self._run([self.capabilities.tts_executable, text])

    def record(self, output: str | Path, seconds: int = 5) -> Path:
        exe = self.capabilities.recorder_executable
        if not exe:
            raise RuntimeError("Microphone recording unavailable; " + self.capabilities.setup_help())
        if isinstance(seconds, bool) or not isinstance(seconds, int) or not 1 <= seconds <= 120:
            raise ValueError("Recording duration must be from 1 to 120 seconds")
        target = Path(output).expanduser().resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        self._run([exe, "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-d", str(seconds), str(target)])
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError("Recorder did not produce an audio file")
        return target

    def transcribe(self, audio: str | Path, model: str | Path) -> str:
        exe = self.capabilities.stt_executable
        if not exe:
            raise RuntimeError("Offline speech recognition unavailable; " + self.capabilities.setup_help())
        audio_path, model_path = Path(audio).expanduser().resolve(), Path(model).expanduser().resolve()
        if not audio_path.is_file() or not model_path.is_file():
            raise FileNotFoundError("Choose an existing audio file and a whisper.cpp model file")
        result = self._run([exe, "-m", str(model_path), "-f", str(audio_path), "--no-timestamps"], capture=True)
        return result.stdout.strip()

    @staticmethod
    def _run(command: list[str], capture: bool = False):
        try:
            result = subprocess.run(command, check=False, text=True, capture_output=capture, timeout=180)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"Could not run local voice tool: {exc}") from exc
        if result.returncode:
            detail = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(f"Voice tool exited with status {result.returncode}: {detail[-1200:]}")
        return result
