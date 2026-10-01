from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from aidream.run_journal import RunJournalStore
from aidream.run_manager import RunManager


def _record(run_id="a" * 32, *, state="succeeded", events=None, chat_id=None):
    return {
        "id": run_id, "skill_id": "chat.general", "skill_version": "1.0.0",
        "plan": {"plan_id": "plan-safe", "input_kinds": {"prompt": "text"}},
        "state": state, "created_at": 1.0, "started_at": 1.1,
        "completed_at": 1.2 if state in {"succeeded", "failed", "cancelled"} else None,
        "current_nodes": [], "outputs": [], "error": None,
        "events": events or [], "next_sequence": 1, "chat_id": chat_id,
    }


def _event(run_id, sequence=1, event_type="run.created", data=None):
    return {"run_id": run_id, "sequence": sequence, "timestamp": 1.0,
            "type": event_type, "data": data or {}}


def _wait_terminal(manager, run_id):
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        run = manager.get(run_id)
        if run["state"] in {"succeeded", "failed", "cancelled"}:
            return run
        time.sleep(0.005)
    raise AssertionError("run did not complete")


class RunJournalTests(unittest.TestCase):
    def test_terminal_run_and_events_survive_manager_restart_without_input_or_output_text(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "runs.json"
            store = RunJournalStore(path)

            def execute(*, emit, run_id, **_kwargs):
                emit("node.failed", {"kind": "internal_error", "message": "ERROR_PROMPT_MARKER",
                                     "query": "ERROR_QUERY_MARKER", "instruction": "ERROR_INSTRUCTION_MARKER",
                                     "transcript": "ERROR_TRANSCRIPT_MARKER",
                                     "value": "EVENT_VALUE_MARKER", "answer": "EVENT_ANSWER_MARKER",
                                     "response": "EVENT_RESPONSE_MARKER"})
                emit("artifact.produced", {"artifact": {"id": "art_safe", "kind": "image",
                     "owner": {"type": "run", "id": run_id},
                     "storage": {"key": "ARTIFACT_STORAGE_TOKEN_MARKER"},
                     "metadata": {"base64": "ARTIFACT_BYTES_MARKER",
                                  "access_token": "ARTIFACT_ACCESS_TOKEN_MARKER"}}})
                return [{"kind": "text", "text": "private generated answer",
                         "value": "OUTPUT_VALUE_MARKER", "answer": "OUTPUT_ANSWER_MARKER"}]

            manager = RunManager(executor=execute, journal_store=store)
            run = manager.create(
                skill_id="chat.general", skill_version="1.0.0",
                plan={"plan_id": "plan-safe", "prompt": "private user prompt",
                      "instruction": "PLAN_INSTRUCTION_MARKER", "query": "PLAN_QUERY_MARKER"},
                chat_id="b" * 32,
            )
            finished = _wait_terminal(manager, run["id"])
            self.assertTrue(finished["durable"])
            self.assertEqual(finished["chat_id"], "b" * 32)
            manager.close()

            persisted = path.read_text()
            self.assertNotIn("private user prompt", persisted)
            self.assertNotIn("private generated answer", persisted)
            for marker in ("ERROR_PROMPT_MARKER", "ERROR_QUERY_MARKER", "ERROR_INSTRUCTION_MARKER",
                           "ERROR_TRANSCRIPT_MARKER", "PLAN_INSTRUCTION_MARKER", "PLAN_QUERY_MARKER",
                           "EVENT_VALUE_MARKER", "EVENT_ANSWER_MARKER", "EVENT_RESPONSE_MARKER",
                           "OUTPUT_VALUE_MARKER", "OUTPUT_ANSWER_MARKER", "ARTIFACT_STORAGE_TOKEN_MARKER",
                           "ARTIFACT_BYTES_MARKER", "ARTIFACT_ACCESS_TOKEN_MARKER"):
                self.assertNotIn(marker, persisted)
            self.assertIn("details are omitted from durable history", persisted)
            restored_store = RunJournalStore(path)
            restored = RunManager(executor=lambda **kwargs: [], journal_store=restored_store)
            try:
                snapshot = restored.get(run["id"])
                self.assertEqual(snapshot["state"], "succeeded")
                self.assertTrue(snapshot["recovered"])
                self.assertEqual(snapshot["chat_id"], "b" * 32)
                self.assertEqual(snapshot["outputs"], [])
                self.assertTrue(any(item["type"] == "run.succeeded" for item in restored.events(run["id"])))
            finally:
                restored.close()

    def test_active_run_is_terminalized_instead_of_resumed_after_restart(self):
        with tempfile.TemporaryDirectory() as root:
            run_id = "c" * 32
            store = RunJournalStore(Path(root) / "runs.json")
            store.replace_all([_record(run_id, state="running", events=[
                _event(run_id, 1), _event(run_id, 2, "run.started"),
            ])])

            manager = RunManager(executor=lambda **kwargs: self.fail("recovered work must not execute"),
                                 journal_store=RunJournalStore(Path(root) / "runs.json"))
            try:
                recovered = manager.get(run_id)
                self.assertEqual(recovered["state"], "failed")
                self.assertEqual(recovered["error"]["kind"], "process_restarted")
                self.assertIn("not resumed", recovered["error"]["message"])
                self.assertTrue(recovered["recovered"])
                self.assertEqual(manager.events(run_id)[-1]["type"], "run.failed")
            finally:
                manager.close()

    def test_event_count_chat_id_and_artifact_ownership_are_validated(self):
        with tempfile.TemporaryDirectory() as root:
            run_id = "d" * 32
            store = RunJournalStore(Path(root) / "runs.json", max_events_per_run=1)
            with self.assertRaisesRegex(ValueError, "event limit"):
                store.replace_all([_record(run_id, events=[_event(run_id, 1), _event(run_id, 2)])])
            with self.assertRaisesRegex(ValueError, "artifact owned by another run"):
                store.replace_all([_record(run_id, events=[_event(run_id, data={
                    "artifact": {"owner": {"type": "run", "id": "e" * 32}}
                })])])
            manager = RunManager(executor=lambda **kwargs: [], journal_store=store)
            try:
                with self.assertRaisesRegex(ValueError, "chat_id"):
                    manager.create(skill_id="chat.general", skill_version="1", plan={}, chat_id="not-a-chat")
            finally:
                manager.close()

    def test_v1_records_migrate_additively_to_v2_without_inventing_chat_association(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "runs.json"
            store = RunJournalStore(path)
            row = _record(events=[_event("a" * 32)])
            store.replace_all([row])
            encoded = json.loads(path.read_text())
            encoded["schema_version"] = 1
            encoded["runs"][0].pop("chat_id")
            path.write_text(json.dumps(encoded))
            os.chmod(path, 0o600)

            migrated = RunJournalStore(path)
            self.assertIsNone(migrated.records()[0]["chat_id"])
            self.assertEqual(json.loads(path.read_text())["schema_version"], 2)

    def test_file_permissions_are_private_and_parent_permissions_are_not_relaxed(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "runs.json"
            store = RunJournalStore(path)
            store.replace_all([_record(events=[_event("a" * 32)])])
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                os.chmod(root, 0o755)
                with self.assertRaisesRegex(OSError, "must be private"):
                    RunJournalStore(Path(root) / "unsafe.json")
                self.assertEqual(Path(root).stat().st_mode & 0o777, 0o755)

    def test_record_count_event_owner_and_total_bytes_are_bounded(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "runs.json"
            store = RunJournalStore(path, max_records=1)
            store.replace_all([_record(events=[_event("a" * 32)])])
            with self.assertRaisesRegex(ValueError, "record limit"):
                store.replace_all([_record(events=[_event("a" * 32)]), _record("b" * 32)])
            with self.assertRaisesRegex(ValueError, "owner"):
                store.replace_all([_record(events=[_event("b" * 32)])])
            with self.assertRaisesRegex(ValueError, "byte limit"):
                RunJournalStore(Path(root) / "small.json", max_bytes=100).replace_all(
                    [_record(events=[_event("a" * 32)])])

    def test_failed_atomic_replace_keeps_previous_journal_and_manager_degrades_visibly(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "runs.json"
            store = RunJournalStore(path)
            store.replace_all([_record(events=[_event("a" * 32)])])
            previous = path.read_bytes()
            with patch("aidream.run_journal.os.replace", side_effect=OSError("disk failure")):
                with self.assertRaises(OSError):
                    store.replace_all([_record("b" * 32, events=[_event("b" * 32)])])
            self.assertEqual(path.read_bytes(), previous)
            self.assertFalse(any(item.name.endswith(".tmp") for item in Path(root).iterdir()))

            class FailingJournal:
                max_records = 64
                def records(self): return []
                def replace_all(self, _rows): raise OSError("full disk")

            manager = RunManager(executor=lambda **kwargs: [], journal_store=FailingJournal())
            try:
                run = manager.create(skill_id="chat.general", skill_version="1", plan={})
                final = _wait_terminal(manager, run["id"])
                self.assertFalse(final["durable"])
                self.assertIn("may not survive restart", final["durability_error"])
            finally:
                manager.close()


if __name__ == "__main__":
    unittest.main()
