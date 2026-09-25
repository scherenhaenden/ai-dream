"""Standalone Tk dialog for managing saved chat presets.

The storage/workflow controller is deliberately separated from the widgets so
its behavior can be tested without starting a Tk display.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from aidream.presets import PresetStore


class PresetManagerController:
    """Small UI-facing facade over :class:`PresetStore`."""

    def __init__(self, store: PresetStore | None = None, *,
                 get_settings: Callable[[], Mapping[str, Any]] | None = None,
                 on_load: Callable[[dict[str, Any]], None] | None = None):
        self.store = store or PresetStore()
        self.get_settings = get_settings or (lambda: {})
        self.on_load = on_load or (lambda _settings: None)

    def list_presets(self) -> list[dict[str, Any]]:
        return self.store.list_presets()

    def create(self, name: str) -> dict[str, Any]:
        settings = self.get_settings()
        if not isinstance(settings, Mapping):
            raise ValueError("current chat settings must be an object")
        return self.store.create(name, settings)

    def load(self, preset_id: str) -> dict[str, Any]:
        preset = self.store.load(preset_id)
        self.on_load(dict(preset["settings"]))
        return preset

    def rename(self, preset_id: str, name: str) -> dict[str, Any]:
        return self.store.rename(preset_id, name)

    def delete(self, preset_id: str) -> None:
        self.store.delete(preset_id)


class PresetManagerDialog:
    """A modal-feeling Toplevel window with create/load/rename/delete actions.

    Tk is imported only when the dialog is instantiated, allowing callers to
    use and test the controller in headless environments.
    """

    def __init__(self, parent: Any, store: PresetStore | None = None, *,
                 get_settings: Callable[[], Mapping[str, Any]] | None = None,
                 on_load: Callable[[dict[str, Any]], None] | None = None):
        import tkinter as tk
        from tkinter import messagebox, simpledialog, ttk

        self._tk = tk
        self._messagebox = messagebox
        self._simpledialog = simpledialog
        self.controller = PresetManagerController(store, get_settings=get_settings, on_load=on_load)
        self.window = tk.Toplevel(parent)
        self.window.title("Chat presets")
        self.window.transient(parent)
        self.window.minsize(420, 320)

        body = ttk.Frame(self.window, padding=12)
        body.pack(fill=tk.BOTH, expand=True)
        ttk.Label(body, text="Saved chat presets").pack(anchor=tk.W)
        list_frame = ttk.Frame(body)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=(8, 10))
        self.listbox = tk.Listbox(list_frame, exportselection=False, activestyle="dotbox")
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=scrollbar.set)
        self.listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.listbox.bind("<<ListboxSelect>>", self._update_buttons)
        self.listbox.bind("<Double-Button-1>", lambda _event: self._load())

        self.status = tk.StringVar(value="Create a preset from the current chat settings.")
        ttk.Label(body, textvariable=self.status, wraplength=390).pack(fill=tk.X, pady=(0, 8))
        buttons = ttk.Frame(body)
        buttons.pack(fill=tk.X)
        self.create_button = ttk.Button(buttons, text="Create", command=self._create)
        self.load_button = ttk.Button(buttons, text="Load", command=self._load)
        self.rename_button = ttk.Button(buttons, text="Rename", command=self._rename)
        self.delete_button = ttk.Button(buttons, text="Delete", command=self._delete)
        self.create_button.pack(side=tk.LEFT)
        self.load_button.pack(side=tk.LEFT, padx=(6, 0))
        self.rename_button.pack(side=tk.LEFT, padx=(6, 0))
        self.delete_button.pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(buttons, text="Close", command=self.window.destroy).pack(side=tk.RIGHT)
        self.refresh()

    def show(self) -> None:
        """Raise the dialog and wait for it to close."""
        self.window.grab_set()
        self.window.wait_window()

    def refresh(self, select_id: str | None = None) -> None:
        try:
            self.presets = self.controller.list_presets()
        except (OSError, ValueError, RuntimeError) as exc:
            self.presets = []
            self._messagebox.showerror("Preset error", str(exc), parent=self.window)
        self.listbox.delete(0, self._tk.END)
        for preset in self.presets:
            self.listbox.insert(self._tk.END, preset["name"])
        if select_id:
            for index, preset in enumerate(self.presets):
                if preset["id"] == select_id:
                    self.listbox.selection_set(index)
                    self.listbox.see(index)
                    break
        self._update_buttons()

    def _selected(self) -> dict[str, Any] | None:
        selection = self.listbox.curselection()
        if not selection:
            return None
        index = int(selection[0])
        return self.presets[index] if 0 <= index < len(self.presets) else None

    def _update_buttons(self, _event: Any = None) -> None:
        state = self._tk.NORMAL if self._selected() else self._tk.DISABLED
        for button in (self.load_button, self.rename_button, self.delete_button):
            button.configure(state=state)

    def _create(self) -> None:
        name = self._simpledialog.askstring("Create preset", "Preset name:", parent=self.window)
        if name is None:
            return
        self._perform(lambda: self.controller.create(name), "Preset created.")

    def _load(self) -> None:
        preset = self._selected()
        if not preset:
            return
        self._perform(lambda: self.controller.load(preset["id"]), "Preset loaded.", refresh=False)

    def _rename(self) -> None:
        preset = self._selected()
        if not preset:
            return
        name = self._simpledialog.askstring("Rename preset", "Preset name:",
                                            initialvalue=preset["name"], parent=self.window)
        if name is None:
            return
        self._perform(lambda: self.controller.rename(preset["id"], name), "Preset renamed.",
                      select=True)

    def _delete(self) -> None:
        preset = self._selected()
        if not preset:
            return
        if not self._messagebox.askyesno("Delete preset", f"Delete '{preset['name']}'?",
                                         parent=self.window):
            return
        self._perform(lambda: self.controller.delete(preset["id"]), "Preset deleted.")

    def _perform(self, operation: Callable[[], Any], success: str, *,
                 refresh: bool = True, select: bool = False) -> None:
        try:
            result = operation()
            if refresh:
                self.refresh(result["id"] if select and isinstance(result, dict) else None)
            self.status.set(success)
        except (OSError, ValueError, KeyError, RuntimeError) as exc:
            self._messagebox.showerror("Preset error", str(exc), parent=self.window)
            self.status.set("The preset operation could not be completed.")
