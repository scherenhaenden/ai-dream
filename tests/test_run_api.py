import time
import unittest

from aidream.http_api import APINotFound, APIUnavailable, ReadOnlyAPI
from aidream.run_manager import RunManager


class RunAPITests(unittest.TestCase):
    def test_list_detail_and_resumable_event_snapshot(self):
        manager = RunManager(executor=lambda **kwargs: [{"kind": "text", "text": "ok"}])
        api = ReadOnlyAPI.__new__(ReadOnlyAPI)
        api.run_manager = manager
        try:
            run = manager.create(skill_id="chat.general", skill_version="1.0.0", plan={"id": "p1"})
            deadline = time.monotonic() + 2
            while manager.get(run["id"])["state"] not in {"succeeded", "failed", "cancelled"}:
                if time.monotonic() > deadline: self.fail("run did not finish")
                time.sleep(0.005)
            self.assertEqual(api.get("/api/runs")[1]["data"]["runs"][0]["id"], run["id"])
            self.assertEqual(api.get(f"/api/runs/{run['id']}")[1]["data"]["run"]["state"], "succeeded")
            events = api.get(f"/api/runs/{run['id']}/events", "after=2")[1]["data"]["events"]
            self.assertTrue(events)
            self.assertGreater(events[0]["sequence"], 2)
            with self.assertRaises(APINotFound):
                api.get("/api/runs/" + "a" * 32)
        finally:
            manager.close()

    def test_run_listing_is_explicitly_unavailable_without_manager(self):
        api = ReadOnlyAPI.__new__(ReadOnlyAPI)
        with self.assertRaises(APIUnavailable):
            api.get("/api/runs")


if __name__ == "__main__":
    unittest.main()
