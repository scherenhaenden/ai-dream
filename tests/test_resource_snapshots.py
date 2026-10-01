import unittest
import time
from dataclasses import dataclass

from aidream.hardware import CPUInfo, GPUInfo, HardwareSnapshot, MemoryInfo, OSInfo
from aidream.model_scheduler import LeaseRequest, ModelScheduler
from aidream.resource_snapshots import ResourceSnapshotService
from aidream.runtime_adapters import FakeRuntimeAdapter


@dataclass
class FakeHardware:
    snapshot: object

    def detect(self):
        return self.snapshot


def make_scheduler():
    adapter = FakeRuntimeAdapter(runtime_id="runtime")
    scheduler = ModelScheduler({"runtime": adapter})
    return scheduler


class ResourceSnapshotServiceTest(unittest.TestCase):
    def test_combines_observed_hardware_and_scheduler_residency(self):
        hardware = HardwareSnapshot(
            CPUInfo("CPU", 16, 8), MemoryInfo(32_000, 20_000),
            OSInfo("Linux", "6", "", "x86_64"),
            [GPUInfo(0, "AMD", "GPU", 16_000, 9_000, ["rocm"])],
        )
        scheduler = make_scheduler()
        lease = scheduler.acquire(LeaseRequest("model-a", "runtime", {"model_id": "a"},
                                               estimated_ram_bytes=1_000,
                                               estimated_vram_bytes=2_000, owner_id="run"))
        service = ResourceSnapshotService(scheduler, FakeHardware(hardware), now=lambda: time.monotonic() + 1)
        payload = service.resources()
        resources = payload["resources"]
        self.assertEqual(payload["status"], "observed")
        self.assertEqual(resources["ram"], {
            "total_bytes": 32_000, "total_status": "observed",
            "available_bytes": 20_000, "available_status": "observed", "metrics_status": "observed"})
        self.assertEqual(resources["gpus"][0]["free_vram_bytes"], 9_000)
        self.assertEqual(resources["gpus"][0]["runtime_device_mappings"], {"status": "unknown", "items": []})
        self.assertEqual(resources["loaded_models"][0]["model_id"], "model-a")
        self.assertEqual(resources["loaded_models"][0]["state"], "busy")
        self.assertEqual(resources["loaded_models"][0]["estimated_vram_bytes"], 2_000)
        self.assertEqual(resources["active_lease_count"], 1)
        self.assertEqual(resources["pending_reservations_status"], "not_supported")
        self.assertIsNone(resources["temporary_disk"]["available_bytes"])
        scheduler.release(lease)

    def test_unreported_hardware_memory_stays_null_and_unknown(self):
        hardware = HardwareSnapshot(
            CPUInfo("CPU", 4, None), MemoryInfo(None, None),
            OSInfo("Linux", "", "", "x86_64"),
            [GPUInfo(0, "Unknown", "Adapter", None, None, [])],
        )
        payload = ResourceSnapshotService(make_scheduler(), FakeHardware(hardware)).resources()
        resources = payload["resources"]
        self.assertEqual(payload["status"], "unknown")
        self.assertIsNone(resources["ram"]["total_bytes"])
        self.assertEqual(resources["ram"]["total_status"], "unknown")
        gpu = resources["gpus"][0]
        self.assertIsNone(gpu["total_vram_bytes"])
        self.assertIsNone(gpu["free_vram_bytes"])
        self.assertEqual(gpu["metrics_status"], "unknown")
        self.assertEqual(resources["loaded_models"], [])

    def test_probe_failure_does_not_fabricate_zeroes(self):
        def failing_probe():
            raise OSError("unavailable")

        payload = ResourceSnapshotService(make_scheduler(), failing_probe).resources()
        self.assertEqual(payload["status"], "unknown")
        self.assertIn("OSError", payload["hardware_error"])
        self.assertIsNone(payload["resources"]["ram"]["available_bytes"])
        self.assertEqual(payload["resources"]["gpus"], [])


if __name__ == "__main__":
    unittest.main()
