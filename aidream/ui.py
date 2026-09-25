"""Small Tk GUI over the same catalog, hardware, and runtime services as the CLI."""

from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox, ttk


class AIDreamWindow:
    def __init__(self, root: tk.Tk):
        from aidream.hardware import HardwareService
        from aidream.models import ModelCatalog
        from aidream.runtime import RuntimeRegistry

        self.root = root
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
        self._build()
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

        self.chat = tk.Text(right, state=tk.DISABLED, wrap=tk.WORD)
        self.chat.pack(fill=tk.BOTH, expand=True, pady=4)
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
            return
        caps = backend.capabilities()
        controls = []
        if caps.gpu_layers:
            controls.append("GPU layers")
        if caps.device_selection:
            controls.append("device selection")
        if caps.tensor_split:
            controls.append("tensor split")
        status = f"Executable: {caps.executable or 'not found'}; controls: {', '.join(controls) or 'CPU/default only'}"
        self.device_box.configure(state=tk.NORMAL if caps.device_selection else tk.DISABLED)
        self.gpu_layers_entry.configure(state=tk.NORMAL if caps.gpu_layers else tk.DISABLED)
        self.tensor_split_entry.configure(state=tk.NORMAL if caps.tensor_split else tk.DISABLED)
        if not caps.gpu_layers:
            self.gpu_layers_var.set("")
        if not caps.tensor_split:
            self.tensor_split_var.set("")
        if not caps.device_selection:
            self.device_var.set("")
            status += ". Device selection is not exposed by this runtime."
        else:
            status += ". Device name uses the runtime's naming; it is not inferred from hardware indices."
        self.capability_label.configure(text=status)

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

    def _append_chat(self, text: str):
        self.chat.configure(state=tk.NORMAL)
        self.chat.insert(tk.END, text + "\n\n")
        self.chat.see(tk.END)
        self.chat.configure(state=tk.DISABLED)

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
        try:
            if not backend.can_load(model):
                raise RuntimeError(f"{backend.name} cannot load this model.")
            placement_key = tuple(sorted((key, str(value)) for key, value in (placement or {}).items()))
            model_key = getattr(model, "id", model.path)
            requested_key = (id(backend), model_key, placement_key)
            if self.loaded_key != requested_key:
                self._unload_current()
                backend.load(model, placement)
                self.loaded_backend = backend
                self.loaded_key = requested_key
                self._append_chat(f"Loaded {model.path} with {backend.name}.")
            self._append_chat(f"You: {prompt}")
            answer = backend.generate(prompt)
            self._append_chat(f"Assistant: {answer}")
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


def _gib(n):
    return "unknown" if n is None else f"{n / (1024 ** 3):.1f}"


def main() -> None:
    root = tk.Tk()
    AIDreamWindow(root)
    root.mainloop()


if __name__ == "__main__":
    main()
