import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aidream.conversation import ChatStore


class ChatStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = ChatStore(self.temp.name)

    def test_round_trip_append_and_derive_title(self):
        session = self.store.create()
        session = self.store.append(session["id"], "user", "First question\ncontinued")
        session = self.store.append(session["id"], "assistant", "Answer")
        loaded = self.store.load(session["id"])
        self.assertEqual(loaded["title"], "First question")
        self.assertEqual([m["role"] for m in loaded["messages"]], ["user", "assistant"])
        self.assertEqual(self.store.list_sessions()[0]["id"], session["id"])

    def test_rename_and_reject_empty_title(self):
        session = self.store.create()
        renamed = self.store.rename(session["id"], "  renamed  ")
        self.assertEqual(renamed["title"], "renamed")
        with self.assertRaises(ValueError):
            self.store.rename(session["id"], "  ")

    def test_delete_removes_only_named_session(self):
        first, second = self.store.create(), self.store.create()
        self.store.delete(first["id"])
        self.assertEqual([item["id"] for item in self.store.list_sessions()], [second["id"]])
        with self.assertRaises(FileNotFoundError):
            self.store.delete(first["id"])

    def test_export_writes_readable_markdown(self):
        session = self.store.create("Local chat")
        self.store.append(session["id"], "user", "Hello")
        self.store.append(session["id"], "assistant", "Hi there")
        destination = Path(self.temp.name) / "exports" / "chat.md"
        self.assertEqual(self.store.export(session["id"], destination), destination.resolve())
        content = destination.read_text(encoding="utf-8")
        self.assertIn("# Local chat", content)
        self.assertIn("## You\n\nHello", content)
        self.assertIn("## Assistant\n\nHi there", content)

    def test_failed_replace_preserves_existing_file_and_cleans_temp(self):
        session = self.store.create()
        path = Path(self.temp.name) / f"{session['id']}.json"
        before = path.read_text(encoding="utf-8")
        with patch("aidream.conversation.os.replace", side_effect=OSError("simulated")):
            with self.assertRaises(OSError):
                self.store.rename(session["id"], "broken update")
        self.assertEqual(path.read_text(encoding="utf-8"), before)
        self.assertEqual(list(Path(self.temp.name).glob(".ai-dream-*.tmp")), [])

    def test_invalid_session_json_is_ignored_by_listing_and_rejected_by_load(self):
        broken_id = "a" * 32
        (Path(self.temp.name) / f"{broken_id}.json").write_text("{", encoding="utf-8")
        self.assertEqual(self.store.list_sessions(), [])
        with self.assertRaises(ValueError):
            self.store.load(broken_id)

    def test_rejects_invalid_ids_and_messages(self):
        for value in ("../outside", "", "a" * 31):
            with self.assertRaises(ValueError):
                self.store.load(value)
        session = self.store.create()
        with self.assertRaises(ValueError):
            self.store.append(session["id"], "tool", "payload")
        with self.assertRaises(ValueError):
            self.store.append(session["id"], "user", " ")


if __name__ == "__main__":
    unittest.main()
