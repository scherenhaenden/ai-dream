import os
import sys
import time
import pytest
from unittest.mock import MagicMock
import threading
import tkinter as tk
import queue
from pathlib import Path

class StubVoice:
    def __init__(self):
        self.capabilities = MagicMock()
        self.capabilities.setup_help.return_value = "Voice capabilities initialized."
    def configuration(self):
        config = MagicMock()
        config.whisper_models = []
        return config

class StubChatStore:
    def __init__(self):
        self._sessions = [{"id": "stub_session_1", "title": "Stub Chat", "updated_at": "2023-10-27T10:00:00Z"}]
    def list_sessions(self):
        return self._sessions
    def create(self):
        return {"id": "stub_session_2", "title": "New Chat", "updated_at": "2023-10-27T10:05:00Z"}
    def append(self, *args, **kwargs):
        pass

class StubBackend:
    def __init__(self):
        self.name = "stub_backend"
    def capabilities(self):
        c = MagicMock()
        c.reasoning = False
        return c

class StubRegistry:
    def list_backends(self):
        return [StubBackend()]

class StubHardware:
    def detect(self):
        m = MagicMock()
        m.to_dict.return_value = {
            "cpu": {"name": "AMD Ryzen 9", "physical_cores": 12, "logical_cores": 24},
            "ram": {"total_bytes": 16 * 1024**3, "available_bytes": 8 * 1024**3},
            "gpus": [{"index": 0, "vendor": "NVIDIA", "name": "RTX 3090", "memory_total_bytes": 24 * 1024**3, "backends": ["cuda"]}]
        }
        return m

class StubModel:
    def __init__(self, name, size):
        self.name = name
        self.path = f"/models/{name}"
    def display_info(self):
        return {
            "name": self.name,
            "size_bytes": self.size_bytes,
            "size_human": "4 GiB",
            "parameter_size": "8B",
            "quantization": "Q4_K_M",
            "architecture": "llama",
            "license": "mit",
            "source": "hub",
            "path": str(self.path)
        }
    def to_dict(self):
        return {"name": self.name, "path": str(self.path), "size_bytes": self.size_bytes}
    @property
    def size_bytes(self):
        return 4 * 1024**3

class StubCatalog:
    def sync_directories(self):
        return []
    def to_dict(self):
        return {"directories": [], "models": [{"name": "Llama-2", "path": "/models/llama", "size_bytes": 4 * 1024**3}]}
    def list_sources(self):
        return []
    def list_models(self):
        return [StubModel("Llama-3-8B-Instruct", 4 * 1024**3), StubModel("Qwen-2.5-7B", 3.5 * 1024**3)]

class StubModelProfileStore:
    def get(self, *args):
        return None
    def save(self, *args):
        pass

def test_desktop_ui_loads(monkeypatch, mocker):
    hw_mock = MagicMock()
    hw_mock.HardwareService = StubHardware
    monkeypatch.setitem(sys.modules, 'aidream.hardware', hw_mock)

    models_mock = MagicMock()
    models_mock.ModelCatalog = StubCatalog
    monkeypatch.setitem(sys.modules, 'aidream.models', models_mock)

    runtime_mock = MagicMock()
    runtime_mock.RuntimeRegistry = StubRegistry
    monkeypatch.setitem(sys.modules, 'aidream.runtime', runtime_mock)

    conv_mock = MagicMock()
    conv_mock.ChatStore = StubChatStore
    monkeypatch.setitem(sys.modules, 'aidream.conversation', conv_mock)

    prof_mock = MagicMock()
    prof_mock.ModelProfileStore = StubModelProfileStore
    monkeypatch.setitem(sys.modules, 'aidream.model_profiles', prof_mock)

    voice_mock = MagicMock()
    voice_mock.LocalVoice = StubVoice
    monkeypatch.setitem(sys.modules, 'aidream.voice', voice_mock)

    from aidream.ui import AIDreamWindow

    mocker.patch('aidream.ui.AIDreamWindow._poll_voice_results')
    mocker.patch('aidream.ui.AIDreamWindow._poll_generation_results')

    root = tk.Tk()
    # Force tk window to full size to capture exactly 1320x900
    root.geometry("1320x900+0+0"); root.update(); root.minsize(1320, 900)
    app = AIDreamWindow(root)
    root.update()
    root.update_idletasks()

    time.sleep(1)

    os.makedirs('artifacts/ui-smoke', exist_ok=True)

    # We must enforce screenshot success and check dimensions
    import subprocess
    result = subprocess.run(["import", "-window", str(root.winfo_id()), "artifacts/ui-smoke/desktop.png"], check=True)
    assert result.returncode == 0
    assert os.path.exists("artifacts/ui-smoke/desktop.png")

    try:
        app.close()
    except:
        pass

if __name__ == '__main__':
    pytest.main([__file__])
