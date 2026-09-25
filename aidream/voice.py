"""Optional offline speech tools with capability discovery and clear errors."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import signal
import subprocess
import threading
import time


@dataclass(frozen=True)
class VoiceCapabilities:
    tts_executable: str | None
    recorder_executable: str | None
    stt_executable: str | None

    @property
    def text_to_speech(self) -> bool:
        return self.tts_executable is not None

    @property
    def recording(self) -> bool:
        return self.recorder_executable is not None

    @property
    def speech_to_text(self) -> bool:
        return self.stt_executable is not None

    def details(self) -> dict[str, dict[str, str | bool | None]]:
        """Return UI-friendly capability state, executable path, and setup hint."""
        return {
            "text_to_speech": {"available": self.text_to_speech, "executable": self.tts_executable,
                               "setup": None if self.text_to_speech else "Install espeak-ng (or espeak)."},
            "recording": {"available": self.recording, "executable": self.recorder_executable,
                          "setup": None if self.recording else "Install alsa-utils (arecord)."},
            "speech_to_text": {"available": self.speech_to_text, "executable": self.stt_executable,
                               "setup": None if self.speech_to_text else "Install whisper.cpp and put whisper-cli on PATH."},
        }

    def setup_help(self) -> str:
        missing = [str(info["setup"]) for info in self.details().values() if not info["available"]]
        return "; ".join(missing) if missing else "Offline voice input and output are available."


@dataclass(frozen=True)
class VoiceConfiguration:
    capabilities: VoiceCapabilities
    whisper_models: tuple[Path, ...]


def discover_whisper_models(directories: list[str | Path] | None = None) -> tuple[Path, ...]:
    """Find already-installed whisper.cpp GGML model files; never downloads anything."""
    if directories is None:
        data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
        configured = os.environ.get("AI_DREAM_WHISPER_MODEL")
        directories = [p for p in [configured, data_home / "ai-dream/whisper", Path.home() / ".cache/whisper",
                                    Path("/usr/share/whisper.cpp")] if p]
    found: set[Path] = set()
    for directory in directories:
        path = Path(directory).expanduser()
        if path.is_file() and path.name.startswith("ggml-") and path.suffix == ".bin":
            found.add(path.resolve())
        elif path.is_dir():
            found.update(p.resolve() for p in path.glob("ggml-*.bin") if p.is_file())
    return tuple(sorted(found))


class SpeechWorker:
    """Background TTS job whose cancel() only signals its own subprocess group."""
    def __init__(self, executable: str, text: str):
        self._executable, self._text = executable, text
        self._lock = threading.Lock()
        self._cancelled = threading.Event()
        self._done = threading.Event()
        self._process: subprocess.Popen | None = None
        self._error: RuntimeError | None = None
        self._thread = threading.Thread(target=self._run, name="ai-dream-tts", daemon=True)
        self._thread.start()

    @property
    def done(self) -> bool:
        return self._done.is_set()

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    def cancel(self, grace_seconds: float = 0.4) -> None:
        self._cancelled.set()
        with self._lock:
            process = self._process
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
            deadline = time.monotonic() + max(0.0, grace_seconds)
            while process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def wait(self, timeout: float | None = None) -> None:
        if not self._done.wait(timeout):
            raise TimeoutError("Speech output is still running")
        if self._error:
            raise self._error

    def _run(self) -> None:
        try:
            process = subprocess.Popen([self._executable, self._text], text=True,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                       start_new_session=True)
            with self._lock:
                self._process = process
            if self._cancelled.is_set():
                self.cancel()
            _, stderr = process.communicate()
            if process.returncode and not self._cancelled.is_set():
                self._error = RuntimeError(f"Voice tool exited with status {process.returncode}: {(stderr or '').strip()[-1200:]}")
        except OSError as exc:
            self._error = RuntimeError(f"Could not run local voice tool: {exc}")
        finally:
            self._done.set()


class LocalVoice:
    """Run local TTS, microphone capture, and whisper.cpp transcription tools."""
    def __init__(self):
        self.capabilities = VoiceCapabilities(
            shutil.which("espeak-ng") or shutil.which("espeak"),
            shutil.which("arecord"), shutil.which("whisper-cli") or shutil.which("whisper-cpp"))

    def configuration(self, model_directories: list[str | Path] | None = None) -> VoiceConfiguration:
        return VoiceConfiguration(self.capabilities, discover_whisper_models(model_directories))

    def speak_async(self, text: str) -> SpeechWorker:
        if not self.capabilities.tts_executable:
            raise RuntimeError("Offline text-to-speech unavailable; " + self.capabilities.setup_help())
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Text to speak cannot be empty")
        return SpeechWorker(self.capabilities.tts_executable, text)

    def speak(self, text: str) -> None:
        self.speak_async(text).wait()

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
