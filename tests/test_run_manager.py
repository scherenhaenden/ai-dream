import threading
import tempfile
import time
import unittest

from aidream.artifacts.store import ArtifactStore
from aidream.run_manager import RunCancelled, RunManager, RunNotFound, RunStateError


def wait_terminal(manager, run_id, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = manager.get(run_id)
        if run["state"] in {"succeeded", "failed", "cancelled"}:
            return run
        time.sleep(0.005)
    raise AssertionError("run did not complete")


class RunManagerTests(unittest.TestCase):
    def test_creates_immutable_plan_runs_executor_and_journals_events(self):
        seen = []

        def execute(*, plan, cancel_event, emit):
            seen.append(plan)
            emit("node.started", {"node_id": "answer"})
            return [{"kind": "text", "text": "hello"}]

        manager = RunManager(executor=execute)
        try:
            plan = {"id": "plan-1", "nodes": [{"id": "answer"}]}
            run = manager.create(skill_id="chat.general", skill_version="1.0.0", plan=plan)
            plan["id"] = "mutated"
            final = wait_terminal(manager, run["id"])
            self.assertEqual(final["state"], "succeeded")
            self.assertEqual(final["plan"]["id"], "plan-1")
            self.assertEqual(final["outputs"][0]["text"], "hello")
            events = manager.events(run["id"])
            self.assertTrue(any(item["type"] == "node.started" for item in events))
            self.assertEqual(events[-1]["type"], "run.succeeded")
            self.assertEqual(manager.events(run["id"], after=events[0]["sequence"])[0]["sequence"], 2)
        finally:
            manager.close()

    def test_executor_can_receive_run_id_for_persisting_assistant_turns(self):
        observed = []

        def execute(*, plan, cancel_event, emit, run_id):
            observed.append(run_id)
            return []

        manager = RunManager(executor=execute)
        try:
            run = manager.create(skill_id="chat.general", skill_version="1.0.0", plan={})
            self.assertEqual(wait_terminal(manager, run["id"])["state"], "succeeded")
            self.assertEqual(observed, [run["id"]])
        finally:
            manager.close()

    def test_cancel_reaches_executor_and_runs_cleanup_callbacks(self):
        started = threading.Event()
        release_count = []
        owner_deleted = []

        class Store:
            def delete_owner(self, *args, **kwargs):
                owner_deleted.append((args, kwargs))

        def execute(*, plan, cancel_event, emit):
            started.set()
            while not cancel_event.wait(0.005):
                pass
            raise RunCancelled()

        manager = RunManager(executor=execute, artifact_store=Store(), release_leases=release_count.append)
        try:
            run = manager.create(skill_id="voice.transcribe", skill_version="1.0.0", plan={})
            self.assertTrue(started.wait(1))
            manager.cancel(run["id"])
            final = wait_terminal(manager, run["id"])
            self.assertEqual(final["state"], "cancelled")
            self.assertEqual(owner_deleted[0][0], ("run", run["id"]))
            self.assertEqual(owner_deleted[0][1], {})
            self.assertEqual(release_count, [run["id"]])
        finally:
            manager.close()

    def test_nonwaiting_close_keeps_active_run_and_leases_until_executor_stops(self):
        started = threading.Event()
        finish_runtime = threading.Event()
        released = []

        def execute(*, plan, cancel_event, emit):
            started.set()
            # Simulate a runtime callback that only returns after its own
            # cancellation hook has completed.
            finish_runtime.wait(2)
            return []

        manager = RunManager(executor=execute, release_leases=released.append)
        run = manager.create(skill_id="chat.general", skill_version="1", plan={})
        self.assertTrue(started.wait(1))
        manager.close(wait=False)
        self.assertEqual(manager.get(run["id"])["state"], "running")
        self.assertEqual(released, [])

        finish_runtime.set()
        final = wait_terminal(manager, run["id"])
        self.assertEqual(final["state"], "cancelled")
        self.assertEqual(released, [run["id"]])

    def test_normalized_failure_is_retained_without_traceback(self):
        manager = RunManager(executor=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("backend broke")))
        try:
            run = manager.create(skill_id="chat.general", skill_version="1", plan={})
            final = wait_terminal(manager, run["id"])
            self.assertEqual(final["state"], "failed")
            self.assertEqual(final["error"], {"kind": "internal_error", "message": "backend broke"})
            self.assertFalse(any("traceback" in str(event).lower() for event in manager.events(run["id"])))
        finally:
            manager.close()

    def test_event_journal_is_bounded_but_sequences_remain_monotonic(self):
        def execute(*, plan, cancel_event, emit):
            for index in range(6): emit("node.progress", {"index": index})
            return []

        manager = RunManager(executor=execute, max_events_per_run=3)
        try:
            run = manager.create(skill_id="chat.general", skill_version="1", plan={})
            wait_terminal(manager, run["id"])
            events = manager.events(run["id"])
            self.assertEqual(len(events), 3)
            self.assertEqual([item["sequence"] for item in events], sorted(item["sequence"] for item in events))
            self.assertGreater(events[0]["sequence"], 1)
        finally:
            manager.close()

    def test_active_run_limit_and_unknown_ids(self):
        block = threading.Event()
        manager = RunManager(executor=lambda **kwargs: block.wait(1), max_active_runs=1)
        try:
            first = manager.create(skill_id="chat.general", skill_version="1", plan={})
            with self.assertRaises(RunStateError):
                manager.create(skill_id="chat.general", skill_version="1", plan={})
            with self.assertRaises(RunNotFound):
                manager.get("missing")
            manager.cancel(first["id"])
        finally:
            block.set()
            manager.close()

    def test_binary_outputs_become_run_owned_artifact_envelopes_and_are_readable(self):
        payloads = {
            "image": (b"image-bytes", "image/png", "preview.png"),
            "audio": (b"audio-bytes", "audio/wav", "preview.wav"),
            "document": (b"pdf-bytes", "application/pdf", "report.pdf"),
        }
        raw_outputs = [
            {"kind": kind, "media_type": media_type, "name": name,
             "content_bytes": payload, "metadata": {"source": "fake-runtime"}}
            for kind, (payload, media_type, name) in payloads.items()
        ]
        with tempfile.TemporaryDirectory() as root:
            store = ArtifactStore(root, session_ttl_seconds=120)
            manager = RunManager(executor=lambda **kwargs: raw_outputs, artifact_store=store)
            try:
                run = manager.create(skill_id="media.preview", skill_version="1.0.0", plan={})
                final = wait_terminal(manager, run["id"])
                self.assertEqual(final["state"], "succeeded")
                self.assertEqual([item["kind"] for item in final["outputs"]], ["image", "audio", "document"])
                for output in final["outputs"]:
                    envelope = output["artifact"]
                    self.assertEqual(envelope["owner"], {"type": "run", "id": run["id"]})
                    self.assertEqual(envelope["lifetime"], "session")
                    self.assertEqual(store.read(envelope["id"], owner_type="run", owner_id=run["id"]),
                                     payloads[output["kind"]][0])
                    self.assertNotIn("content_bytes", output)
                events = manager.events(run["id"])
                produced = [event for event in events if event["type"] == "artifact.produced"]
                self.assertEqual(len(produced), 3)
                self.assertTrue(all("content_bytes" not in event["data"] for event in produced))
                self.assertEqual(store.delete_owner("run", run["id"], lifetime="ephemeral"), 0)
            finally:
                manager.close()
                store.close()


if __name__ == "__main__":
    unittest.main()
