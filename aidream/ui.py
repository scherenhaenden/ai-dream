"""Small Tk GUI over the same catalog, hardware, and runtime services as the CLI."""

from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import threading
import queue
import tempfile
import shlex
from pathlib import Path


class AIDreamWindow:
    def __init__(self, root: tk.Tk):
        from aidream.hardware import HardwareService
        from aidream.models import ModelCatalog
        from aidream.runtime import RuntimeRegistry

        from aidream.conversation import ChatStore
        from aidream.model_profiles import ModelProfileStore
        from aidream.voice import LocalVoice

        self.root = root
        self._configure_theme()
        self.chat_store = ChatStore()
        self.voice = LocalVoice()
        self._speech_worker = None
        self._voice_results = queue.Queue()
        self._voice_busy = False
        self._generation_results = queue.Queue()
        self._generation_event = None
        self._generation_busy = False
        self._pending_generation = None
        self._generation_controls = []
        self._pending_images = []
        self._pending_documents = []
        self._closing = False
        sessions = self.chat_store.list_sessions()
        self.sessions = sessions
        self.chat_session = sessions[0] if sessions else self.chat_store.create()
        self.last_answer = ""
        self.root.title("AI Dream")
        self.root.geometry("1320x900")
        self.root.minsize(1080, 700)
        self.catalog = ModelCatalog()
        self.hardware = HardwareService()
        self.profile_store = ModelProfileStore()
        self._active_model_profile = None
        self.registry = RuntimeRegistry()
        self.models = []
        self._all_models = []
        self.backends = self.registry.list_backends()
        self.backend_by_name = {b.name: b for b in self.backends}
        self.loaded_backend = None
        self.loaded_key = None
        self._runtime_action_busy = False
        self._settings_widgets = {}
        self._build()
        self.root.after(100, self._poll_voice_results)
        self.root.after(40, self._poll_generation_results)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.refresh()
        self._apply_session_settings(self.chat_session)

    def _configure_theme(self):
        """Use a consistent dark palette on supported Tk themes."""
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        bg, panel, fg, muted, accent = "#171b24", "#202633", "#e7ebf2", "#a7b1c2", "#4d78bd"
        self.root.configure(background=bg)
        style.configure(".", background=bg, foreground=fg, fieldbackground=panel,
                        insertcolor=fg, bordercolor="#394354", lightcolor="#394354",
                        darkcolor=bg, troughcolor=panel, focuscolor=accent)
        style.configure("TFrame", background=bg)
        style.configure("TLabelframe", background=bg, bordercolor="#394354")
        style.configure("TLabelframe.Label", background=bg, foreground=fg)
        style.configure("TLabel", background=bg, foreground=fg)
        style.configure("TButton", background=panel, foreground=fg, padding=(8, 5))
        style.map("TButton", background=[("active", "#2c3749"), ("disabled", bg)])
        style.configure("TEntry", fieldbackground=panel, foreground=fg, insertcolor=fg)
        style.configure("TCombobox", fieldbackground=panel, foreground=fg, arrowcolor=fg)
        style.map("TCombobox", fieldbackground=[("readonly", panel)], foreground=[("readonly", fg)])
        style.configure("TCheckbutton", background=bg, foreground=fg)
        style.configure("TNotebook", background=bg, borderwidth=0)
        style.configure("TNotebook.Tab", background=panel, foreground=muted, padding=(12, 7))
        style.map("TNotebook.Tab", background=[("selected", accent)], foreground=[("selected", "white")])

    def _build(self):
        root = self.root
        pane = ttk.Panedwindow(root, orient=tk.HORIZONTAL)
        pane.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        left = ttk.Frame(pane, padding=8)
        pane.add(left, weight=1)
        ttk.Label(left, text="Hardware").pack(anchor="w")
        self.hardware_text = tk.Text(left, height=6, width=38, state=tk.DISABLED, wrap=tk.WORD,
                                     background="#202633", foreground="#e7ebf2",
                                     insertbackground="#e7ebf2", relief=tk.FLAT)
        self.hardware_text.pack(fill=tk.X, pady=(2, 8))
        ttk.Label(left, text="Model directories").pack(anchor="w")
        self.sources = tk.Listbox(left, height=5, exportselection=False, background="#202633",
                                  foreground="#e7ebf2", selectbackground="#4d78bd",
                                  selectforeground="white", relief=tk.FLAT)
        self.sources.pack(fill=tk.X, pady=2)
        row = ttk.Frame(left)
        row.pack(fill=tk.X)
        ttk.Button(row, text="Add folder", command=self.add_folder).pack(side=tk.LEFT)
        ttk.Button(row, text="Scan", command=self.scan).pack(side=tk.LEFT, padx=4)
        ttk.Button(left, text="Download from Hugging Face", command=self.open_hf_downloader).pack(anchor="w", pady=(2, 4))
        ttk.Label(left, text="GGUF models").pack(anchor="w", pady=(8, 0))
        model_filter = ttk.Frame(left)
        model_filter.pack(fill=tk.X)
        ttk.Label(model_filter, text="Filter").pack(side=tk.LEFT)
        self.model_filter_var = tk.StringVar()
        self.model_filter_entry = ttk.Entry(model_filter, textvariable=self.model_filter_var)
        self.model_filter_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=4)
        self.model_filter_var.trace_add("write", lambda *_args: self._populate_model_list())
        self.model_sort_var = tk.StringVar(value="Name A–Z")
        self.model_sort_box = ttk.Combobox(model_filter, textvariable=self.model_sort_var,
                                           values=("Name A–Z", "Largest first", "Smallest first"),
                                           state="readonly", width=15)
        self.model_sort_box.pack(side=tk.RIGHT)
        self.model_sort_box.bind("<<ComboboxSelected>>", lambda _event: self._populate_model_list())
        self.model_list = tk.Listbox(left, height=14, exportselection=False, background="#202633",
                                     foreground="#e7ebf2", selectbackground="#4d78bd",
                                     selectforeground="white", relief=tk.FLAT)
        self.model_list.pack(fill=tk.BOTH, expand=True, pady=2)
        self.model_list.bind("<<ListboxSelect>>", self.show_model_details)
        self.model_details = ttk.Label(left, text="Select a model to inspect its metadata.",
                                       wraplength=340, justify=tk.LEFT)
        self.model_details.pack(fill=tk.X, anchor="w", pady=(3, 0))

        right = ttk.Frame(pane, padding=8)
        pane.add(right, weight=2)
        config_tabs = ttk.Notebook(right)
        config_tabs.pack(fill=tk.X, expand=False, anchor="nw")
        self.config_tabs = config_tabs
        runtime_tab = ttk.Frame(config_tabs, padding=10)
        generation = ttk.Frame(config_tabs, padding=10)
        config_tabs.add(runtime_tab, text="Model & runtime")
        config_tabs.add(generation, text="Generation")

        placement = ttk.LabelFrame(runtime_tab, text="Runtime and placement", padding=10)
        placement.pack(fill=tk.X, pady=(0, 8))
        for col in range(4):
            placement.columnconfigure(col, weight=1)
        ttk.Label(placement, text="Backend").grid(row=0, column=0, sticky="w", padx=(0, 6), pady=4)
        names = [b.name for b in self.backends]
        self.backend_var = tk.StringVar(value=names[0] if names else "")
        self.backend_box = ttk.Combobox(placement, textvariable=self.backend_var, values=names, state="readonly")
        self.backend_box.grid(row=0, column=1, sticky="ew", padx=(0, 16), pady=4)
        ttk.Label(placement, text="Runtime device").grid(row=0, column=2, sticky="w", padx=(0, 6), pady=4)
        self.device_var = tk.StringVar(value="")
        self.device_box = ttk.Combobox(placement, textvariable=self.device_var, values=("",), state="readonly")
        self.device_box.grid(row=0, column=3, sticky="ew", pady=4)
        self.backend_box.bind("<<ComboboxSelected>>", lambda _e: self._update_capabilities())
        ttk.Label(placement, text="GPU layers").grid(row=1, column=0, sticky="w", pady=4)
        self.gpu_layers_var = tk.StringVar()
        self.gpu_layers_entry = ttk.Entry(placement, textvariable=self.gpu_layers_var)
        self.gpu_layers_entry.grid(row=1, column=1, sticky="ew", padx=(0, 16), pady=4)
        ttk.Label(placement, text="Tensor split").grid(row=1, column=2, sticky="w", pady=4)
        self.tensor_split_var = tk.StringVar()
        self.tensor_split_entry = ttk.Entry(placement, textvariable=self.tensor_split_var)
        self.tensor_split_entry.grid(row=1, column=3, sticky="ew", pady=4)
        ttk.Label(placement, text="Split mode").grid(row=2, column=0, sticky="w", pady=4)
        self.split_mode_var = tk.StringVar(value="layer")
        self.split_mode_box = ttk.Entry(placement, textvariable=self.split_mode_var)
        self.split_mode_box.grid(row=2, column=1, sticky="ew", padx=(0, 16), pady=4)
        ttk.Label(placement, text="Main GPU").grid(row=2, column=2, sticky="w", pady=4)
        self.main_gpu_var = tk.StringVar()
        self.main_gpu_entry = ttk.Entry(placement, textvariable=self.main_gpu_var)
        self.main_gpu_entry.grid(row=2, column=3, sticky="ew", pady=4)
        self.manual_device_var = tk.BooleanVar(value=False)
        self.manual_device_check = ttk.Checkbutton(placement, text="Manual device override",
                                                    variable=self.manual_device_var,
                                                    command=self._update_capabilities)
        self.manual_device_check.grid(row=3, column=0, columnspan=2, sticky="w", pady=(5, 0))
        self.capability_label = ttk.Label(runtime_tab, text="", wraplength=700, foreground="#a7b1c2")
        self.capability_label.pack(anchor="w", pady=(0, 8))

        load_settings = ttk.LabelFrame(runtime_tab, text="Selected model load profile", padding=10)
        load_settings.pack(fill=tk.X)
        for col in range(3):
            load_settings.columnconfigure(col, weight=1)
        self.context_var = tk.StringVar(value="4096")
        self.threads_var = tk.StringVar()
        self.batch_var = tk.StringVar()
        self.physical_batch_var = tk.StringVar()
        self.max_concurrent_var = tk.StringVar()
        for row, (label, variable, key) in enumerate((
            ("Context size", self.context_var, "context_size"), ("CPU threads", self.threads_var, "threads"),
            ("Batch size", self.batch_var, "batch_size"), ("Physical batch size", self.physical_batch_var, "physical_batch_size"),
            ("Max concurrent", self.max_concurrent_var, "max_concurrent"))):
            self._setting_grid_entry(load_settings, label, variable, key, row // 3, row % 3)
        self._advanced_load_vars = {}
        for index, (key, label) in enumerate((("flash_attention", "Flash attention"),
                           ("unified_kv_cache", "Unified KV cache"),
                           ("offload_kv_cache", "Offload KV cache"), ("mmap", "Memory map"),
                           ("keep_model_in_memory", "Keep model in memory"), ("fit", "Fit memory"))):
            variable = tk.BooleanVar(value=False)
            self._advanced_load_vars[key] = variable
            check = ttk.Checkbutton(load_settings, text=label, variable=variable)
            check.grid(row=2 + index // 3, column=index % 3, sticky="w", pady=4)
            self._settings_widgets[key] = check
        self._settings_widgets["split_mode"] = self.split_mode_box
        self._settings_widgets["main_gpu"] = self.main_gpu_entry
        ttk.Label(load_settings, text="These options belong to the selected model and apply on load/reload.",
                  foreground="#a7b1c2").grid(row=4, column=0, columnspan=3, sticky="w", pady=(6, 0))
        self.model_profile_status = ttk.Label(load_settings, text="Select a model to load its saved profile.",
                                              foreground="#a7b1c2")
        self.model_profile_status.grid(row=5, column=0, columnspan=3, sticky="w", pady=(3, 0))

        runtime_actions = ttk.Frame(right)
        runtime_actions.pack(fill=tk.X, pady=(6, 8))
        runtime_actions.columnconfigure(4, weight=1)
        for column, (label, command) in enumerate((
            ("Load selected model", self.load_selected_model), ("Unload", self.unload_model),
            ("Reload", self.reload_model), ("Runtime status", self.show_runtime_status))):
            ttk.Button(runtime_actions, text=label, command=command).grid(
                row=0, column=column, sticky="w", padx=(0, 5), pady=2)
        ttk.Button(runtime_actions, text="Effective command", command=self.show_effective_command).grid(
            row=1, column=0, columnspan=2, sticky="w", padx=(0, 5), pady=2)
        ttk.Button(runtime_actions, text="Save model profile", command=self._save_selected_model_profile).grid(
            row=1, column=4, sticky="e", pady=2)

        generation_box = ttk.LabelFrame(generation, text="Conversation generation defaults", padding=10)
        generation_box.pack(fill=tk.X)
        for col in range(2):
            generation_box.columnconfigure(col, weight=1)
        self.temperature_var = tk.StringVar(value="0.7")
        self.max_tokens_var = tk.StringVar()
        self._setting_grid_entry(generation_box, "Temperature", self.temperature_var, "temperature", 0, 0)
        self._setting_grid_entry(generation_box, "Max response tokens", self.max_tokens_var, "max_tokens", 0, 1)
        ttk.Label(generation_box, text="System prompt").grid(row=1, column=0, sticky="w", pady=(10, 3))
        self.system_prompt_var = tk.StringVar()
        self.system_prompt_entry = ttk.Entry(generation_box, textvariable=self.system_prompt_var)
        self.system_prompt_entry.grid(row=1, column=1, sticky="ew", pady=(10, 3))
        self._settings_widgets["system_prompt"] = self.system_prompt_entry
        ttk.Label(generation_box, text="Stop strings (one per line)").grid(row=2, column=0, columnspan=2, sticky="w", pady=(10, 3))
        self.stop_strings = tk.Text(generation_box, height=3, wrap=tk.NONE, background="#202633",
                                    foreground="#e7ebf2", insertbackground="#e7ebf2", relief=tk.FLAT)
        self.stop_strings.grid(row=3, column=0, columnspan=2, sticky="ew")
        self._settings_widgets["stop_strings"] = self.stop_strings
        self.reasoning_var = tk.BooleanVar(value=False)
        self.reasoning_check = ttk.Checkbutton(generation_box, text="Enable thinking", variable=self.reasoning_var)
        self.reasoning_check.grid(row=4, column=0, sticky="w", pady=(8, 0))

        chat_tools = ttk.Frame(right)
        chat_tools.pack(fill=tk.X, pady=(4, 0))
        chat_tools.columnconfigure(1, weight=1)
        ttk.Label(chat_tools, text="Conversation").grid(row=0, column=0, sticky="w", padx=(0, 6), pady=2)
        self.session_var = tk.StringVar(value=_session_label(self.chat_session))
        self.session_box = ttk.Combobox(chat_tools, textvariable=self.session_var,
                                        values=[_session_label(item) for item in self.sessions],
                                        state="readonly", width=20)
        self.session_box.grid(row=0, column=1, sticky="ew", padx=(0, 6), pady=2)
        self.session_box.bind("<<ComboboxSelected>>", self.select_chat)
        self._generation_controls = [self.session_box, self.model_list, self.backend_box]
        for column, (label, command) in enumerate((("New chat", self.new_chat), ("Rename", self.rename_chat),
                                                   ("Delete", self.delete_chat)), start=2):
            button = ttk.Button(chat_tools, text=label, command=command)
            button.grid(row=0, column=column, sticky="ew", padx=(0, 4), pady=2)
            self._generation_controls.append(button)
        for column, (label, command) in enumerate((("Export", self.export_chat), ("Presets", self.open_preset_manager))):
            button = ttk.Button(chat_tools, text=label, command=command)
            button.grid(row=1, column=column, sticky="w", padx=(0, 4), pady=2)
            self._generation_controls.append(button)
        self.agent_mode_var = tk.BooleanVar(value=False)
        agent_check = ttk.Checkbutton(chat_tools, text="Read-only agent tools", variable=self.agent_mode_var)
        agent_check.grid(row=1, column=2, columnspan=3, sticky="w", pady=2)
        self._generation_controls.append(agent_check)
        self.voice_status = ttk.Label(chat_tools, text=self.voice.capabilities.setup_help(),
                                       wraplength=560, foreground="#a7b1c2")
        self.voice_status.grid(row=2, column=0, columnspan=5, sticky="ew", pady=(2, 4))
        voice_row = ttk.Frame(right)
        voice_row.pack(fill=tk.X)
        ttk.Button(voice_row, text="Speak last answer", command=self.speak_last_answer).grid(row=0, column=0, sticky="w", padx=(0, 4), pady=2)
        self.stop_speech_button = ttk.Button(voice_row, text="Stop speaking", command=self.stop_speaking,
                                             state=tk.DISABLED)
        self.stop_speech_button.grid(row=0, column=1, sticky="w", padx=(0, 4), pady=2)
        self.record_button = ttk.Button(voice_row, text="Record & transcribe", command=self.record_and_transcribe)
        self.record_button.grid(row=0, column=2, sticky="w", padx=(0, 4), pady=2)
        self.attach_images_button = ttk.Button(voice_row, text="Attach image(s)", command=self.attach_images)
        self.attach_images_button.grid(row=1, column=0, sticky="w", padx=(0, 4), pady=2)
        self.attach_documents_button = ttk.Button(voice_row, text="Attach document(s)", command=self.attach_documents)
        self.attach_documents_button.grid(row=1, column=1, sticky="w", padx=(0, 4), pady=2)
        self.clear_images_button = ttk.Button(voice_row, text="Clear images", command=self.clear_images, state=tk.DISABLED)
        self.clear_images_button.grid(row=1, column=2, sticky="w", padx=(0, 4), pady=2)
        self.clear_documents_button = ttk.Button(voice_row, text="Clear documents", command=self.clear_documents,
                                                 state=tk.DISABLED)
        self.clear_documents_button.grid(row=1, column=3, sticky="w", padx=(0, 4), pady=2)
        self._generation_controls.extend([self.attach_images_button, self.attach_documents_button,
                                          self.clear_images_button, self.clear_documents_button])
        self.images_status = ttk.Label(voice_row, text="", wraplength=300, foreground="#a7b1c2")
        self.images_status.grid(row=2, column=0, columnspan=2, sticky="w", padx=(0, 8), pady=2)
        self.documents_status = ttk.Label(voice_row, text="", wraplength=300, foreground="#a7b1c2")
        self.documents_status.grid(row=2, column=2, columnspan=2, sticky="w", pady=2)
        voice_input_row = ttk.Frame(right)
        voice_input_row.pack(fill=tk.X)
        voice_input_row.columnconfigure(1, weight=1)
        ttk.Label(voice_input_row, text="Whisper model").grid(row=0, column=0, sticky="w", padx=(0, 6), pady=2)
        voice_configuration = self.voice.configuration()
        self.whisper_model_var = tk.StringVar(value="")
        self.whisper_model_box = ttk.Combobox(voice_input_row, textvariable=self.whisper_model_var,
                                              values=[str(path) for path in voice_configuration.whisper_models],
                                              state="readonly", width=24)
        if voice_configuration.whisper_models:
            self.whisper_model_var.set(str(voice_configuration.whisper_models[0]))
        self.whisper_model_box.grid(row=0, column=1, sticky="ew", padx=(0, 5), pady=2)
        ttk.Button(voice_input_row, text="Browse…", command=self.choose_whisper_model).grid(row=0, column=2, sticky="w", pady=2)
        ttk.Label(voice_input_row, text="Record seconds").grid(row=1, column=0, sticky="w", padx=(0, 6), pady=2)
        self.record_seconds_var = tk.StringVar(value="5")
        ttk.Spinbox(voice_input_row, from_=1, to=120, textvariable=self.record_seconds_var,
                    width=5).grid(row=1, column=1, sticky="w", pady=2)
        self.transcribe_audio_button = ttk.Button(voice_input_row, text="Transcribe audio file…",
                                                  command=self.transcribe_audio_file)
        self.transcribe_audio_button.grid(row=1, column=2, sticky="w", padx=(6, 0), pady=2)
        ptt_row = ttk.Frame(right)
        ptt_row.pack(fill=tk.X, pady=(2, 0))
        self.push_to_talk_button = ttk.Button(ptt_row, text="Hold to talk")
        self.push_to_talk_button.pack(side=tk.LEFT)
        self.push_to_talk_button.bind("<ButtonPress-1>", self._push_to_talk_down, add="+")
        self.push_to_talk_button.bind("<ButtonRelease-1>", self._push_to_talk_up, add="+")
        self.push_to_talk_button.bind("<KeyPress-space>", self._push_to_talk_down, add="+")
        self.push_to_talk_button.bind("<KeyRelease-space>", self._push_to_talk_up, add="+")
        self.ptt_help = ttk.Label(ptt_row, text="Press and hold; release to insert transcription. Local only.",
                                  wraplength=560, foreground="#a7b1c2")
        self.ptt_help.pack(side=tk.LEFT, padx=8, fill=tk.X, expand=True, anchor="w")
        self._ptt_worker = None
        self._ptt_model = None
        self._ptt_path = None
        chat_frame = ttk.Frame(right)
        chat_frame.pack(fill=tk.BOTH, expand=True, pady=4)
        self.chat = tk.Text(chat_frame, height=8, state=tk.DISABLED, wrap=tk.WORD, background="#202633",
                            foreground="#e7ebf2", insertbackground="#e7ebf2", relief=tk.FLAT)
        self.chat.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        chat_scroll = ttk.Scrollbar(chat_frame, orient=tk.VERTICAL, command=self.chat.yview)
        chat_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.chat.configure(yscrollcommand=chat_scroll.set)
        self._restore_chat()
        prompt_row = ttk.Frame(right)
        prompt_row.pack(fill=tk.X)
        self.prompt = tk.Text(prompt_row, height=3, wrap=tk.WORD, background="#202633",
                              foreground="#e7ebf2", insertbackground="#e7ebf2", relief=tk.FLAT)
        self.prompt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.prompt.bind("<Control-Return>", self._send_shortcut)
        self.send_button = ttk.Button(prompt_row, text="Load and send", command=self.send)
        self.send_button.pack(side=tk.LEFT, padx=(6, 0), fill=tk.Y)
        self.stop_button = ttk.Button(prompt_row, text="Stop", command=self.stop_generation, state=tk.DISABLED)
        self.stop_button.pack(side=tk.LEFT, padx=(4, 0), fill=tk.Y)
        right.bind("<Configure>", self._resize_right_panel, add="+")

    def _resize_right_panel(self, event):
        """Keep wrapped helper/status text inside the resizable chat column."""
        wrap = max(240, event.width - 72)
        for widget in (getattr(self, "capability_label", None), getattr(self, "voice_status", None),
                       getattr(self, "model_profile_status", None), getattr(self, "ptt_help", None)):
            if widget is not None:
                widget.configure(wraplength=wrap)
        for widget in (getattr(self, "images_status", None), getattr(self, "documents_status", None)):
            if widget is not None:
                widget.configure(wraplength=max(160, (event.width - 80) // 2))

    def _show_text(self, widget: tk.Text, text: str):
        widget.configure(state=tk.NORMAL)
        widget.delete("1.0", tk.END)
        widget.insert("1.0", text)
        widget.configure(state=tk.DISABLED)

    def _send_shortcut(self, _event=None):
        self.send()
        return "break"

    def _setting_entry(self, parent, label, variable, capability, width):
        ttk.Label(parent, text=label).pack(side=tk.LEFT, padx=(0, 3))
        entry = ttk.Entry(parent, textvariable=variable, width=width)
        entry.pack(side=tk.LEFT, padx=(0, 10))
        self._settings_widgets[capability] = entry

    def _setting_grid_entry(self, parent, label, variable, capability, row, column):
        field = ttk.Frame(parent)
        field.grid(row=row, column=column, sticky="ew", padx=(0, 14), pady=4)
        field.columnconfigure(0, weight=1)
        ttk.Label(field, text=label).grid(row=0, column=0, sticky="w", pady=(0, 3))
        entry = ttk.Entry(field, textvariable=variable)
        entry.grid(row=1, column=0, sticky="ew")
        self._settings_widgets[capability] = entry
        return entry

    def _selected_runtime_configuration(self):
        backend = self.backend_by_name.get(self.backend_var.get())
        selected = self.model_list.curselection()
        if not backend:
            raise ValueError("Choose an available runtime.")
        if not selected or selected[0] >= len(self.models):
            raise ValueError("Select a model from the catalog first.")
        model = self.models[selected[0]]
        placement = {}
        if self.device_var.get().strip():
            placement["device"] = self.device_var.get().strip()
        if self.gpu_layers_var.get().strip():
            placement["gpu_layers"] = int(self.gpu_layers_var.get().strip())
        if self.tensor_split_var.get().strip():
            placement["tensor_split"] = self.tensor_split_var.get().strip()
        if self.split_mode_var.get().strip():
            placement["split_mode"] = self.split_mode_var.get().strip()
        if self.main_gpu_var.get().strip():
            placement["main_gpu"] = int(self.main_gpu_var.get().strip())
        caps = backend.capabilities()
        options = {}
        for key, variable in (("context_size", self.context_var), ("threads", self.threads_var),
                              ("batch_size", self.batch_var)):
            value = variable.get().strip()
            if value and getattr(caps, key, False):
                options[key] = int(value)
        for key, variable in (("physical_batch_size", self.physical_batch_var),
                              ("max_concurrent", self.max_concurrent_var)):
            value = variable.get().strip()
            if value and getattr(caps, key, False):
                options[key] = int(value)
        for key, variable in self._advanced_load_vars.items():
            if getattr(caps, key, False):
                options[key] = variable.get()
        if caps.reasoning:
            options["reasoning"] = self.reasoning_var.get()
        validate = getattr(backend, "validate_load", None)
        if validate:
            validate(model, placement or None, options)
        return backend, model, placement or None, options

    def load_selected_model(self):
        if self._generation_busy:
            self.voice_status.configure(text="Stop the current generation before changing the loaded model.")
            return
        try:
            backend, model, placement, options = self._selected_runtime_configuration()
            if not backend.can_load(model):
                raise ValueError(f"{backend.name} cannot load this model.")
            self._save_current_chat_settings()
        except (ValueError, TypeError, OSError, RuntimeError) as exc:
            messagebox.showerror("Model configuration unavailable", str(exc), parent=self.root)
            return
        self._start_model_load(backend, model, placement, options)

    def _start_model_load(self, backend, model, placement, options):
        """Run one load/reload transaction off the Tk thread.

        A reload is a single ordered operation. Keeping unload and load in the
        same worker prevents the old implementation's timer-based race where
        the new server could start before the previous server had stopped.
        """
        if self._runtime_action_busy:
            self.voice_status.configure(text="A runtime action is already in progress.")
            return
        self._runtime_action_busy = True
        self.voice_status.configure(text=f"Loading {model.path}…")

        def work():
            try:
                previous = self.loaded_backend
                if previous is not None and previous is not backend:
                    previous.unload()
                # LlamaCppBackend.load itself stops an existing process when
                # reloading on the same backend.
                self.loaded_backend = None
                self.loaded_key = None
                backend.load(model, placement, options=options)
                self.loaded_backend = backend
                self.loaded_key = (id(backend), getattr(model, "id", model.path),
                                   tuple(sorted((placement or {}).items())), tuple(sorted(options.items())))
                result = f"Loaded {model.path} with {backend.name}."
            except Exception as exc:
                self.loaded_backend = None
                self.loaded_key = None
                result = f"Load failed: {exc}"
            self.root.after(0, lambda: self._finish_runtime_action(result))

        threading.Thread(target=work, daemon=True).start()

    def _finish_runtime_action(self, result):
        self._runtime_action_busy = False
        self.voice_status.configure(text=result)

    def unload_model(self):
        if self._generation_busy:
            self.voice_status.configure(text="Stop the current generation before unloading the model.")
            return
        backend = self.loaded_backend
        if backend is None:
            self.voice_status.configure(text="No model is loaded.")
            return
        if self._runtime_action_busy:
            self.voice_status.configure(text="A runtime action is already in progress.")
            return
        self._runtime_action_busy = True
        self.voice_status.configure(text="Unloading model…")
        def work():
            try:
                backend.unload()
                result = "Model unloaded."
            except Exception as exc:
                result = f"Unload failed: {exc}"
            else:
                self.loaded_backend = None
                self.loaded_key = None
            self.root.after(0, lambda: self._finish_runtime_action(result))
        threading.Thread(target=work, daemon=True).start()

    def reload_model(self):
        self.load_selected_model()

    def show_runtime_status(self):
        backend = self.loaded_backend
        model = getattr(backend, "_loaded_model", None) if backend else None
        process = getattr(backend, "_process", None) if backend else None
        running = bool(process and process.poll() is None)
        message = (f"Backend: {backend.name if backend else 'none'}\n"
                   f"Model: {model or 'none'}\nStatus: {'running' if running else 'unloaded'}")
        messagebox.showinfo("Runtime status", message, parent=self.root)

    def show_effective_command(self):
        try:
            backend, model, placement, options = self._selected_runtime_configuration()
            command = getattr(backend, "effective_command", None)
            if command is None:
                raise ValueError("This runtime does not expose its effective command.")
            value = command(model, placement, options)
            if not isinstance(value, str):
                value = shlex.join(list(map(str, value)))
            win = tk.Toplevel(self.root)
            win.title("Effective llama.cpp command")
            text = tk.Text(win, width=100, height=5, wrap=tk.WORD)
            text.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)
            text.insert("1.0", value)
            text.configure(state=tk.DISABLED)
            ttk.Button(win, text="Copy", command=lambda: (self.root.clipboard_clear(), self.root.clipboard_append(value))).pack(pady=(0, 8))
        except (ValueError, TypeError, OSError, RuntimeError) as exc:
            messagebox.showerror("Command unavailable", str(exc), parent=self.root)

    def _current_preset_settings(self):
        def optional_int(variable, label):
            value = variable.get().strip()
            if not value:
                return None
            number = int(value)
            if number < 1:
                raise ValueError(f"{label} must be a positive whole number")
            return number

        temperature = float(self.temperature_var.get().strip())
        stop = [line.strip() for line in self.stop_strings.get("1.0", tk.END).splitlines() if line.strip()]
        placement = {}
        if self.gpu_layers_var.get().strip():
            placement["gpu_layers"] = int(self.gpu_layers_var.get().strip())
        if self.device_var.get().strip():
            placement["device"] = self.device_var.get().strip()
        if self.tensor_split_var.get().strip():
            placement["tensor_split"] = self.tensor_split_var.get().strip()
        if self.split_mode_var.get().strip():
            placement["split_mode"] = self.split_mode_var.get().strip()
        if self.main_gpu_var.get().strip():
            placement["main_gpu"] = int(self.main_gpu_var.get().strip())
        return {
            "system_prompt": self.system_prompt_var.get(),
            "reasoning": self.reasoning_var.get(),
            "temperature": temperature,
            "max_tokens": optional_int(self.max_tokens_var, "Maximum response tokens"),
            "stop_strings": stop,
            "context_size": optional_int(self.context_var, "Context size"),
            "threads": optional_int(self.threads_var, "CPU threads"),
            "batch_size": optional_int(self.batch_var, "Batch size"),
            "placement": placement,
            "structured_output": None,
        }

    def _apply_preset_settings(self, settings):
        for variable_name, key in (("system_prompt_var", "system_prompt"),
                                   ("temperature_var", "temperature"),
                                   ("max_tokens_var", "max_tokens"),
                                   ("context_var", "context_size"),
                                   ("threads_var", "threads"), ("batch_var", "batch_size"),
                                   ("physical_batch_var", "physical_batch_size"),
                                   ("max_concurrent_var", "max_concurrent")):
            value = settings.get(key)
            getattr(self, variable_name).set("" if value is None else str(value))
        self.reasoning_var.set(settings.get("reasoning", False))
        stop_state = self.stop_strings.cget("state")
        self.stop_strings.configure(state=tk.NORMAL)
        self.stop_strings.delete("1.0", tk.END)
        self.stop_strings.insert("1.0", "\n".join(settings.get("stop_strings", [])))
        self.stop_strings.configure(state=stop_state)
        placement = settings.get("placement", {})
        self.gpu_layers_var.set(str(placement.get("gpu_layers", "")))
        self.device_var.set(str(placement.get("device", "")))
        self.tensor_split_var.set(str(placement.get("tensor_split", "")))
        self.split_mode_var.set(str(placement.get("split_mode", "")))
        self.main_gpu_var.set(str(placement.get("main_gpu", "")))
        for key, variable in self._advanced_load_vars.items():
            if key in settings:
                variable.set(bool(settings[key]))

    def _capture_chat_settings(self):
        selected = self.model_list.curselection()
        model = self.models[selected[0]] if selected and selected[0] < len(self.models) else None
        placement = {}
        if self.gpu_layers_var.get().strip():
            placement["gpu_layers"] = int(self.gpu_layers_var.get().strip())
        if self.device_var.get().strip():
            placement["device"] = self.device_var.get().strip()
        if self.tensor_split_var.get().strip():
            placement["tensor_split"] = self.tensor_split_var.get().strip()
        if self.split_mode_var.get().strip():
            placement["split_mode"] = self.split_mode_var.get().strip()
        if self.main_gpu_var.get().strip():
            placement["main_gpu"] = int(self.main_gpu_var.get().strip())
        load = {}
        for key, variable in (("context_size", self.context_var), ("threads", self.threads_var),
                              ("batch_size", self.batch_var), ("physical_batch_size", self.physical_batch_var),
                              ("max_concurrent", self.max_concurrent_var)):
            value = variable.get().strip()
            if value:
                load[key] = int(value)
        load.update({key: variable.get() for key, variable in self._advanced_load_vars.items()})
        return {
            "backend_name": self.backend_var.get().strip(),
            "model_id": getattr(model, "id", "") if model else "",
            "model_path": model.path if model else "",
            "runtime": {"placement": placement, "load": load},
            "generation": self._current_preset_settings(),
            "preset_id": None,
        }

    def _selected_model(self):
        selected = self.model_list.curselection()
        return self.models[selected[0]] if selected and selected[0] < len(self.models) else None

    @staticmethod
    def _profile_model_id(model):
        identity = getattr(model, "id", None)
        if identity:
            return str(identity)
        # Legacy or test catalog records may not have an ID. A path-derived ID
        # keeps their settings attached to the same file without storing a path
        # as an identity or exposing it in profile indexes.
        import hashlib
        path = str(Path(model.path).expanduser().resolve())
        return "path-" + hashlib.sha256(path.encode("utf-8")).hexdigest()[:48]

    def _persist_model_profile(self, settings):
        model = self._selected_model()
        if model is None:
            return None
        backend = self.backend_by_name.get(self.backend_var.get())
        model_id = self._profile_model_id(model)
        runtime = settings.get("runtime", {})
        generation_values = settings.get("generation", {})
        generation_keys = {"system_prompt", "reasoning", "temperature", "max_tokens", "stop_strings",
                           "top_p", "top_k", "min_p", "repeat_penalty", "seed", "structured_output"}
        profile_data = {
            "name": model.display_info().get("name", Path(model.path).name),
            "model_id": model_id,
            "backend_name": getattr(backend, "name", settings.get("backend_name")) if backend else settings.get("backend_name"),
            "runtime_id": getattr(backend, "runtime_id", None) if backend else None,
            "placement": dict(runtime.get("placement", {})),
            "load": dict(runtime.get("load", {})),
            "generation": {key: value for key, value in generation_values.items() if key in generation_keys},
        }
        exact_profiles = [item for item in self.profile_store.list_profiles(model_id)
                          if item.get("model_id") == model_id]
        if exact_profiles:
            saved = self.profile_store.update(exact_profiles[0]["id"], profile_data)
        else:
            saved = self.profile_store.create(profile_data)
        self._active_model_profile = saved
        status = f"Saved load profile for {profile_data['name']}"
        if hasattr(self, "model_profile_status"):
            self.model_profile_status.configure(text=status)
        return saved

    def _save_selected_model_profile(self):
        try:
            model = self._selected_model()
            if model is None:
                # Keep the old per-conversation fallback when there is no
                # selected catalog model to own a reusable profile.
                self._save_current_chat_settings(save_profile=False)
                self.model_profile_status.configure(text="No model selected; saved settings with this conversation.")
                return None
            return self._persist_model_profile(self._capture_chat_settings())
        except (AttributeError, KeyError, OSError, ValueError, TypeError) as exc:
            messagebox.showerror("Model profile could not be saved", str(exc), parent=self.root)
            return None

    def _apply_model_profile(self, model):
        """Restore the persistent model profile, falling back to legacy chat data."""
        model_id = self._profile_model_id(model)
        try:
            profiles = [item for item in self.profile_store.list_profiles(model_id)
                        if item.get("model_id") == model_id]
        except (AttributeError, OSError, ValueError):
            profiles = []
        if profiles:
            profile = profiles[0]
            self._active_model_profile = profile
            runtime_id = profile.get("runtime_id")
            backend_name = profile.get("backend_name")
            backend = next((item for item in self.backends
                            if (runtime_id and getattr(item, "runtime_id", None) == runtime_id)
                            or (not runtime_id and item.name == backend_name)), None)
            if backend is not None:
                self.backend_var.set(backend.name)
                self._update_capabilities()
            placement = profile.get("placement", {})
            self.gpu_layers_var.set(str(placement.get("gpu_layers", "")))
            self.device_var.set(str(placement.get("device", "")))
            self.tensor_split_var.set(str(placement.get("tensor_split", "")))
            self.split_mode_var.set(str(placement.get("split_mode", "")))
            self.main_gpu_var.set(str(placement.get("main_gpu", "")))
            load = profile.get("load", {})
            for key, variable in (("context_size", self.context_var), ("threads", self.threads_var),
                                  ("batch_size", self.batch_var), ("physical_batch_size", self.physical_batch_var),
                                  ("max_concurrent", self.max_concurrent_var)):
                variable.set(str(load[key]) if key in load else "")
            for key, variable in self._advanced_load_vars.items():
                variable.set(bool(load.get(key, False)))
            self._apply_generation_profile(profile.get("generation", {}))
            self.model_profile_status.configure(text=f"Loaded saved profile: {profile.get('name', model.path)}")
            return

        self._active_model_profile = None
        legacy = {}
        try:
            legacy = self.chat_store.get_session_settings(self.chat_session["id"])
        except (AttributeError, KeyError, OSError, ValueError, TypeError):
            pass
        if legacy.get("model_path") == model.path:
            runtime = legacy.get("runtime", {})
            placement = runtime.get("placement", {})
            load = runtime.get("load", {})
            self.gpu_layers_var.set(str(placement.get("gpu_layers", "")))
            self.device_var.set(str(placement.get("device", "")))
            self.tensor_split_var.set(str(placement.get("tensor_split", "")))
            self.split_mode_var.set(str(placement.get("split_mode", "")))
            self.main_gpu_var.set(str(placement.get("main_gpu", "")))
            for key, variable in (("context_size", self.context_var), ("threads", self.threads_var),
                                  ("batch_size", self.batch_var), ("physical_batch_size", self.physical_batch_var),
                                  ("max_concurrent", self.max_concurrent_var)):
                variable.set(str(load[key]) if key in load else "")
            for key, variable in self._advanced_load_vars.items():
                variable.set(bool(load.get(key, False)))
            self.model_profile_status.configure(text="Using this conversation's legacy model settings; save to create a model profile.")
        else:
            self._clear_model_load_settings()
            self.model_profile_status.configure(text="No saved profile for this model yet.")

    def _clear_model_load_settings(self):
        for variable in (self.gpu_layers_var, self.device_var, self.tensor_split_var,
                         self.split_mode_var, self.main_gpu_var, self.threads_var, self.batch_var,
                         self.physical_batch_var, self.max_concurrent_var):
            variable.set("")
        self.context_var.set("4096")
        for variable in self._advanced_load_vars.values():
            variable.set(False)

    def _apply_generation_profile(self, settings):
        for variable_name, key in (("system_prompt_var", "system_prompt"), ("temperature_var", "temperature"),
                                   ("max_tokens_var", "max_tokens")):
            if key in settings:
                getattr(self, variable_name).set("" if settings[key] is None else str(settings[key]))
        if "reasoning" in settings:
            self.reasoning_var.set(bool(settings["reasoning"]))
        if "stop_strings" in settings:
            state = self.stop_strings.cget("state")
            self.stop_strings.configure(state=tk.NORMAL)
            self.stop_strings.delete("1.0", tk.END)
            self.stop_strings.insert("1.0", "\n".join(settings["stop_strings"]))
            self.stop_strings.configure(state=state)

    def _save_current_chat_settings(self, *, save_profile=True):
        try:
            settings = self._capture_chat_settings()
            self.chat_store.replace_session_settings(self.chat_session["id"], settings)
            if save_profile and self._selected_model() is not None:
                self._persist_model_profile(settings)
            return settings
        except (AttributeError, OSError, ValueError, TypeError) as exc:
            self.voice_status.configure(text=f"Chat settings were not saved: {exc}")
            return None

    def _apply_session_settings(self, session):
        try:
            settings = self.chat_store.get_session_settings(session["id"])
        except (AttributeError, OSError, ValueError, TypeError):
            return
        backend_name = settings.get("backend_name")
        if backend_name in self.backend_by_name:
            self.backend_var.set(backend_name)
            self._update_capabilities()
        model_path = settings.get("model_path")
        if model_path:
            if not any(model.path == model_path for model in self.models):
                self.model_filter_var.set("")
            for index, model in enumerate(self.models):
                if model.path == model_path:
                    self.model_list.selection_clear(0, tk.END)
                    self.model_list.selection_set(index)
                    self.model_list.see(index)
                    self.show_model_details()
                    break
        runtime = settings.get("runtime", {})
        placement = runtime.get("placement", {})
        self.gpu_layers_var.set(str(placement.get("gpu_layers", "")))
        self.device_var.set(str(placement.get("device", "")))
        self.tensor_split_var.set(str(placement.get("tensor_split", "")))
        self.split_mode_var.set(str(placement.get("split_mode", "")))
        self.main_gpu_var.set(str(placement.get("main_gpu", "")))
        load = runtime.get("load", {})
        for key, variable in (("context_size", self.context_var), ("threads", self.threads_var),
                              ("batch_size", self.batch_var), ("physical_batch_size", self.physical_batch_var),
                              ("max_concurrent", self.max_concurrent_var)):
            variable.set(str(load[key]) if key in load else "")
        for key, variable in self._advanced_load_vars.items():
            variable.set(bool(load.get(key, False)))
        generation = dict(settings.get("generation", {}))
        generation["context_size"] = load.get("context_size", generation.get("context_size") or 4096)
        generation["threads"] = load.get("threads", generation.get("threads"))
        generation["batch_size"] = load.get("batch_size", generation.get("batch_size"))
        self._apply_preset_settings(generation)
        model = self._selected_model()
        if model is not None:
            self._apply_model_profile(model)

    def open_preset_manager(self):
        from aidream.preset_ui import PresetManagerDialog

        try:
            dialog = PresetManagerDialog(self.root, get_settings=self._current_preset_settings,
                                         on_load=self._apply_preset_settings)
            dialog.show()
        except (OSError, ValueError, RuntimeError) as exc:
            messagebox.showerror("Preset error", str(exc), parent=self.root)

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
        self._all_models = self.catalog.list_models()
        self._populate_model_list()
        self._update_capabilities()

    def _populate_model_list(self):
        if not hasattr(self, "model_list"):
            return
        selected_path = None
        selection = self.model_list.curselection()
        if selection and selection[0] < len(self.models):
            selected_path = self.models[selection[0]].path
        query = self.model_filter_var.get().strip().casefold()
        filtered = []
        for model in self._all_models:
            info = model.display_info()
            searchable = " ".join((info["name"], info["quantization"], info["architecture"],
                                   info["license"], info["source"], info["path"])).casefold()
            if not query or query in searchable:
                filtered.append(model)
        sort_order = self.model_sort_var.get()
        if sort_order == "Largest first":
            filtered.sort(key=lambda item: (-item.size, item.path.casefold()))
        elif sort_order == "Smallest first":
            filtered.sort(key=lambda item: (item.size, item.path.casefold()))
        else:
            filtered.sort(key=lambda item: (item.display_info()["name"].casefold(), item.path.casefold()))
        self.models = filtered
        self.model_list.delete(0, tk.END)
        for model in self.models:
            info = model.display_info()
            self.model_list.insert(tk.END, f"{info['name']} · {info['quantization']} · {info['size_human']}")
        if selected_path:
            for index, model in enumerate(self.models):
                if model.path == selected_path:
                    self.model_list.selection_set(index)
                    self.model_list.see(index)
                    break
        self.show_model_details()

    def show_model_details(self, _event=None):
        selection = self.model_list.curselection()
        if not selection or selection[0] >= len(self.models):
            self.model_details.configure(text="Select a model to inspect its metadata.")
            return
        info = self.models[selection[0]].display_info()
        context = info["context_length"] or "Unknown"
        text = (f"{info['name']}\n{info['format']} · {info['quantization']} · {info['size_human']}\n"
                f"Architecture: {info['architecture']} · Context: {context}\n"
                f"License: {info['license']}\nSource: {info['source']}\n{info['path']}")
        self.model_details.configure(text=text)
        self._apply_model_profile(self.models[selection[0]])

    @staticmethod
    def _runtime_native_device_ids(backend):
        """Return only exact device IDs reported by this llama.cpp runtime."""
        list_devices = getattr(backend, "list_devices", None)
        if not callable(list_devices):
            return []
        try:
            devices = list_devices()
        except (OSError, RuntimeError, ValueError):
            return []
        native_ids = []
        for device in devices or []:
            if not isinstance(device, dict):
                continue
            identifier = device.get("runtime_id") or device.get("id")
            if isinstance(identifier, str) and identifier and identifier not in native_ids:
                native_ids.append(identifier)
        return native_ids

    def _update_capabilities(self):
        backend = self.backend_by_name.get(self.backend_var.get())
        if not backend:
            self.capability_label.configure(text="No inference runtime found. Install llama.cpp CLI to run GGUF models.")
            self.reasoning_check.configure(state=tk.DISABLED)
            self.reasoning_var.set(False)
            self.device_box.configure(state=tk.DISABLED, values=("",))
            self.manual_device_check.configure(state=tk.DISABLED)
            self.gpu_layers_entry.configure(state=tk.DISABLED)
            self.tensor_split_entry.configure(state=tk.DISABLED)
            self.split_mode_box.configure(state=tk.DISABLED)
            self.main_gpu_entry.configure(state=tk.DISABLED)
            for name, widget in self._settings_widgets.items():
                widget.configure(state=tk.DISABLED)
                if name == "stop_strings":
                    widget.configure(state=tk.NORMAL)
                    widget.delete("1.0", tk.END)
                    widget.configure(state=tk.DISABLED)
                elif name in ("context_size", "threads", "batch_size", "physical_batch_size", "max_concurrent", "max_tokens", "system_prompt"):
                    variable_name = {"context_size":"context_var", "threads":"threads_var", "batch_size":"batch_var", "physical_batch_size":"physical_batch_var", "max_concurrent":"max_concurrent_var", "max_tokens":"max_tokens_var", "system_prompt":"system_prompt_var"}[name]
                    getattr(self, variable_name).set("")
                elif name in self._advanced_load_vars:
                    self._advanced_load_vars[name].set(False)
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
        native_devices = self._runtime_native_device_ids(backend) if caps.device_selection else []
        self.device_box.configure(values=("", *native_devices),
                                  state=(tk.NORMAL if caps.device_selection and self.manual_device_var.get() else
                                         "readonly" if caps.device_selection else tk.DISABLED))
        self.manual_device_check.configure(state=tk.NORMAL if caps.device_selection else tk.DISABLED)
        self.gpu_layers_entry.configure(state=tk.NORMAL if caps.gpu_layers else tk.DISABLED)
        self.tensor_split_entry.configure(state=tk.NORMAL if caps.tensor_split else tk.DISABLED)
        self.split_mode_box.configure(state=tk.NORMAL if caps.split_mode else tk.DISABLED)
        self.main_gpu_entry.configure(state=tk.NORMAL if caps.main_gpu else tk.DISABLED)
        if not caps.gpu_layers:
            self.gpu_layers_var.set("")
        if not caps.tensor_split:
            self.tensor_split_var.set("")
        if not caps.split_mode:
            self.split_mode_var.set("")
        if not caps.main_gpu:
            self.main_gpu_var.set("")
        self.reasoning_check.configure(state=tk.NORMAL if caps.reasoning else tk.DISABLED)
        if not caps.reasoning:
            self.reasoning_var.set(False)
        if not caps.device_selection:
            self.device_var.set("")
            status += ". Device selection is not exposed by this runtime."
        else:
            status += ". Detected devices use llama.cpp runtime identifiers; enable manual override for another identifier."
        self.capability_label.configure(text=status)
        for name, widget in self._settings_widgets.items():
            supported = (bool(getattr(caps, name, False)) if name in ("context_size", "threads", "batch_size",
                                                                       "physical_batch_size", "max_concurrent",
                                                                       "flash_attention", "unified_kv_cache",
                                                                       "offload_kv_cache", "mmap",
                                                                       "keep_model_in_memory", "fit", "split_mode", "main_gpu")
                         else bool(caps.available))
            widget.configure(state=tk.NORMAL if supported else tk.DISABLED)
            if not supported:
                if name == "stop_strings":
                    widget.configure(state=tk.NORMAL)
                    widget.delete("1.0", tk.END)
                    widget.configure(state=tk.DISABLED)
                elif name in ("context_size", "threads", "batch_size", "physical_batch_size", "max_concurrent", "max_tokens", "system_prompt"):
                    variable = getattr(self, {"context_size":"context_var", "threads":"threads_var", "batch_size":"batch_var", "physical_batch_size":"physical_batch_var", "max_concurrent":"max_concurrent_var", "max_tokens":"max_tokens_var", "system_prompt":"system_prompt_var"}[name])
                    variable.set("")
                elif name in self._advanced_load_vars:
                    self._advanced_load_vars[name].set(False)

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
        repo_details = ttk.Label(win, text="Select a repository to inspect its public metadata.",
                                 wraplength=690, justify=tk.LEFT)
        repo_details.pack(fill=tk.X, padx=10, pady=(0, 5))
        ttk.Label(win, text="Repository GGUF files").pack(anchor="w", padx=10)
        files = tk.Listbox(win, height=12, exportselection=False)
        files.pack(fill=tk.BOTH, expand=True, padx=10, pady=4)
        repo_action_row = ttk.Frame(win)
        repo_action_row.pack(fill=tk.X, padx=10)
        details_button = ttk.Button(repo_action_row, text="Repository details", command=lambda: show_repo_details())
        details_button.pack(side=tk.LEFT)
        load_files = ttk.Button(win, text="List files", command=lambda: list_files())
        load_files.pack(in_=repo_action_row, side=tk.LEFT, padx=6)
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
            details_button.configure(state=state)
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
                            qualifiers = [f"{item.downloads:,} downloads"]
                            if item.license:
                                qualifiers.append(f"{item.license} license")
                            if item.size_bytes is not None:
                                qualifiers.append(_gib(item.size_bytes) + " GiB")
                            repos.insert(tk.END, f"{item.repo_id}  ·  {' · '.join(qualifiers)}")
                        status.set(f"Found {len(result)} public GGUF repositories.")
                        busy(False)
                    win.after(0, done)
                except (OSError, ValueError, RuntimeError) as exc:
                    error = str(exc)
                    win.after(0, lambda error=error: (status.set(error), busy(False)))
            threading.Thread(target=work, daemon=True).start()

        def show_repo_details():
            selection = repos.curselection()
            if not selection:
                messagebox.showinfo("Select a repository", "Choose a repository from the search results.", parent=win)
                return
            repo_id = repo_items[selection[0]].repo_id
            busy(True)
            status.set(f"Loading public metadata for {repo_id}…")
            def work():
                try:
                    details = service.repository_details(repo_id)
                    def done():
                        size = f"{_gib(details.size_bytes)} GiB" if details.size_bytes is not None else "unknown"
                        tags = ", ".join(details.tags[:10]) or "none"
                        repo_details.configure(text=(
                            f"{details.repo_id}\nLicense: {details.license or 'not declared'} · "
                            f"Task: {details.pipeline_tag or 'unknown'} · Size: {size}\n"
                            f"Downloads: {details.downloads:,} · Likes: {details.likes:,} · "
                            f"Updated: {details.last_modified or 'unknown'}\nTags: {tags}"))
                        status.set(f"Public metadata loaded for {repo_id}.")
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
        settings = self._save_current_chat_settings()
        self.chat_session = self.chat_store.create()
        if settings:
            try:
                self.chat_store.replace_session_settings(self.chat_session["id"], settings)
            except (AttributeError, OSError, ValueError, TypeError):
                pass
        self._refresh_sessions()
        self._restore_chat()
        self._unload_current()

    def select_chat(self, _event=None):
        label = self.session_var.get()
        match = next((item for item in self.chat_store.list_sessions() if _session_label(item) == label), None)
        if match and match["id"] != self.chat_session["id"]:
            self._save_current_chat_settings()
            self.chat_session = self.chat_store.load(match["id"])
            self._restore_chat()
            self._unload_current()
            self._apply_session_settings(self.chat_session)

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
            self._apply_session_settings(self.chat_session)
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
            if self._speech_worker and not self._speech_worker.done:
                self._speech_worker.cancel()
            self._speech_worker = self.voice.speak_async(self.last_answer)
            self.stop_speech_button.configure(state=tk.NORMAL)
            self.voice_status.configure(text="Speaking answer…")
            self.root.after(100, self._poll_speech_worker)
        except (OSError, RuntimeError, ValueError) as exc:
            messagebox.showerror("Voice output unavailable", str(exc))

    def stop_speaking(self):
        worker = self._speech_worker
        if worker and not worker.done:
            worker.cancel()
            self.voice_status.configure(text="Speech stopped")
        self.stop_speech_button.configure(state=tk.DISABLED)

    def _poll_speech_worker(self):
        worker = self._speech_worker
        if not worker:
            return
        if not worker.done:
            self.root.after(100, self._poll_speech_worker)
            return
        self.stop_speech_button.configure(state=tk.DISABLED)
        try:
            worker.wait(0)
            self.voice_status.configure(text="Speech finished")
        except RuntimeError as exc:
            self.voice_status.configure(text="Speech output failed")
            messagebox.showerror("Voice output failed", str(exc), parent=self.root)

    def record_and_transcribe(self):
        if self._voice_busy:
            return
        if not self.voice.capabilities.recording:
            messagebox.showinfo("Voice input unavailable", self.voice.capabilities.setup_help(), parent=self.root)
            return
        model = self._selected_whisper_model()
        if not model:
            return
        try:
            seconds = int(self.record_seconds_var.get())
            if not 1 <= seconds <= 120:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid recording duration", "Choose a duration from 1 to 120 seconds.",
                                 parent=self.root)
            return
        self._start_transcription(model, record_seconds=seconds)

    def choose_whisper_model(self):
        path = filedialog.askopenfilename(title="Choose an installed whisper.cpp model",
                                          filetypes=[("Whisper model", "ggml-*.bin"), ("All files", "*.*")],
                                          parent=self.root)
        if not path:
            return
        values = list(self.whisper_model_box.cget("values"))
        if path not in values:
            values.append(path)
            self.whisper_model_box.configure(values=values)
        self.whisper_model_var.set(path)

    def _selected_whisper_model(self):
        selected = self.whisper_model_var.get().strip()
        if selected and Path(selected).is_file():
            return selected
        return self.choose_whisper_model_and_return()

    def choose_whisper_model_and_return(self):
        self.choose_whisper_model()
        selected = self.whisper_model_var.get().strip()
        return selected if selected and Path(selected).is_file() else None

    def transcribe_audio_file(self):
        if self._voice_busy:
            return
        if not self.voice.capabilities.speech_to_text:
            messagebox.showinfo("Speech recognition unavailable", self.voice.capabilities.setup_help(),
                                parent=self.root)
            return
        audio = filedialog.askopenfilename(
            title="Choose a local audio file",
            filetypes=(("Audio files", "*.wav *.mp3 *.m4a *.flac *.ogg *.opus"), ("All files", "*.*")),
            parent=self.root)
        if not audio:
            return
        model = self._selected_whisper_model()
        if model:
            self._start_transcription(model, audio_path=audio)

    def _start_transcription(self, model, *, audio_path=None, record_seconds=None):
        self._voice_busy = True
        self.record_button.configure(state=tk.DISABLED)
        self.transcribe_audio_button.configure(state=tk.DISABLED)
        self.voice_status.configure(text=(f"Recording {record_seconds} seconds…" if record_seconds
                                          else "Transcribing local audio…"))

        def work():
            audio = None
            try:
                if record_seconds:
                    handle = tempfile.NamedTemporaryFile(prefix="ai-dream-mic-", suffix=".wav", delete=False)
                    audio = Path(handle.name)
                    handle.close()
                    audio.unlink(missing_ok=True)
                    self.voice.record(audio, seconds=record_seconds)
                else:
                    audio = Path(audio_path)
                self._voice_results.put(("status", "Transcribing…"))
                text = self.voice.transcribe(audio, model)
                self._voice_results.put(("success", text))
            except (OSError, RuntimeError, ValueError) as exc:
                self._voice_results.put(("error", str(exc)))
            finally:
                if record_seconds and audio:
                    audio.unlink(missing_ok=True)

        threading.Thread(target=work, name="ai-dream-voice-input", daemon=True).start()

    def _push_to_talk_down(self, _event=None):
        if self._voice_busy or self._ptt_worker:
            return "break"
        if not self.voice.capabilities.recording or not self.voice.capabilities.speech_to_text:
            messagebox.showinfo("Push-to-talk unavailable", self.voice.capabilities.setup_help(), parent=self.root)
            return "break"
        model = self.whisper_model_var.get().strip()
        if not model or not Path(model).is_file():
            messagebox.showinfo("Choose a Whisper model", "Select an installed local Whisper model first.",
                                parent=self.root)
            return "break"
        try:
            maximum = int(self.record_seconds_var.get())
            if not 1 <= maximum <= 120:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid maximum duration", "Push-to-talk is limited to 1–120 seconds.",
                                 parent=self.root)
            return "break"
        handle = tempfile.NamedTemporaryFile(prefix="ai-dream-ptt-", suffix=".wav", delete=False)
        path = Path(handle.name)
        handle.close()
        path.unlink(missing_ok=True)
        try:
            self._ptt_model, self._ptt_path = model, path
            self._ptt_worker = self.voice.start_recording(path, max_seconds=maximum)
            self._voice_busy = True
            self.record_button.configure(state=tk.DISABLED)
            self.transcribe_audio_button.configure(state=tk.DISABLED)
            self.push_to_talk_button.configure(text="Release to transcribe…")
            self.voice_status.configure(text=f"Listening (max {maximum}s)… release to transcribe")
            try:
                self.push_to_talk_button.grab_set()
            except tk.TclError:
                pass
            self.root.after(75, self._poll_push_to_talk)
        except (OSError, RuntimeError, ValueError) as exc:
            path.unlink(missing_ok=True)
            self._ptt_worker = self._ptt_path = self._ptt_model = None
            messagebox.showerror("Push-to-talk failed", str(exc), parent=self.root)
        return "break"

    def _push_to_talk_up(self, _event=None):
        worker = self._ptt_worker
        if worker:
            try:
                self.push_to_talk_button.grab_release()
            except tk.TclError:
                pass
            self.push_to_talk_button.configure(text="Transcribing…")
            self.voice_status.configure(text="Stopping microphone and transcribing locally…")
            worker.stop()
        return "break"

    def _poll_push_to_talk(self):
        worker = self._ptt_worker
        if not worker:
            return
        if not worker.done:
            self.root.after(75, self._poll_push_to_talk)
            return
        try:
            try:
                self.push_to_talk_button.grab_release()
            except tk.TclError:
                pass
            audio = worker.wait(0)
            model = self._ptt_model
        except (OSError, RuntimeError, ValueError) as exc:
            self._voice_results.put(("error", str(exc)))
            self._cleanup_push_to_talk()
            return

        def transcribe():
            try:
                self._voice_results.put(("status", "Transcribing local speech…"))
                text = self.voice.transcribe(audio, model)
                self._voice_results.put(("success", text))
            except (OSError, RuntimeError, ValueError) as exc:
                self._voice_results.put(("error", str(exc)))
            finally:
                audio.unlink(missing_ok=True)
                self._cleanup_push_to_talk()

        threading.Thread(target=transcribe, name="ai-dream-ptt-transcription", daemon=True).start()

    def _cleanup_push_to_talk(self):
        self._ptt_worker = None
        self._ptt_model = None
        self._ptt_path = None

    def _poll_voice_results(self):
        try:
            while True:
                kind, value = self._voice_results.get_nowait()
                if kind == "status":
                    self.voice_status.configure(text=value)
                else:
                    self._voice_busy = False
                    self.record_button.configure(state=tk.NORMAL)
                    self.transcribe_audio_button.configure(state=tk.NORMAL)
                    self.push_to_talk_button.configure(state=tk.NORMAL, text="Hold to talk")
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
        if self._generation_busy:
            return
        if self._runtime_action_busy:
            self.voice_status.configure(text="Wait for the current model load or unload to finish.")
            return
        selected = self.model_list.curselection()
        if not selected:
            messagebox.showinfo("Select a model", "Choose a GGUF model first.")
            return
        backend = self.backend_by_name.get(self.backend_var.get())
        caps = backend.capabilities() if backend else None
        if not backend or not caps.available:
            details = caps.details if caps else "No inference backend is selected."
            messagebox.showerror("Runtime unavailable", details, parent=self.root)
            return
        prompt = self.prompt.get("1.0", tk.END).strip()
        if not prompt and not self._pending_images and not self._pending_documents:
            return
        if self._pending_images and self.agent_mode_var.get():
            messagebox.showerror("Images unavailable in agent mode", "Send image attachments in regular chat mode.")
            return
        image_attachments = []
        if self._pending_images:
            try:
                from aidream.image_input import load_image_attachment
                image_attachments = [load_image_attachment(path) for path in self._pending_images]
            except (OSError, ValueError) as exc:
                messagebox.showerror("Invalid image attachment", str(exc), parent=self.root)
                return
        document_attachments = []
        runtime_prompt = prompt
        if self._pending_documents:
            try:
                from aidream.document_input import load_document_attachment, build_document_prompt
                document_attachments = [load_document_attachment(path) for path in self._pending_documents]
                runtime_prompt = build_document_prompt(prompt, document_attachments)
            except (OSError, ValueError) as exc:
                messagebox.showerror("Invalid document attachment", str(exc), parent=self.root)
                return
        if image_attachments:
            try:
                from aidream.image_input import build_multimodal_message
                build_multimodal_message(runtime_prompt, image_attachments)
            except ValueError as exc:
                messagebox.showerror("Invalid image attachment", str(exc), parent=self.root)
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
        if self.split_mode_var.get().strip():
            placement["split_mode"] = self.split_mode_var.get().strip()
        if self.main_gpu_var.get().strip():
            try:
                placement["main_gpu"] = int(self.main_gpu_var.get().strip())
            except ValueError:
                messagebox.showerror("Invalid main GPU", "Main GPU must be a non-negative whole number.")
                return
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
        for key, var in (("physical_batch_size", self.physical_batch_var), ("max_concurrent", self.max_concurrent_var)):
            value = var.get().strip()
            if value and getattr(caps, key, False):
                try:
                    load_options[key] = int(value)
                    if load_options[key] < 1:
                        raise ValueError
                except ValueError:
                    messagebox.showerror("Invalid setting", f"{key.replace('_', ' ').title()} must be a positive whole number.")
                    return
        for key, variable in self._advanced_load_vars.items():
            if getattr(caps, key, False):
                load_options[key] = variable.get()
        for key, variable in self._advanced_load_vars.items():
            if getattr(caps, key, False):
                load_options[key] = variable.get()
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
            validate_load = getattr(backend, "validate_load", None)
            if validate_load:
                validate_load(model, placement, load_options)
        except (OSError, ValueError, RuntimeError) as exc:
            messagebox.showerror("Model configuration unavailable", str(exc), parent=self.root)
            return
        try:
            self.chat_store.replace_session_settings(self.chat_session["id"], self._capture_chat_settings())
        except (AttributeError, OSError, ValueError, TypeError) as exc:
            messagebox.showerror("Chat settings could not be saved", str(exc), parent=self.root)
            return
        if image_attachments:
            generation_options["images"] = image_attachments
        try:
            from aidream.conversation import make_attachment_reference
            attachment_refs = ([make_attachment_reference("image", item.path) for item in image_attachments]
                               + [make_attachment_reference("document", item.path) for item in document_attachments])
        except (OSError, ValueError, RuntimeError) as exc:
            messagebox.showerror("Attachment could not be saved", str(exc), parent=self.root)
            return
        session_id = self.chat_session["id"]
        prior = [message.copy() for message in self.chat_session.get("messages", [])
                 if message.get("role") in ("user", "assistant")]
        agent_mode = self.agent_mode_var.get()
        placement_key = tuple(sorted((key, str(value)) for key, value in (placement or {}).items()))
        model_key = getattr(model, "id", model.path)
        requested_key = (id(backend), model_key, placement_key, tuple(sorted(load_options.items())))
        self._generation_busy = True
        self._generation_event = threading.Event()
        saved_prompt = prompt
        labels = []
        if image_attachments:
            labels.append("image(s): " + ", ".join(image.path.name for image in image_attachments))
        if document_attachments:
            labels.append("document(s): " + ", ".join(document.name for document in document_attachments))
        if labels:
            saved_prompt = (prompt + "\n" if prompt else "") + f"[Attached {'; '.join(labels)}]"
        self._pending_generation = {"session_id": session_id, "prompt": prompt,
                                    "saved_prompt": saved_prompt,
                                    "attachment_refs": attachment_refs,
                                    "image_paths": list(self._pending_images),
                                    "document_paths": list(self._pending_documents),
                                    "parts": [], "agent_note": None, "backend": backend}
        self.send_button.configure(state=tk.DISABLED)
        self.stop_button.configure(state=tk.NORMAL)
        for widget in self._generation_controls:
            widget.configure(state=tk.DISABLED)
        self.prompt.delete("1.0", tk.END)
        self._append_chat(f"You: {saved_prompt}\n\nAssistant: ")

        def work():
            try:
                if not backend.can_load(model):
                    raise RuntimeError(f"{backend.name} cannot load this model.")
                if self.loaded_key != requested_key:
                    self._unload_current()
                    backend.load(model, placement, options=load_options)
                    self.loaded_backend, self.loaded_key = backend, requested_key
                    if hasattr(backend, "restore_history"):
                        backend.restore_history(prior)
                    self._generation_results.put(("status", f"Loaded {model.path} with {backend.name}."))
                if agent_mode:
                    from aidream.agent import LocalAgent
                    result = LocalAgent(backend).run(runtime_prompt, history=prior,
                                                     cancel_event=self._generation_event)
                    answer = result.text or ("Agent stopped by user." if result.stop_reason == "cancelled" else "")
                    support = "supported" if result.tool_calls_supported else "not supported by this model/runtime"
                    details = "; ".join(
                        f"#{item['sequence']} {item['name']} [{item['status']}; {item['duration_ms']} ms; "
                        f"fields={','.join(item['argument_names']) or 'none'}; {item['result_bytes']} B]: "
                        f"{item['result_snippet']}"
                        for item in result.summary()["tools"]
                    ) or "none"
                    note = (f"Read-only agent ({support}; {result.elapsed_seconds:.1f}s; "
                            f"{result.stop_reason}). Tools: {details}")[:1800]
                    self._pending_generation["agent_note"] = note
                    self._generation_results.put(("delta", answer))
                elif hasattr(backend, "generate_stream"):
                    answer = backend.generate_stream(
                        runtime_prompt, options=generation_options,
                        on_delta=lambda text: self._generation_results.put(("delta", text)),
                        cancel_event=self._generation_event)
                else:
                    answer = backend.generate(runtime_prompt, options=generation_options)
                    self._generation_results.put(("delta", answer))
                if self._generation_event.is_set() and not (agent_mode and result.stop_reason == "cancelled"):
                    raise RuntimeError("Generation stopped")
                self._generation_results.put(("complete", answer))
            except Exception as exc:
                if self._generation_event and self._generation_event.is_set():
                    self._generation_results.put(("cancelled", None))
                else:
                    self._generation_results.put(("error", str(exc)))

        threading.Thread(target=work, name="ai-dream-generation", daemon=True).start()

    def attach_images(self):
        from aidream.image_input import MAX_IMAGES_PER_MESSAGE, MAX_TOTAL_IMAGE_BYTES, load_image_attachment

        paths = filedialog.askopenfilenames(
            parent=self.root,
            title="Choose local images",
            filetypes=(("Images", "*.png *.jpg *.jpeg *.webp"), ("All files", "*")),
        )
        if not paths:
            return
        proposed = list(dict.fromkeys([*self._pending_images, *paths]))
        if len(proposed) > MAX_IMAGES_PER_MESSAGE:
            messagebox.showerror("Too many images", f"A message can contain at most {MAX_IMAGES_PER_MESSAGE} images.", parent=self.root)
            return
        try:
            attachments = [load_image_attachment(path) for path in proposed]
            if sum(item.size_bytes for item in attachments) > MAX_TOTAL_IMAGE_BYTES:
                raise ValueError(f"Images exceed the {MAX_TOTAL_IMAGE_BYTES} byte combined limit.")
        except (OSError, ValueError) as exc:
            messagebox.showerror("Invalid image attachment", str(exc), parent=self.root)
            return
        self._pending_images = [str(item.path) for item in attachments]
        self.images_status.configure(text=f"{len(attachments)} image(s) attached")
        self.clear_images_button.configure(state=tk.NORMAL)

    def clear_images(self):
        if self._generation_busy:
            return
        self._pending_images.clear()
        self.images_status.configure(text="")
        self.clear_images_button.configure(state=tk.DISABLED)

    def attach_documents(self):
        from aidream.document_input import build_document_prompt, load_document_attachment

        paths = filedialog.askopenfilenames(
            parent=self.root,
            title="Choose local documents",
            filetypes=(("Documents", "*.txt *.md *.markdown *.pdf"), ("All files", "*")),
        )
        if not paths:
            return
        proposed = list(dict.fromkeys([*self._pending_documents, *paths]))
        try:
            attachments = [load_document_attachment(path) for path in proposed]
            build_document_prompt("", attachments)
        except (OSError, ValueError) as exc:
            messagebox.showerror("Invalid document attachment", str(exc), parent=self.root)
            return
        self._pending_documents = [str(item.path) for item in attachments]
        self.documents_status.configure(text=f"{len(attachments)} document(s) attached")
        self.clear_documents_button.configure(state=tk.NORMAL)

    def clear_documents(self):
        if self._generation_busy:
            return
        self._pending_documents.clear()
        self.documents_status.configure(text="")
        self.clear_documents_button.configure(state=tk.DISABLED)

    def stop_generation(self):
        if not self._generation_busy:
            return
        self.stop_button.configure(state=tk.DISABLED)
        self.voice_status.configure(text="Stopping generation…")
        if self._generation_event:
            self._generation_event.set()
        backend = self._pending_generation.get("backend") if self._pending_generation else None
        cancel = getattr(backend, "cancel_generation", None)
        if cancel:
            cancel()

    def _poll_generation_results(self):
        try:
            while True:
                kind, value = self._generation_results.get_nowait()
                pending = self._pending_generation
                if not pending:
                    continue
                if kind == "status":
                    self.voice_status.configure(text=value)
                elif kind == "delta":
                    pending["parts"].append(value)
                    self.chat.configure(state=tk.NORMAL)
                    self.chat.insert(tk.END, value)
                    self.chat.see(tk.END)
                    self.chat.configure(state=tk.DISABLED)
                else:
                    cancelled = kind == "cancelled"
                    if kind == "complete" and self.chat_session.get("id") == pending["session_id"]:
                        self.chat_session = self.chat_store.append(
                            pending["session_id"], "user", pending["saved_prompt"],
                            attachments=pending.get("attachment_refs", []))
                        if pending["agent_note"]:
                            self.chat_session = self.chat_store.append(pending["session_id"], "system", pending["agent_note"])
                        self.chat_session = self.chat_store.append(pending["session_id"], "assistant", value)
                        self.last_answer = value
                        if pending["agent_note"] and hasattr(pending["backend"], "restore_history"):
                            history = [m for m in self.chat_session.get("messages", [])
                                       if m.get("role") in ("user", "assistant")]
                            pending["backend"].restore_history(history)
                        self._refresh_sessions()
                        self._restore_chat()
                    elif kind == "error":
                        self._unload_current()
                        self._restore_chat()
                        self._restore_composer_input(pending)
                        messagebox.showerror("Generation failed", value, parent=self.root)
                    else:
                        # Remove the temporary, potentially partial response from display.
                        if self.chat_session.get("id") == pending["session_id"]:
                            self._restore_chat()
                        if cancelled:
                            self._restore_composer_input(pending)
                    self.voice_status.configure(text="Generation stopped" if cancelled else "Ready")
                    self._generation_busy = False
                    self._generation_event = None
                    self._pending_generation = None
                    if kind == "complete":
                        self._pending_images.clear()
                        self._pending_documents.clear()
                        self.images_status.configure(text="")
                        self.documents_status.configure(text="")
                        self.clear_images_button.configure(state=tk.DISABLED)
                        self.clear_documents_button.configure(state=tk.DISABLED)
                    self.send_button.configure(state=tk.NORMAL)
                    self.stop_button.configure(state=tk.DISABLED)
                    for widget in self._generation_controls:
                        widget.configure(state=("readonly" if widget in (self.session_box, self.backend_box)
                                                else tk.NORMAL))
                    self.clear_images_button.configure(state=tk.NORMAL if self._pending_images else tk.DISABLED)
        except queue.Empty:
            pass
        if self.root.winfo_exists():
            self.root.after(40, self._poll_generation_results)

    def _restore_composer_input(self, pending):
        self.prompt.delete("1.0", tk.END)
        self.prompt.insert("1.0", pending.get("prompt", ""))
        self._pending_images = list(pending.get("image_paths", []))
        self._pending_documents = list(pending.get("document_paths", []))
        if self._pending_images:
            self.images_status.configure(text=f"{len(self._pending_images)} image(s) attached for retry")
            self.clear_images_button.configure(state=tk.NORMAL)
        if self._pending_documents:
            self.documents_status.configure(text=f"{len(self._pending_documents)} document(s) attached for retry")
            self.clear_documents_button.configure(state=tk.NORMAL)

    def _unload_current(self):
        backend, self.loaded_backend = self.loaded_backend, None
        self.loaded_key = None
        if backend:
            backend.unload()

    def close(self):
        if self._closing:
            return
        self._closing = True
        if self._ptt_worker and not self._ptt_worker.done:
            threading.Thread(target=self._ptt_worker.cancel, name="ai-dream-stop-recording", daemon=True).start()
        if self._ptt_path:
            try:
                self._ptt_path.unlink(missing_ok=True)
            except OSError:
                pass
        if self._speech_worker and not self._speech_worker.done:
            threading.Thread(target=self._speech_worker.cancel, name="ai-dream-stop-speech", daemon=True).start()
        if self._generation_event:
            self._generation_event.set()
            backend = self._pending_generation.get("backend") if self._pending_generation else None
            cancel = getattr(backend, "cancel_generation", None)
            if cancel:
                threading.Thread(target=cancel, name="ai-dream-cancel-generation", daemon=True).start()
        try:
            self.root.title("AI Dream — Closing")
        except tk.TclError:
            pass
        stopped = threading.Event()

        def cleanup():
            # Let an explicit UI load finish before tearing its backend down.
            # This avoids a close/load race that could otherwise leave a newly
            # spawned llama-server process alive after the Tk window exits.
            if getattr(self, "_runtime_action_busy", False):
                try:
                    self.root.after(50, cleanup)
                except tk.TclError:
                    pass
                return
            try:
                self._unload_current()
            finally:
                stopped.set()

        threading.Thread(target=cleanup, name="ai-dream-shutdown", daemon=True).start()
        self._finish_close(stopped)

    def _finish_close(self, stopped):
        if stopped.is_set():
            try:
                self.root.destroy()
            except tk.TclError:
                pass
            return
        try:
            self.root.after(50, lambda: self._finish_close(stopped))
        except tk.TclError:
            pass


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
