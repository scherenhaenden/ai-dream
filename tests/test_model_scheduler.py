import threading
import time
import unittest

from aidream.model_scheduler import (
    LeaseRequest,
    ModelScheduler,
    ResourceSnapshot,
    SchedulerError,
    SchedulerErrorCode,
)
from aidream.runtime_adapters import (
    CompatibilityResult,
    HealthState,
    FakeRuntimeAdapter,
    PreparedLaunch,
    RuntimeDescriptor,
    RuntimeHandle,
    RuntimeOutput,
    RuntimeRequest,
)


class FakeAdapter:
    def __init__(self, runtime_id="fake", *, load_gate=None):
        self.runtime_id = runtime_id
        self.load_gate = load_gate
        self.calls = []
        self.loads_in_flight = 0
        self.max_loads_in_flight = 0

    def probe(self):
        return RuntimeDescriptor(self.runtime_id, "fake", True, frozenset({"text.chat"}))

    def supports(self, manifest, profile=None):
        return CompatibilityResult(True)

    def prepare(self, manifest, profile=None):
        return PreparedLaunch(self.runtime_id, manifest, profile)

    def load(self, prepared):
        self.calls.append(("load", prepared.model))
        self.loads_in_flight += 1
        self.max_loads_in_flight = max(self.max_loads_in_flight, self.loads_in_flight)
        if self.load_gate:
            self.load_gate[0].set()
            self.load_gate[1].wait(2)
        time.sleep(0.005)
        self.loads_in_flight -= 1
        return RuntimeHandle(self.runtime_id, f"handle-{prepared.model}")

    def invoke(self, handle, request):
        return RuntimeOutput(request.operation, None)

    def cancel(self, handle, request_id=None):
        self.calls.append(("cancel", request_id))
        return True

    def unload(self, handle):
        self.calls.append(("unload", handle.token))

    def health(self, handle=None):
        return HealthState(True, True)


def req(model, vram, *, pin=False, owner=None):
    return LeaseRequest(model, "fake", {"model": model}, estimated_vram_bytes=vram,
                        pin=pin, owner_id=owner)


