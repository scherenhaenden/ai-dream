# Offline voice support

`aidream.voice.LocalVoice` detects local tools only: `espeak-ng`/`espeak` for
speech output, `arecord` (from ALSA utilities) for microphone capture, and
`whisper-cli`/`whisper-cpp` for transcription. No cloud service is used.

`LocalVoice.configuration()` returns the detected executable paths and any
installed whisper.cpp model files. Model discovery checks the configured
`AI_DREAM_WHISPER_MODEL` path plus the app's XDG data directory, the user's
Whisper cache, and `/usr/share/whisper.cpp`. It only discovers models already
present; it does not download model weights. Callers may pass explicit model
directories.

Use `speak_async(text)` to get a `SpeechWorker`; it runs TTS in the background.
`worker.cancel()` sends SIGTERM to the process group created specifically for
that speech job, then SIGKILL after a short grace period if needed. It never
signals an unrelated process. `worker.wait(timeout)` waits and propagates
errors, while `done` and `cancelled` expose state. `speak(text)` remains the
synchronous convenience method.

On Linux install `espeak-ng`, `alsa-utils`, and `whisper.cpp` as needed. A
Whisper model file is separately required for transcription. The application
does not install system packages or fetch speech models automatically.

In the desktop app, hold **Hold to talk** to capture local microphone audio and
release the control to stop early and transcribe with the selected installed
Whisper model. The maximum capture time follows the recording duration setting
(1–120 seconds). The transcript is inserted into the prompt and is not sent
automatically. Canceling the application stops capture and removes partial
audio. The separate timed **Record & transcribe** control remains available.
