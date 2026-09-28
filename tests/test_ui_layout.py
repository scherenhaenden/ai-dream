"""Structural desktop layout checks that run without a display or runtime."""

import inspect
import unittest

from aidream.ui import AIDreamWindow


class DesktopLayoutTests(unittest.TestCase):
    def test_chat_and_voice_controls_use_rows_instead_of_overflowing_left_packs(self):
        source = inspect.getsource(AIDreamWindow._build)
        groups = (
            ("chat_tools = ttk.Frame(right)", "voice_row = ttk.Frame(right)"),
            ("voice_row = ttk.Frame(right)", "voice_input_row = ttk.Frame(right)"),
            ("voice_input_row = ttk.Frame(right)", "ptt_row = ttk.Frame(right)"),
        )
        for start, end in groups:
            with self.subTest(group=start):
                block = source.split(start, 1)[1].split(end, 1)[0]
                self.assertIn(".grid(", block)
                self.assertNotIn("pack(side=tk.LEFT", block)

    def test_chat_area_is_bounded_scrollable_and_panel_status_wraps(self):
        source = inspect.getsource(AIDreamWindow._build)
        self.assertIn("Text(chat_frame, height=8", source)
        self.assertIn("ttk.Scrollbar(chat_frame", source)
        self.assertIn('right.bind("<Configure>", self._resize_right_panel', source)


if __name__ == "__main__":
    unittest.main()
