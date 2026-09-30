import unittest

from aidream.model_scheduler import LeaseRequest, ModelScheduler, SchedulerError, SchedulerErrorCode
from aidream.residency_control import ResidencyControlService
from aidream.runtime_adapters import FakeRuntimeAdapter


class ResidencyControlTests(unittest.TestCase):
    def setUp(self):
        self.adapter = FakeRuntimeAdapter(runtime_id="local")
        self.scheduler = ModelScheduler({"local": self.adapter})
        self.route_id = "route_abc123_chat"
        self.key = ("model-a", "local", None)
        self.allowlist = {self.route_id: self.key}
        self.control = ResidencyControlService(self.scheduler, route_allowlist=self.allowlist)
        lease = self.scheduler.acquire(LeaseRequest(
            "model-a", "local", {"model_id": "model-a"}, owner_id="run-1",
            orchestration_owned=True))
        self.scheduler.release(lease)

    def test_pin_unpin_are_semantic_and_never_load(self):
        result = self.control.apply(self.route_id, "pin")
        self.assertEqual(result["resident"]["state"], "idle")
        self.assertTrue(result["resident"]["pinned"])
        self.assertEqual(self.adapter.calls.count("load"), 1)

        result = self.control.apply(self.route_id, "unpin")
        self.assertFalse(result["resident"]["pinned"])
        self.assertEqual(self.adapter.calls.count("load"), 1)
        self.assertEqual(self.adapter.calls.count("unload"), 0)

    def test_unload_unloads_only_existing_allowlisted_resident(self):
        result = self.control.apply(self.route_id, "unload")
        self.assertIsNone(result["resident"])
        self.assertEqual(self.scheduler.residency(), ())
        self.assertEqual(self.adapter.calls.count("load"), 1)
        self.assertEqual(self.adapter.calls.count("unload"), 1)
        # A repeated unload is rejected as not resident and still cannot
        # result in a new load.
        with self.assertRaises(SchedulerError) as raised:
            self.control.apply(self.route_id, "unload")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.INVALID_LEASE)
        self.assertEqual(self.adapter.calls.count("load"), 1)

    def test_route_ids_are_server_owned_and_allowlist_cannot_be_mutated(self):
        with self.assertRaises(SchedulerError) as raised:
            self.control.apply("model-a", "pin")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.NOT_ALLOWED)
        self.allowlist["new-route"] = ("other-model", "local", None)
        with self.assertRaises(SchedulerError) as raised:
            self.control.apply("new-route", "pin")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.NOT_ALLOWED)

    def test_pinned_or_busy_residents_cannot_be_unloaded(self):
        self.control.apply(self.route_id, "pin")
        with self.assertRaises(SchedulerError) as raised:
            self.control.apply(self.route_id, "unload")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.BUSY)
        self.control.apply(self.route_id, "unpin")

        lease = self.scheduler.acquire(LeaseRequest(
            "model-a", "local", {"model_id": "model-a"},
            owner_id="run-2", orchestration_owned=True))
        with self.assertRaises(SchedulerError) as raised:
            self.control.apply(self.route_id, "unload")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.BUSY)
        self.scheduler.release(lease)

    def test_unowned_resident_and_invalid_contract_are_rejected(self):
        other = ModelScheduler({"local": FakeRuntimeAdapter(runtime_id="local")})
        lease = other.acquire(LeaseRequest("model-a", "local", {"model_id": "model-a"}))
        other.release(lease)
        control = ResidencyControlService(other, route_allowlist={self.route_id: self.key})
        with self.assertRaises(SchedulerError) as raised:
            control.apply(self.route_id, "pin")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.NOT_ALLOWED)
        with self.assertRaises(ValueError):
            ResidencyControlService(self.scheduler, route_allowlist={"../route": self.key})
        with self.assertRaises(ValueError):
            self.control.apply(self.route_id, "load")


if __name__ == "__main__":
    unittest.main()
