"""UI shutdown coordination tests without creating a Tk display or model process."""

import threading
import time
import unittest

from aidream.ui import AIDreamWindow


class FakeRoot:
    def __init__(self):
        self.callbacks = []
        self.destroyed = False
        self.title_text = ""

    def title(self, value):
        self.title_text = value

    def after(self, _delay, callback):
        self.callbacks.append(callback)

    def destroy(self):
        self.destroyed = True


class FakeBackend:
    def __init__(self):
        self.unload_started = threading.Event()
        self.unload_finished = threading.Event()

    def unload(self):
        self.unload_started.set()
        time.sleep(0.15)
        self.unload_finished.set()


class UILifecycleTests(unittest.TestCase):
    def _window(self, backend):
        window = AIDreamWindow.__new__(AIDreamWindow)
        window.root = FakeRoot()
        window._closing = False
        window._ptt_worker = None
        window._ptt_path = None
        window._speech_worker = None
        window._generation_event = None
        window._pending_generation = None
        window.loaded_backend = backend
        window.loaded_key = ("loaded",)
        return window

    def test_close_keeps_ui_responsive_while_runtime_is_stopped(self):
        backend = FakeBackend()
        window = self._window(backend)
        started_at = time.monotonic()

        window.close()

        self.assertLess(time.monotonic() - started_at, 0.1)
        self.assertTrue(backend.unload_started.wait(1))
        self.assertFalse(window.root.destroyed)
        self.assertEqual(window.root.title_text, "AI Dream — Closing")
        self.assertEqual(len(window.root.callbacks), 1)

        self.assertTrue(backend.unload_finished.wait(1))
        window.root.callbacks.pop()()
        self.assertTrue(window.root.destroyed)

    def test_repeated_close_does_not_start_duplicate_cleanup(self):
        backend = FakeBackend()
        window = self._window(backend)
        window.close()
        callback_count = len(window.root.callbacks)

        window.close()

        self.assertEqual(len(window.root.callbacks), callback_count)
        self.assertTrue(backend.unload_finished.wait(1))


if __name__ == "__main__":
    unittest.main()
