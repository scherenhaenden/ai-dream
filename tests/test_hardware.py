import unittest
from unittest.mock import patch

from aidream.hardware import HardwareService, GPUInfo, _merge_gpus, _vulkan


class HardwareTests(unittest.TestCase):
    def test_detect_returns_dict_friendly_snapshot(self):
        with patch("aidream.hardware._nvidia", return_value=[]), \
             patch("aidream.hardware._rocm", return_value=[]), \
             patch("aidream.hardware._sysfs_gpus", return_value=[GPUInfo(0, "Intel", "Intel GPU")]):
            snapshot = HardwareService().detect()
        result = snapshot.to_dict()
        self.assertEqual(set(result), {"cpu", "ram", "os", "gpus"})
        self.assertGreaterEqual(result["cpu"]["logical_cores"], 1)
        self.assertEqual(result["gpus"][0]["vendor"], "Intel")
        self.assertEqual(result["gpus"][0]["backends"], [])

    def test_mixed_provider_results_are_both_preserved(self):
        devices = _merge_gpus(
            [GPUInfo(0, "NVIDIA", "RTX 4090", 24, 12, ["cuda"]),
             GPUInfo(0, "AMD", "Radeon RX 7900", 20, 10, ["rocm"])],
            [], [],
        )
        self.assertEqual([gpu.vendor for gpu in devices], ["NVIDIA", "AMD"])
        self.assertEqual([gpu.index for gpu in devices], [0, 1])

    def test_exact_matches_merge_capabilities_without_collapsing_repeated_models(self):
        providers = [GPUInfo(0, "NVIDIA", "RTX 4090", backends=["cuda"]),
                     GPUInfo(1, "NVIDIA", "RTX 4090", backends=["cuda"])]
        pci = [GPUInfo(0, "NVIDIA", "RTX 4090"), GPUInfo(1, "NVIDIA", "RTX 4090")]
        vulkan = [GPUInfo(0, "NVIDIA", "RTX 4090", backends=["vulkan"]),
                  GPUInfo(1, "NVIDIA", "RTX 4090", backends=["vulkan"])]
        devices = _merge_gpus(providers, pci, vulkan)
        self.assertEqual(len(devices), 2)
        self.assertTrue(all(set(gpu.backends) == {"cuda", "vulkan"} for gpu in devices))

    def test_vulkan_only_reports_enumerated_physical_devices(self):
        summary = """Devices:\n========\nGPU0:\n\n    apiVersion = 1.3.0\n    deviceName = NVIDIA RTX 4090\n    vendorID = 0x10de\nGPU1:\n\n    deviceName = Intel Arc A770\n    vendorID = 0x8086\n"""
        with patch("aidream.hardware._run", return_value=summary):
            devices = _vulkan()
        self.assertEqual([(d.vendor, d.name, d.backends) for d in devices],
                         [("NVIDIA", "NVIDIA RTX 4090", ["vulkan"]),
                          ("Intel", "Intel Arc A770", ["vulkan"])])

    def test_vulkan_empty_when_no_devices_are_enumerated(self):
        with patch("aidream.hardware._run", return_value="Devices:\n========\n"):
            self.assertEqual(_vulkan(), [])


if __name__ == "__main__":
    unittest.main()
