"""Optional offline speech tools with capability discovery and clear errors."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time


@dataclass(frozen=True)
class VoiceCapabilities:
    tts_executable: str | None
    recorder_executable: str | None
    stt_executable: str | None
    flite_executable: str | None = None
    flite_voices: tuple[str, ...] = ()
    tts_playback_executable: str | None = None

    @property
    def text_to_speech(self) -> bool:
        return self.tts_executable is not None or bool(self.flite_executable and self.flite_voices)

    @property
    def recording(self) -> bool:
        return self.recorder_executable is not None

    @property
    def speech_to_text(self) -> bool:
        return self.stt_executable is not None

    def details(self) -> dict[str, dict[str, object]]:
        """Return UI-friendly capability state, executable path, and setup hint."""
        return {
            "text_to_speech": {"available": self.text_to_speech,
                               "executable": self.tts_executable or self.flite_executable,
                               "provider": "espeak" if self.tts_executable else "ffmpeg-flite" if self.text_to_speech else None,
                               "voices": list(self.flite_voices),
                               "playback_available": bool(self.tts_executable or self.tts_playback_executable),
                               "setup": None if self.text_to_speech else "Install espeak-ng or FFmpeg built with libflite."},
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


# Keep direct transcription aligned with the bounded orchestration contract.
MAX_VOICE_INPUT_BYTES = 32 * 1024 * 1024
MAX_TRANSCRIPT_BYTES = 64 * 1024
MAX_VOICE_DIAGNOSTIC_BYTES = 8 * 1024
VOICE_TOOL_TIMEOUT_SECONDS = 180


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
            command = ([self._executable, "--wait", self._text]
                       if Path(self._executable).name == "spd-say" else [self._executable, self._text])
            process = subprocess.Popen(command, text=True,
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


class RecordingWorker:
    """Capture a local microphone stream until stop() or a fixed safety limit."""
    def __init__(self, executable: str, output: str | Path, max_seconds: int):
        self.output = Path(output).expanduser().resolve()
        self.max_seconds = max_seconds
        self._executable = executable
        self._process: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._stop_requested = threading.Event()
        self._cancelled = threading.Event()
        self._done = threading.Event()
        self._error: RuntimeError | None = None
        self._thread = threading.Thread(target=self._run, name="ai-dream-recording", daemon=True)
        self._thread.start()

    @property
    def done(self) -> bool:
        return self._done.is_set()

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    def stop(self) -> None:
        """Stop early and finalize the WAV file; safe to call repeatedly."""
        self._stop_requested.set()
        self._signal(signal.SIGINT)

    def cancel(self) -> None:
        """Abort capture and remove its partial output."""
        self._cancelled.set()
        self._signal(signal.SIGTERM)

    def wait(self, timeout: float | None = None) -> Path:
        if not self._done.wait(timeout):
            raise TimeoutError("Microphone recording is still running")
        if self._error:
            raise self._error
        if self._cancelled.is_set():
            raise RuntimeError("Microphone recording was cancelled")
        return self.output

    def _signal(self, sig: int) -> None:
        with self._lock:
            process = self._process
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass

    def _run(self) -> None:
        try:
            self.output.parent.mkdir(parents=True, exist_ok=True)
            self.output.unlink(missing_ok=True)
            process = subprocess.Popen(
                [self._executable, "-q", "-f", "S16_LE", "-r", "16000", "-c", "1",
                 "-d", str(self.max_seconds), str(self.output)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                start_new_session=True)
            with self._lock:
                self._process = process
            if self._cancelled.is_set():
                self._signal(signal.SIGTERM)
            elif self._stop_requested.is_set():
                self._signal(signal.SIGINT)
            _, stderr = process.communicate()
            if self._cancelled.is_set():
                self.output.unlink(missing_ok=True)
            elif process.returncode not in (0, -signal.SIGINT):
                detail = (stderr or b"").decode(errors="replace") if isinstance(stderr, bytes) else (stderr or "")
                self._error = RuntimeError(f"Recorder exited with status {process.returncode}: {detail.strip()[-1200:]}")
            elif not self.output.is_file() or self.output.stat().st_size == 0:
                self._error = RuntimeError("Recorder did not produce an audio file")
        except (OSError, subprocess.SubprocessError) as exc:
            self._error = RuntimeError(f"Could not record microphone audio: {exc}")
        finally:
            self._done.set()


class LocalVoice:
    """Run local TTS, microphone capture, and whisper.cpp transcription tools."""
    def __init__(self):
        tts = shutil.which("espeak-ng") or shutil.which("espeak")
        flite = None if tts else shutil.which("ffmpeg")
        flite_voices = _discover_flite_voices(flite) if flite else ()
        speech_dispatcher = shutil.which("spd-say") if flite_voices else None
        self.capabilities = VoiceCapabilities(
            tts, shutil.which("arecord"), shutil.which("whisper-cli") or shutil.which("whisper-cpp"),
            flite, flite_voices, speech_dispatcher)

    def configuration(self, model_directories: list[str | Path] | None = None) -> VoiceConfiguration:
        return VoiceConfiguration(self.capabilities, discover_whisper_models(model_directories))

    def speak_async(self, text: str) -> SpeechWorker:
        executable = self.capabilities.tts_executable or self.capabilities.tts_playback_executable
        if not executable:
            raise RuntimeError("Offline text-to-speech unavailable; " + self.capabilities.setup_help())
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Text to speak cannot be empty")
        return SpeechWorker(executable, text)


    def speak(self, text: str) -> None:
        self.speak_async(text).wait()

    def start_recording(self, output: str | Path, max_seconds: int = 30) -> RecordingWorker:
        exe = self.capabilities.recorder_executable
        if not exe:
            raise RuntimeError("Microphone recording unavailable; " + self.capabilities.setup_help())
        if isinstance(max_seconds, bool) or not isinstance(max_seconds, int) or not 1 <= max_seconds <= 120:
            raise ValueError("Maximum recording duration must be from 1 to 120 seconds")
        return RecordingWorker(exe, output, max_seconds)

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
        audio_size = audio_path.stat().st_size
        if not 1 <= audio_size <= MAX_VOICE_INPUT_BYTES:
            raise ValueError(f"Audio input must be from 1 to {MAX_VOICE_INPUT_BYTES} bytes")
        if model_path.stat().st_size <= 0:
            raise ValueError("The selected whisper.cpp model file is empty")
        if not (model_path.name.startswith("ggml-") and model_path.suffix == ".bin"):
            raise ValueError("Choose an installed whisper.cpp GGML model file (ggml-*.bin)")
        output = self._run_bounded_capture(
            [exe, "-m", str(model_path), "-f", str(audio_path), "--no-timestamps"])
        return output.strip()

    @staticmethod
    def _run_bounded_capture(command: list[str]) -> str:
        """Run a local tool without retaining unbounded child output in memory."""
        try:
            with tempfile.TemporaryFile(mode="w+b") as stdout_file, \
                    tempfile.TemporaryFile(mode="w+b") as stderr_file:
                result = subprocess.run(command, check=False, stdout=stdout_file,
                                        stderr=stderr_file, timeout=VOICE_TOOL_TIMEOUT_SECONDS)
                stdout_file.seek(0, os.SEEK_END)
                stdout_size = stdout_file.tell()
                if stdout_size > MAX_TRANSCRIPT_BYTES:
                    raise RuntimeError("Local transcription exceeded its output limit")
                stdout_file.seek(0)
                stdout = stdout_file.read(MAX_TRANSCRIPT_BYTES + 1).decode(errors="replace")
                if result.returncode:
                    stderr_file.seek(0, os.SEEK_END)
                    stderr_size = stderr_file.tell()
                    stderr_file.seek(max(0, stderr_size - MAX_VOICE_DIAGNOSTIC_BYTES))
                    detail = stderr_file.read(MAX_VOICE_DIAGNOSTIC_BYTES).decode(errors="replace").strip()
                    raise RuntimeError(f"Voice tool exited with status {result.returncode}: {detail}")
                return stdout
        except RuntimeError:
            raise
        except (OSError, subprocess.SubprocessError) as exc:
            raise RuntimeError(f"Could not run local voice tool: {exc}") from exc

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


def _discover_flite_voices(executable: str) -> tuple[str, ...]:
    """Probe FFmpeg's compiled-in Flite filter without synthesizing speech."""
    try:
        result = subprocess.run(
            [executable, "-hide_banner", "-f", "lavfi", "-i", "flite=list_voices=true", "-f", "null", "-"],
            check=False, capture_output=True, text=True, timeout=5, close_fds=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ()
    voices = re.findall(r"^\[Parsed_flite_\d+ @ [^]]+\]\s+([a-z0-9_-]+)\s*$", result.stderr, re.MULTILINE)
    return tuple(sorted(set(voice for voice in voices if re.fullmatch(r"[a-z0-9_-]{1,40}", voice))))