class ModelSchedulerTest(unittest.TestCase):
    def test_acquire_many_reserves_as_a_group_and_rolls_back_on_a_busy_member(self):
        scheduler = ModelScheduler({"fake": FakeAdapter(), "other": FakeAdapter("other")})
        active = scheduler.acquire(LeaseRequest("busy", "fake", {"model": "busy"}, owner_id="other-run"))
        with self.assertRaises(SchedulerError) as raised:
            scheduler.acquire_many((
                LeaseRequest("reserved-first", "other", {"model": "reserved-first"}, owner_id="parallel-run"),
                LeaseRequest("busy", "fake", {"model": "busy"}, owner_id="parallel-run"),
            ))
        self.assertEqual(SchedulerErrorCode.BUSY, raised.exception.code)
        leases = scheduler.active_leases()
        self.assertEqual(1, len(leases))
        self.assertEqual(active.lease_id, leases[0].lease_id)
        self.assertEqual(["busy"], [item.model_id for item in scheduler.residency()])
        self.assertIn(("unload", "handle-{'model': 'reserved-first'}"), scheduler.adapters["other"].calls)
        scheduler.release(active)

    def test_acquire_many_returns_all_leases_only_after_full_reservation(self):
        scheduler = ModelScheduler({"fake": FakeAdapter(), "other": FakeAdapter("other")})
        leases = scheduler.acquire_many((
            LeaseRequest("model-a", "fake", {"model": "a"}),
            LeaseRequest("model-b", "other", {"model": "b"}),
        ))
        self.assertEqual(2, len(leases))
        self.assertEqual(2, len(scheduler.active_leases()))
        for lease in reversed(leases):
            scheduler.release(lease)

    def test_sequential_requests_reuse_resident_and_release_leases(self):
        adapter = FakeAdapter()
        scheduler = ModelScheduler({"fake": adapter})
        first = scheduler.acquire(req("chat", 100))
        scheduler.release(first)
        second = scheduler.acquire(req("chat", 100))
        self.assertEqual(first.handle, second.handle)
        self.assertEqual([call[0] for call in adapter.calls], ["load"])
        self.assertEqual(len(scheduler.active_leases()), 1)
        scheduler.release(second)

    def test_single_resident_runtime_unloads_previous_model_before_switching(self):
        adapter = FakeRuntimeAdapter(runtime_id="runtime")
        scheduler = ModelScheduler({"runtime": adapter})
        first = scheduler.acquire(LeaseRequest("model-a", "runtime", {"model_id": "a"}, owner_id="run-a"))
        scheduler.release(first)
        second = scheduler.acquire(LeaseRequest("model-b", "runtime", {"model_id": "b"}, owner_id="run-b"))
        residents = scheduler.residency()
        self.assertEqual([item.model_id for item in residents], ["model-b"])
        self.assertTrue(adapter.loaded)
        self.assertEqual(adapter.calls.count("load"), 2)
        self.assertEqual(adapter.calls.count("unload"), 1)
        scheduler.release(second)
        self.assertEqual(scheduler.residency()[0].state, "idle")

    def test_lru_evicts_only_idle_unpinned_model_to_preserve_headroom(self):
        adapter = FakeAdapter()
        resources = {"free": 400}

        def snapshot():
            return ResourceSnapshot(vram_total_bytes=1000, vram_available_bytes=resources["free"])

        scheduler = ModelScheduler({"fake": adapter}, resource_snapshot=snapshot,
                                   vram_headroom_bytes=100, vram_headroom_ratio=0)
        lease = scheduler.acquire(req("old", 300))
        scheduler.release(lease)
        # Simulate the measured free VRAM recovered when the fake adapter unloads.
        original_unload = adapter.unload

        def unload(handle):
            original_unload(handle)
            resources["free"] += 300

        adapter.unload = unload
        next_lease = scheduler.acquire(req("specialist", 400))
        self.assertEqual([r.model_id for r in scheduler.residency()], ["specialist"])
        self.assertIn(("unload", "handle-{'model': 'old'}"), adapter.calls)
        scheduler.release(next_lease)

    def test_pinned_or_busy_residency_is_never_evicted(self):
        adapter = FakeAdapter()
        scheduler = ModelScheduler({"fake": adapter},
                                   resource_snapshot=lambda: ResourceSnapshot(
                                       vram_total_bytes=1000, vram_available_bytes=400),
                                   vram_headroom_bytes=100, vram_headroom_ratio=0)
        pinned = scheduler.acquire(req("pinned", 300, pin=True))
        scheduler.release(pinned)
        with self.assertRaises(SchedulerError) as raised:
            scheduler.acquire(req("new", 400))
        # A single-resident runtime must refuse to replace a pinned model.
        self.assertEqual(raised.exception.code, SchedulerErrorCode.BUSY)
        self.assertEqual([r.model_id for r in scheduler.residency()], ["pinned"])
        with self.assertRaises(SchedulerError) as raised:
            scheduler.unload("pinned", "fake")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.BUSY)

        busy_scheduler = ModelScheduler({"fake": FakeAdapter()},
                                        resource_snapshot=lambda: ResourceSnapshot(
                                            vram_total_bytes=1000, vram_available_bytes=400),
                                        vram_headroom_bytes=100, vram_headroom_ratio=0)
        active = busy_scheduler.acquire(req("active", 300))
        with self.assertRaises(SchedulerError) as raised:
            busy_scheduler.acquire(req("other", 400))
        # The active lease owns the runtime, so a second model cannot displace it.
        self.assertEqual(raised.exception.code, SchedulerErrorCode.BUSY)
        self.assertEqual(busy_scheduler.residency()[0].lease_count, 1)
        busy_scheduler.release(active)

    def test_cancel_releases_lease_even_when_cancel_callback_fails(self):
        adapter = FakeAdapter()

        def fail_cancel(handle, request_id=None):
            adapter.calls.append(("cancel", request_id))
            raise RuntimeError("cancel failed")

        adapter.cancel = fail_cancel
        scheduler = ModelScheduler({"fake": adapter})
        lease = scheduler.acquire(req("chat", 10, owner="run-1"))
        with self.assertRaises(SchedulerError) as raised:
            scheduler.cancel(lease, "request-1")
        self.assertEqual(raised.exception.code, SchedulerErrorCode.LIFECYCLE_FAILED)
        self.assertEqual(scheduler.active_leases(), ())
        self.assertEqual(scheduler.residency()[0].state, "idle")
        self.assertEqual(scheduler.release_owner("run-1"), 0)

    def test_orchestration_pin_and_unload_require_allowlisted_owned_resident(self):
        adapter = FakeAdapter()
        scheduler = ModelScheduler({"fake": adapter})
        key = ("model-a", "fake", None)
        lease = scheduler.acquire(LeaseRequest(
            "model-a", "fake", {"model": "model-a"}, owner_id="run-1",
            orchestration_owned=True))
        scheduler.release(lease)

        with self.assertRaises(SchedulerError) as raised:
            scheduler.set_orchestration_pin("model-a", "fake", pinned=True,
                                            allowed_residents={("other", "fake", None)})
        self.assertEqual(raised.exception.code, SchedulerErrorCode.NOT_ALLOWED)
        scheduler.set_orchestration_pin("model-a", "fake", pinned=True,
                                        allowed_residents={key})
        self.assertTrue(scheduler.residency()[0].pinned)
        with self.assertRaises(SchedulerError) as raised:
            scheduler.unload_orchestration_resident("model-a", "fake", allowed_residents={key})
        self.assertEqual(raised.exception.code, SchedulerErrorCode.BUSY)
        scheduler.set_orchestration_pin("model-a", "fake", pinned=False,
                                        allowed_residents={key})
        scheduler.unload_orchestration_resident("model-a", "fake", allowed_residents={key})
        self.assertEqual(scheduler.residency(), ())
        self.assertEqual([call[0] for call in adapter.calls], ["load", "unload"])

    def test_orchestration_controls_reject_unowned_and_unallowlisted_residents(self):
        scheduler = ModelScheduler({"fake": FakeAdapter()})
        lease = scheduler.acquire(req("generic", 10))
        scheduler.release(lease)
        key = ("generic", "fake", None)
        with self.assertRaises(SchedulerError) as raised:
            scheduler.set_orchestration_pin("generic", "fake", pinned=True,
                                            allowed_residents={key})
        self.assertEqual(raised.exception.code, SchedulerErrorCode.NOT_ALLOWED)
        with self.assertRaises(ValueError):
            scheduler.set_orchestration_pin("generic", "fake", pinned=True,
                                            allowed_residents=set())

    def test_mutating_loads_are_serialized_across_threads(self):
        entered, resume = threading.Event(), threading.Event()
        adapter = FakeAdapter(load_gate=(entered, resume))
        scheduler = ModelScheduler({"fake": adapter})
        results = []
        errors = []

        def acquire(model):
            try:
                results.append(scheduler.acquire(req(model, 10)))
            except SchedulerError as exc:
                errors.append(exc)

        first = threading.Thread(target=acquire, args=("one",))
        second = threading.Thread(target=acquire, args=("two",))
        first.start()
        self.assertTrue(entered.wait(1))
        second.start()
        time.sleep(0.02)
        self.assertEqual(adapter.max_loads_in_flight, 1)
        resume.set()
        first.join(2)
        second.join(2)
        self.assertFalse(first.is_alive() or second.is_alive())
        self.assertEqual(adapter.max_loads_in_flight, 1)
        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].code, SchedulerErrorCode.BUSY)
        for lease in results:
            scheduler.release(lease)


if __name__ == "__main__":
    unittest.main()
