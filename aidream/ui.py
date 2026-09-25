"""Small Tk GUI over the same catalog, hardware, and runtime services as the CLI."""

from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import threading
import queue
import tempfile
from pathlib import Path


class AIDreamWindow:
    def __init__(self, root: tk.Tk):
        from aidream.hardware import HardwareService
        from aidream.models import ModelCatalog
        from aidream.runtime import RuntimeRegistry

        from aidream.conversation import ChatStore
        from aidream.voice import LocalVoice

        self.root = root
        self.chat_store = ChatStore()
        self.voice = LocalVoice()
        self._voice_results = queue.Queue()
        self._voice_busy = False
        sessions = self.chat_store.list_sessions()
        self.sessions = sessions
        self.chat_session = sessions[0] if sessions else self.chat_store.create()
        self.last_answer = ""
        self.root.title("AI Dream")
        self.root.geometry("900x650")
        self.catalog = ModelCatalog()
        self.hardware = HardwareService()
        self.registry = RuntimeRegistry()
        self.models = []
        self.backends = self.registry.list_backends()
        self.backend_by_name = {b.name: b for b in self.backends}
        self.loaded_backend = None
        self.loaded_key = None
        self._settings_widgets = {}
        self._build()
        self.root.after(100, self._poll_voice_results)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.refresh()

    def _build(self):
        root = self.root
        pane = ttk.Panedwindow(root, orient=tk.HORIZONTAL)
        pane.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        left = ttk.Frame(pane, padding=8)
        pane.add(left, weight=1)
        ttk.Label(left, text="Hardware").pack(anchor="w")
        self.hardware_text = tk.Text(left, height=8, width=38, state=tk.DISABLED, wrap=tk.WORD)
        self.hardware_text.pack(fill=tk.X, pady=(2, 8))
        ttk.Label(left, text="Model directories").pack(anchor="w")
        self.sources = tk.Listbox(left, height=5, exportselection=False)
        self.sources.pack(fill=tk.X, pady=2)
        row = ttk.Frame(left)
        row.pack(fill=tk.X)
        ttk.Button(row, text="Add folder", command=self.add_folder).pack(side=tk.LEFT)
        ttk.Button(row, text="Scan", command=self.scan).pack(side=tk.LEFT, padx=4)
        ttk.Button(row, text="Download from Hugging Face", command=self.open_hf_downloader).pack(side=tk.LEFT)
        ttk.Label(left, text="GGUF models").pack(anchor="w", pady=(8, 0))
        self.model_list = tk.Listbox(left, height=14, exportselection=False)
        self.model_list.pack(fill=tk.BOTH, expand=True, pady=2)

        right = ttk.Frame(pane, padding=8)
        pane.add(right, weight=2)
        settings = ttk.Frame(right)
        settings.pack(fill=tk.X)
        ttk.Label(settings, text="Runtime").pack(side=tk.LEFT)
        names = [b.name for b in self.backends]
        self.backend_var = tk.StringVar(value=names[0] if names else "")
        self.backend_box = ttk.Combobox(settings, textvariable=self.backend_var, values=names, state="readonly", width=20)
        self.backend_box.pack(side=tk.LEFT, padx=6)
        ttk.Label(settings, text="Runtime device name").pack(side=tk.LEFT)
        self.device_var = tk.StringVar(value="")
        self.device_box = ttk.Entry(settings, textvariable=self.device_var, width=18)
        self.device_box.pack(side=tk.LEFT, padx=6)
        placement = ttk.LabelFrame(right, text="Advanced placement (runtime-supported)", padding=4)
        placement.pack(fill=tk.X, pady=(4, 0))
        ttk.Label(placement, text="GPU layers").pack(side=tk.LEFT)
        self.gpu_layers_var = tk.StringVar()
        self.gpu_layers_entry = ttk.Entry(placement, textvariable=self.gpu_layers_var, width=8)
        self.gpu_layers_entry.pack(side=tk.LEFT, padx=(4, 12))
        ttk.Label(placement, text="Tensor split").pack(side=tk.LEFT)
        self.tensor_split_var = tk.StringVar()
        self.tensor_split_entry = ttk.Entry(placement, textvariable=self.tensor_split_var, width=18)
        self.tensor_split_entry.pack(side=tk.LEFT, padx=4)
        self.backend_box.bind("<<ComboboxSelected>>", lambda _e: self._update_capabilities())
        self.capability_label = ttk.Label(right, text="")
        self.capability_label.pack(anchor="w", pady=4)

        load_settings = ttk.LabelFrame(right, text="Model load settings", padding=4)
        load_settings.pack(fill=tk.X, pady=(0, 4))
        self.context_var = tk.StringVar(value="4096")
        self.threads_var = tk.StringVar()
        self.batch_var = tk.StringVar()
        self._setting_entry(load_settings, "Context", self.context_var, "context_size", 9)
        self._setting_entry(load_settings, "CPU threads", self.threads_var, "threads", 7)
        self._setting_entry(load_settings, "Batch size", self.batch_var, "batch_size", 7)
        self.reasoning_var = tk.BooleanVar(value=False)
        self.reasoning_check = ttk.Checkbutton(load_settings, text="Enable thinking", variable=self.reasoning_var)
        self.reasoning_check.pack(side=tk.LEFT, padx=(4, 10))
        ttk.Label(load_settings, text="Load settings apply on next send; changing them reloads the model.").pack(anchor="w")

        generation = ttk.LabelFrame(right, text="Generation settings", padding=4)
        generation.pack(fill=tk.X, pady=(0, 4))
        self.temperature_var = tk.StringVar(value="0.7")
        self.max_tokens_var = tk.StringVar()
        self._setting_entry(generation, "Temperature", self.temperature_var, "temperature", 8)
        self._setting_entry(generation, "Max response tokens", self.max_tokens_var, "max_tokens", 8)
        ttk.Label(generation, text="System prompt").pack(side=tk.LEFT, padx=(12, 3))
        self.system_prompt_var = tk.StringVar()
        self.system_prompt_entry = ttk.Entry(generation, textvariable=self.system_prompt_var)
        self.system_prompt_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self._settings_widgets["system_prompt"] = self.system_prompt_entry
        ttk.Label(generation, text="Stop strings (one per line)").pack(anchor="w", pady=(4, 0))
        self.stop_strings = tk.Text(generation, height=2, wrap=tk.NONE)
        self.stop_strings.pack(fill=tk.X)
        self._settings_widgets["stop_strings"] = self.stop_strings

        chat_tools = ttk.Frame(right)
        chat_tools.pack(fill=tk.X, pady=(4, 0))
        ttk.Label(chat_tools, text="Conversation").pack(side=tk.LEFT)
        self.session_var = tk.StringVar(value=_session_label(self.chat_session))
        self.session_box = ttk.Combobox(chat_tools, textvariable=self.session_var,
                                        values=[_session_label(item) for item in self.sessions],
                                        state="readonly", width=28)
        self.session_box.pack(side=tk.LEFT, padx=5)
        self.session_box.bind("<<ComboboxSelected>>", self.select_chat)
        ttk.Button(chat_tools, text="New chat", command=self.new_chat).pack(side=tk.LEFT)
        ttk.Button(chat_tools, text="Rename", command=self.rename_chat).pack(side=tk.LEFT, padx=(4, 0))
        ttk.Button(chat_tools, text="Delete", command=self.delete_chat).pack(side=tk.LEFT, padx=(4, 0))
        ttk.Button(chat_tools, text="Export", command=self.export_chat).pack(side=tk.LEFT, padx=(4, 0))
        self.agent_mode_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(chat_tools, text="Read-only agent tools", variable=self.agent_mode_var).pack(side=tk.LEFT, padx=6)
        self.voice_status = ttk.Label(chat_tools, text=self.voice.capabilities.setup_help())
        self.voice_status.pack(side=tk.RIGHT)
        voice_row = ttk.Frame(right)
        voice_row.pack(fill=tk.X)
        ttk.Button(voice_row, text="Speak last answer", command=self.speak_last_answer).pack(side=tk.LEFT)
        self.record_button = ttk.Button(voice_row, text="Record & transcribe", command=self.record_and_transcribe)
        self.record_button.pack(side=tk.LEFT, padx=5)
        self.chat = tk.Text(right, state=tk.DISABLED, wrap=tk.WORD)
        self.chat.pack(fill=tk.BOTH, expand=True, pady=4)
        self._restore_chat()
        prompt_row = ttk.Frame(right)
        prompt_row.pack(fill=tk.X)
        self.prompt = tk.Text(prompt_row, height=4, wrap=tk.WORD)
        self.prompt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.send_button = ttk.Button(prompt_row, text="Load and send", command=self.send)
        self.send_button.pack(side=tk.LEFT, padx=(6, 0), fill=tk.Y)

    def _show_text(self, widget: tk.Text, text: str):
        widget.configure(state=tk.NORMAL)
        widget.delete("1.0", tk.END)
        widget.insert("1.0", text)
        widget.configure(state=tk.DISABLED)

    def _setting_entry(self, parent, label, variable, capability, width):
        ttk.Label(parent, text=label).pack(side=tk.LEFT, padx=(0, 3))
        entry = ttk.Entry(parent, textvariable=variable, width=width)
        entry.pack(side=tk.LEFT, padx=(0, 10))
        self._settings_widgets[capability] = entry

    def refresh(self):
        snapshot = self.hardware.detect().to_dict()
        cpu = snapshot["cpu"]
        ram = snapshot["ram"]
        gpus = snapshot["gpus"]
        lines = [f"CPU: {cpu['name']} ({cpu['logical_cores']} logical cores)",
                 f"RAM: {_gib(ram.get('total_bytes'))} GiB total; {_gib(ram.get('available_bytes'))} GiB available"]
        lines.extend(f"GPU {g['index']}: {g['vendor']} {g['name']} · {_gib(g.get('memory_total_bytes'))} GiB · {', '.join(g.get('backends') or []) or 'backend unknown'}" for g in gpus)
        self._show_text(self.hardware_text, "\n".join(lines))
        self.sources.delete(0, tk.END)
        for source in self.catalog.list_sources():
            self.sources.insert(tk.END, str(source))
        self.models = self.catalog.list_models()
        self.model_list.delete(0, tk.END)
        for model in self.models:
            name = model.metadata.get("general.name") or model.path.rsplit("/", 1)[-1]
            self.model_list.insert(tk.END, f"{name} ({_gib(model.size)} GiB) — {model.path}")
        self._update_capabilities()

    def _update_capabilities(self):
        backend = self.backend_by_name.get(self.backend_var.get())
        if not backend:
            self.capability_label.configure(text="No inference runtime found. Install llama.cpp CLI to run GGUF models.")
            self.reasoning_check.configure(state=tk.DISABLED)
            self.reasoning_var.set(False)
            for name, widget in self._settings_widgets.items():
                widget.configure(state=tk.DISABLED)
                if name == "stop_strings":
                    widget.configure(state=tk.NORMAL)
                    widget.delete("1.0", tk.END)
                    widget.configure(state=tk.DISABLED)
                elif name in ("context_size", "threads", "batch_size", "max_tokens", "system_prompt"):
                    variable_name = {"context_size":"context_var", "threads":"threads_var", "batch_size":"batch_var", "max_tokens":"max_tokens_var", "system_prompt":"system_prompt_var"}[name]
                    getattr(self, variable_name).set("")
            return
        caps = backend.capabilities()
        controls = []
        if caps.gpu_layers:
            controls.append("GPU layers")
        if caps.device_selection:
            controls.append("device selection")
        if caps.tensor_split:
            controls.append("tensor split")
        if caps.reasoning:
            controls.append("reasoning")
        status = f"Executable: {caps.executable or 'not found'}; controls: {', '.join(controls) or 'CPU/default only'}"
        self.device_box.configure(state=tk.NORMAL if caps.device_selection else tk.DISABLED)
        self.gpu_layers_entry.configure(state=tk.NORMAL if caps.gpu_layers else tk.DISABLED)
        self.tensor_split_entry.configure(state=tk.NORMAL if caps.tensor_split else tk.DISABLED)
        if not caps.gpu_layers:
            self.gpu_layers_var.set("")
        if not caps.tensor_split:
            self.tensor_split_var.set("")
        self.reasoning_check.configure(state=tk.NORMAL if caps.reasoning else tk.DISABLED)
        if not caps.reasoning:
            self.reasoning_var.set(False)
        if not caps.device_selection:
            self.device_var.set("")
            status += ". Device selection is not exposed by this runtime."
        else:
            status += ". Device name uses the runtime's naming; it is not inferred from hardware indices."
        self.capability_label.configure(text=status)
        for name, widget in self._settings_widgets.items():
            supported = (bool(getattr(caps, name, False)) if name in ("context_size", "threads", "batch_size")
                         else bool(caps.available))
            widget.configure(state=tk.NORMAL if supported else tk.DISABLED)
            if not supported:
                if name == "stop_strings":
                    widget.configure(state=tk.NORMAL)
                    widget.delete("1.0", tk.END)
                    widget.configure(state=tk.DISABLED)
                elif name in ("context_size", "threads", "batch_size", "max_tokens", "system_prompt"):
                    variable = getattr(self, {"context_size":"context_var", "threads":"threads_var", "batch_size":"batch_var", "max_tokens":"max_tokens_var", "system_prompt":"system_prompt_var"}[name])
                    variable.set("")

    def add_folder(self):
        path = filedialog.askdirectory(title="Add existing model directory")
        if path:
            try:
                self.catalog.add_source(path)
                self.refresh()
            except (OSError, ValueError) as exc:
                messagebox.showerror("Could not add directory", str(exc))

    def scan(self):
        try:
            found = self.catalog.scan()
            self.refresh()
            self._append_chat(f"Found {len(found)} GGUF model(s).")
        except (OSError, ValueError) as exc:
            messagebox.showerror("Scan failed", str(exc))

    def open_hf_downloader(self):
        """Open a non-blocking public Hub search/download window."""
        from aidream.huggingface import DownloadCancelledError, HuggingFaceDownloader

        win = tk.Toplevel(self.root)
        win.title("Download GGUF from Hugging Face")
        win.geometry("720x560")
        service = HuggingFaceDownloader()
        ttk.Label(win, text="Search public Hugging Face model repositories (GGUF)").pack(anchor="w", padx=10, pady=(10, 3))
        search_row = ttk.Frame(win)
        search_row.pack(fill=tk.X, padx=10)
        query = tk.StringVar()
        ttk.Entry(search_row, textvariable=query).pack(side=tk.LEFT, fill=tk.X, expand=True)
        search_button = ttk.Button(search_row, text="Search", command=lambda: search())
        search_button.pack(side=tk.LEFT, padx=(6, 0))
        repos = tk.Listbox(win, height=8, exportselection=False)
        repos.pack(fill=tk.X, padx=10, pady=6)
        ttk.Label(win, text="Repository GGUF files").pack(anchor="w", padx=10)
        files = tk.Listbox(win, height=12, exportselection=False)
        files.pack(fill=tk.BOTH, expand=True, padx=10, pady=4)
        load_files = ttk.Button(win, text="List files", command=lambda: list_files())
        load_files.pack(anchor="w", padx=10)
        destrow = ttk.Frame(win)
        destrow.pack(fill=tk.X, padx=10, pady=(8, 2))
        default_folder = Path.home() / ".local" / "share" / "ai-dream" / "models"
        default_folder.mkdir(parents=True, exist_ok=True)
        destination = tk.StringVar(value=str(default_folder))
        ttk.Label(destrow, text="Download folder").pack(side=tk.LEFT)
        ttk.Entry(destrow, textvariable=destination).pack(side=tk.LEFT, fill=tk.X, expand=True, padx=6)
        ttk.Button(destrow, text="Choose…", command=lambda: choose_dest()).pack(side=tk.LEFT)
        progress = ttk.Progressbar(win, mode="determinate", maximum=100)
        progress.pack(fill=tk.X, padx=10, pady=4)
        status = tk.StringVar(value="Only public repositories are supported. Existing files are never overwritten.")
        ttk.Label(win, textvariable=status, wraplength=690).pack(anchor="w", padx=10, pady=3)
        download_btn = ttk.Button(win, text="Download selected GGUF", command=lambda: download())
        download_btn.pack(anchor="e", padx=10, pady=(2, 10))
        cancel_btn = ttk.Button(win, text="Cancel download", command=lambda: cancel_download(), state=tk.DISABLED)
        cancel_btn.pack(anchor="e", padx=10, pady=(0, 8))
        active_download = {"event": None}
        repo_items = []
        file_items = []

        def choose_dest():
            path = filedialog.askdirectory(title="Choose model download folder", mustexist=True, parent=win)
            if path:
                destination.set(path)

        def busy(value):
            state = tk.DISABLED if value else tk.NORMAL
            search_button.configure(state=state)
            load_files.configure(state=state)
            download_btn.configure(state=state)
            cancel_btn.configure(state=(tk.NORMAL if value and active_download["event"] else tk.DISABLED))

        def cancel_download():
            event = active_download["event"]
            if event:
                status.set("Cancelling download…")
                event.set()

        def search():
            search_text = query.get()
            busy(True)
            status.set("Searching Hugging Face…")
            repos.delete(0, tk.END)
            repo_items.clear()
            def work():
                try:
                    result = service.search(search_text)
                    def done():
                        repo_items.extend(result)
                        for item in result:
                            repos.insert(tk.END, f"{item.repo_id}  ·  {item.downloads:,} downloads")
                        status.set(f"Found {len(result)} public GGUF repositories.")
                        busy(False)
                    win.after(0, done)
                except (OSError, ValueError, RuntimeError) as exc:
                    error = str(exc)
                    win.after(0, lambda error=error: (status.set(error), busy(False)))
            threading.Thread(target=work, daemon=True).start()

        def list_files():
            selection = repos.curselection()
            if not selection:
                messagebox.showinfo("Select a repository", "Choose a repository from the search results.", parent=win)
                return
            repo_id = repo_items[selection[0]].repo_id
            busy(True)
            status.set(f"Listing GGUF files in {repo_id}…")
            files.delete(0, tk.END)
            file_items.clear()
            def work():
                try:
                    result = service.list_gguf_files(repo_id)
                    def done():
                        file_items.extend(result)
                        for name in result:
                            files.insert(tk.END, name)
                        status.set(f"Found {len(result)} GGUF file(s) in {repo_id}.")
                        busy(False)
                    win.after(0, done)
                except (OSError, ValueError, RuntimeError) as exc:
                    error = str(exc)
                    win.after(0, lambda error=error: (status.set(error), busy(False)))
            threading.Thread(target=work, daemon=True).start()

        def download():
            repo_selection, file_selection = repos.curselection(), files.curselection()
            if not repo_selection or not file_selection:
                messagebox.showinfo("Select a model file", "Choose a repository and one GGUF file.", parent=win)
                return
            repo_id = repo_items[repo_selection[0]].repo_id
            file_name = file_items[file_selection[0]]
            folder = Path(destination.get()).expanduser()
            if not folder.is_dir():
                messagebox.showerror("Invalid folder", "Choose an existing download folder.", parent=win)
                return
            progress.configure(value=0, maximum=100, mode="determinate")
            active_download["event"] = threading.Event()
            busy(True)
            status.set(f"Downloading {file_name}…")
            def report(received, total):
                def update():
                    if total:
                        progress.configure(mode="determinate", value=min(100, received * 100 / total))
                        status.set(f"Downloading… {_gib(received)} / {_gib(total)} GiB")
                    else:
                        progress.configure(mode="indeterminate")
                        progress.start(12)
                        status.set(f"Downloaded {_gib(received)} GiB…")
                win.after(0, update)
            def work():
                try:
                    saved = service.download(repo_id, file_name, folder, report,
                                             cancel_event=active_download["event"])
                    def done():
                        progress.stop()
                        progress.configure(mode="determinate", value=100)
                        active_download["event"] = None
                        try:
                            self.catalog.add_source(folder)
                            self.refresh()
                        except (OSError, ValueError):
                            pass
                        status.set(f"Downloaded to {saved}")
                        busy(False)
                    win.after(0, done)
                except DownloadCancelledError:
                    def cancelled():
                        progress.stop()
                        progress.configure(mode="determinate", value=0)
                        active_download["event"] = None
                        status.set("Download cancelled; no partial model was saved.")
                        busy(False)
                    win.after(0, cancelled)
                except (OSError, ValueError, RuntimeError) as exc:
                    def failed():
                        progress.stop()
                        active_download["event"] = None
                        busy(False)
                        status.set(str(exc))
                        messagebox.showerror("Download failed", str(exc), parent=win)
                    win.after(0, failed)
            threading.Thread(target=work, daemon=True).start()

    def _append_chat(self, text: str):
        self.chat.configure(state=tk.NORMAL)
        self.chat.insert(tk.END, text + "\n\n")
        self.chat.see(tk.END)
        self.chat.configure(state=tk.DISABLED)

    def _restore_chat(self):
        self.chat.configure(state=tk.NORMAL)
        self.chat.delete("1.0", tk.END)
        for message in self.chat_session.get("messages", []):
            label = {"user": "You", "assistant": "Assistant", "system": "System"}.get(message.get("role"), "Chat")
            self.chat.insert(tk.END, f"{label}: {message.get('content', '')}\n\n")
        self.chat.configure(state=tk.DISABLED)
        self.chat.see(tk.END)
        self.last_answer = next((m["content"] for m in reversed(self.chat_session.get("messages", []))
                                 if m.get("role") == "assistant"), "")

    def _refresh_sessions(self):
        self.sessions = self.chat_store.list_sessions()
        self.session_box.configure(values=[_session_label(item) for item in self.sessions])
        self.session_var.set(_session_label(self.chat_session))

    def new_chat(self):
        self.chat_session = self.chat_store.create()
        self._refresh_sessions()
        self._restore_chat()
        self._unload_current()

    def select_chat(self, _event=None):
        label = self.session_var.get()
        match = next((item for item in self.chat_store.list_sessions() if _session_label(item) == label), None)
        if match:
            self.chat_session = self.chat_store.load(match["id"])
            self._restore_chat()
            self._unload_current()

    def rename_chat(self):
        from tkinter import simpledialog
        title = simpledialog.askstring("Rename conversation", "Conversation name:",
                                       initialvalue=self.chat_session.get("title", ""), parent=self.root)
        if title is None:
            return
        try:
            self.chat_session = self.chat_store.rename(self.chat_session["id"], title)
            self._refresh_sessions()
        except (OSError, ValueError) as exc:
            messagebox.showerror("Rename failed", str(exc), parent=self.root)

    def delete_chat(self):
        if not messagebox.askyesno("Delete conversation", "Delete this conversation and its local history?",
                                   parent=self.root):
            return
        try:
            self.chat_store.delete(self.chat_session["id"])
            sessions = self.chat_store.list_sessions()
            self.chat_session = self.chat_store.load(sessions[0]["id"]) if sessions else self.chat_store.create()
            self._refresh_sessions()
            self._restore_chat()
            self._unload_current()
        except (OSError, ValueError) as exc:
            messagebox.showerror("Delete failed", str(exc), parent=self.root)

    def export_chat(self):
        target = filedialog.asksaveasfilename(title="Export conversation", defaultextension=".md",
                                              filetypes=[("Markdown", "*.md"), ("All files", "*.*")],
                                              initialfile=f"{self.chat_session.get('title', 'chat')}.md")
        if not target:
            return
        try:
            result = self.chat_store.export(self.chat_session["id"], target)
            self.voice_status.configure(text=f"Exported: {result}")
        except (OSError, ValueError) as exc:
            messagebox.showerror("Export failed", str(exc), parent=self.root)

    def speak_last_answer(self):
        if not self.last_answer:
            messagebox.showinfo("No answer", "There is no assistant answer to speak yet.")
            return
        try:
            self.voice.speak(self.last_answer)
        except (OSError, RuntimeError, ValueError) as exc:
            messagebox.showerror("Voice output unavailable", str(exc))

    def record_and_transcribe(self):
        if self._voice_busy:
            return
        if not self.voice.capabilities.recording:
            messagebox.showinfo("Voice input unavailable", self.voice.capabilities.setup_help(), parent=self.root)
            return
        model = filedialog.askopenfilename(title="Choose whisper.cpp model",
                                           filetypes=[("Whisper model", "*.bin"), ("All files", "*.*")])
        if not model:
            return
        self._voice_busy = True
        self.record_button.configure(state=tk.DISABLED)
        self.voice_status.configure(text="Recording 5 seconds…")

        def work():
            audio = None
            try:
                handle = tempfile.NamedTemporaryFile(prefix="ai-dream-mic-", suffix=".wav", delete=False)
                audio = Path(handle.name)
                handle.close()
                audio.unlink(missing_ok=True)
                self.voice.record(audio, seconds=5)
                self._voice_results.put(("status", "Transcribing…"))
                text = self.voice.transcribe(audio, model)
                self._voice_results.put(("success", text))
            except (OSError, RuntimeError, ValueError) as exc:
                self._voice_results.put(("error", str(exc)))
            finally:
                if audio:
                    audio.unlink(missing_ok=True)

        threading.Thread(target=work, name="ai-dream-voice-input", daemon=True).start()

    def _poll_voice_results(self):
        try:
            while True:
                kind, value = self._voice_results.get_nowait()
                if kind == "status":
                    self.voice_status.configure(text=value)
                else:
                    self._voice_busy = False
                    self.record_button.configure(state=tk.NORMAL)
                    if kind == "success":
                        self.prompt.delete("1.0", tk.END)
                        self.prompt.insert("1.0", value)
                        self.voice_status.configure(text="Transcription ready")
                    else:
                        self.voice_status.configure(text="Voice input failed")
                        messagebox.showerror("Voice input failed", value, parent=self.root)
        except queue.Empty:
            pass
        if self.root.winfo_exists():
            self.root.after(100, self._poll_voice_results)

    def send(self):
        selected = self.model_list.curselection()
        if not selected:
            messagebox.showinfo("Select a model", "Choose a GGUF model first.")
            return
        backend = self.backend_by_name.get(self.backend_var.get())
        if not backend or not backend.capabilities().available:
            messagebox.showerror("Runtime unavailable", "Install a usable llama.cpp CLI and check 'app backends'.")
            return
        prompt = self.prompt.get("1.0", tk.END).strip()
        if not prompt:
            return
        model = self.models[selected[0]]
        device = self.device_var.get().strip()
        placement = {}
        if device:
            placement["device"] = device
        gpu_layers = self.gpu_layers_var.get().strip()
        if gpu_layers:
            try:
                placement["gpu_layers"] = int(gpu_layers)
            except ValueError:
                messagebox.showerror("Invalid GPU layers", "Enter a whole number of GPU layers.")
                return
        tensor_split = self.tensor_split_var.get().strip()
        if tensor_split:
            placement["tensor_split"] = tensor_split
        placement = placement or None
        caps = backend.capabilities()
        load_options = {}
        for key, var in (("context_size", self.context_var), ("threads", self.threads_var), ("batch_size", self.batch_var)):
            value = var.get().strip()
            if value and getattr(caps, key, False):
                try:
                    load_options[key] = int(value)
                    if load_options[key] < 1:
                        raise ValueError
                except ValueError:
                    messagebox.showerror("Invalid setting", f"{key.replace('_', ' ').title()} must be a positive whole number.")
                    return
        if caps.reasoning:
            load_options["reasoning"] = self.reasoning_var.get()
        generation_options = {}
        if caps.available:
            try:
                generation_options["temperature"] = float(self.temperature_var.get().strip())
                if generation_options["temperature"] < 0:
                    raise ValueError
            except ValueError:
                messagebox.showerror("Invalid temperature", "Temperature must be a non-negative number.")
                return
        if caps.available and self.max_tokens_var.get().strip():
            try:
                generation_options["max_tokens"] = int(self.max_tokens_var.get().strip())
                if generation_options["max_tokens"] < 1:
                    raise ValueError
            except ValueError:
                messagebox.showerror("Invalid response length", "Maximum response tokens must be a positive whole number.")
                return
        if caps.available and self.system_prompt_var.get().strip():
            generation_options["system_prompt"] = self.system_prompt_var.get().strip()
        if caps.available:
            stops = [line.strip() for line in self.stop_strings.get("1.0", tk.END).splitlines() if line.strip()]
            if stops:
                generation_options["stop"] = stops
        try:
            if not backend.can_load(model):
                raise RuntimeError(f"{backend.name} cannot load this model.")
            placement_key = tuple(sorted((key, str(value)) for key, value in (placement or {}).items()))
            model_key = getattr(model, "id", model.path)
            requested_key = (id(backend), model_key, placement_key, tuple(sorted(load_options.items())))
            if self.loaded_key != requested_key:
                self._unload_current()
                backend.load(model, placement, options=load_options)
                self.loaded_backend = backend
                self.loaded_key = requested_key
                if hasattr(backend, "restore_history"):
                    history = [message for message in self.chat_session.get("messages", [])
                               if message.get("role") in ("user", "assistant")]
                    backend.restore_history(history)
                self._append_chat(f"Loaded {model.path} with {backend.name}.")
            agent_note = None
            if self.agent_mode_var.get():
                from aidream.agent import LocalAgent
                prior = [message for message in self.chat_session.get("messages", [])
                         if message.get("role") in ("user", "assistant")]
                result = LocalAgent(backend).run(prompt, history=prior)
                answer = result.text
                support = "supported" if result.tool_calls_supported else "not supported by this model/runtime"
                summaries = result.summary()["tools"]
                details = "; ".join(
                    f"{item['name']} [{item['status']}]: {item['result_snippet']}"
                    for item in summaries
                ) or "none"
                agent_note = (f"Read-only agent ({support}; {result.elapsed_seconds:.1f}s; "
                              f"{result.stop_reason}). Tools: {details}")[:1800]
            else:
                answer = backend.generate(prompt, options=generation_options)
            self.chat_session = self.chat_store.append(self.chat_session["id"], "user", prompt)
            if agent_note:
                self.chat_session = self.chat_store.append(self.chat_session["id"], "system", agent_note)
            self.chat_session = self.chat_store.append(self.chat_session["id"], "assistant", answer)
            if agent_note and hasattr(backend, "restore_history"):
                history = [message for message in self.chat_session.get("messages", [])
                           if message.get("role") in ("user", "assistant")]
                backend.restore_history(history)
            self.last_answer = answer
            self._refresh_sessions()
            self._restore_chat()
        except (OSError, ValueError, RuntimeError) as exc:
            self._unload_current()
            messagebox.showerror("Generation failed", str(exc))
        finally:
            self.prompt.delete("1.0", tk.END)

    def _unload_current(self):
        backend, self.loaded_backend = self.loaded_backend, None
        self.loaded_key = None
        if backend:
            backend.unload()

    def close(self):
        self._unload_current()
        self.root.destroy()


def _session_label(session):
    title = session.get("title", "Chat")
    updated = session.get("updated_at", "")
    return f"{title} · {updated[11:16]}" if updated else title


def _gib(n):
    return "unknown" if n is None else f"{n / (1024 ** 3):.1f}"


def main() -> None:
    root = tk.Tk()
    AIDreamWindow(root)
    root.mainloop()


if __name__ == "__main__":
    main()
