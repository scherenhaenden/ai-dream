import unittest
from unittest.mock import patch

from aidream.hardware import HardwareService, GPUInfo, _lspci_names, _merge_gpus, _nvidia, _vulkan


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

    def test_bdf_merges_different_provider_and_pci_names_and_keeps_sibling_cards(self):
        providers = [GPUInfo(0, "AMD", "AMD Radeon RX 9070 XT", backends=["rocm"], pci_address="0000:0d:00.0"),
                     GPUInfo(1, "AMD", "AMD Radeon RX 9070 XT", backends=["rocm"], pci_address="0000:0e:00.0")]
        pci = [GPUInfo(0, "AMD", "Advanced Micro Devices Navi 48", pci_address="0000:0d:00.0"),
               GPUInfo(1, "AMD", "Advanced Micro Devices Navi 48", pci_address="0000:0e:00.0")]
        vulkan = [GPUInfo(0, "AMD", "AMD Radeon RX 9070 XT", backends=["vulkan"], pci_address="0000:0d:00.0")]
        devices = _merge_gpus(providers, pci, vulkan)
        self.assertEqual(len(devices), 2)
        self.assertEqual([gpu.pci_address for gpu in devices], ["0000:0d:00.0", "0000:0e:00.0"])
        self.assertEqual(devices[0].backends, ["rocm", "vulkan"])

    def test_vendor_device_ids_merge_vulkan_when_bdf_is_unavailable(self):
        # Two identical cards have no BDF in the Vulkan summary. Match IDs
        # one-to-one so both physical devices remain, without retaining duplicates.
        pci = [GPUInfo(0, "AMD", "Advanced Micro Devices Navi 48", pci_address="0000:0d:00.0",
                       pci_vendor_id=0x1002, pci_device_id=0x7550),
               GPUInfo(1, "AMD", "Advanced Micro Devices Navi 48", pci_address="0000:10:00.0",
                       pci_vendor_id=0x1002, pci_device_id=0x7550)]
        vulkan = [GPUInfo(0, "AMD", "AMD Radeon RX 9070", backends=["vulkan"],
                          pci_vendor_id=0x1002, pci_device_id=0x7550),
                  GPUInfo(1, "AMD", "AMD Radeon RX 9070", backends=["vulkan"],
                          pci_vendor_id=0x1002, pci_device_id=0x7550)]
        devices = _merge_gpus([], pci, vulkan)
        self.assertEqual(len(devices), 2)
        self.assertEqual([gpu.pci_address for gpu in devices], ["0000:0d:00.0", "0000:10:00.0"])
        self.assertTrue(all(gpu.backends == ["vulkan"] for gpu in devices))

    def test_nvidia_provider_includes_queryable_pci_bus_id(self):
        output = "0, GeForce RTX 4090, 24564, 22000, 00000000:0D:00.0\n"
        with patch("aidream.hardware._run", return_value=output):
            devices = _nvidia()
        self.assertEqual(devices[0].pci_address, "0000:0d:00.0")

    def test_lspci_strips_full_pci_address_class_and_numeric_ids(self):
        listing = "0000:0d:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Navi 48 [Radeon RX 9070 XT] [1002:7550]\n"
        with patch("aidream.hardware._run", return_value=listing):
            self.assertEqual(_lspci_names(), {"0000:0d:00.0": "Advanced Micro Devices, Inc. [AMD/ATI] Navi 48 [Radeon RX 9070 XT]"})

    def test_vulkan_only_reports_enumerated_physical_devices(self):
        summary = """Devices:\n========\nGPU0:\n\n    apiVersion = 1.3.0\n    deviceType = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU\n    deviceName = NVIDIA RTX 4090\n    vendorID = 0x10de\n    deviceID = 0x2684\n    pciDomain = 0\n    pciBus = 13\n    pciDevice = 0\n    pciFunction = 0\nGPU1:\n\n    deviceType = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU\n    deviceName = Intel Arc A770\n    vendorID = 0x8086\nGPU2:\n\n    deviceType = PHYSICAL_DEVICE_TYPE_CPU\n    deviceName = llvmpipe (LLVM 20)\n    vendorID = 0x10005\n"""
        with patch("aidream.hardware._run", return_value=summary):
            devices = _vulkan()
        self.assertEqual([(d.vendor, d.name, d.backends) for d in devices],
                         [("NVIDIA", "NVIDIA RTX 4090", ["vulkan"]),
                          ("Intel", "Intel Arc A770", ["vulkan"])])
        self.assertEqual(devices[0].pci_address, "0000:0d:00.0")
        self.assertEqual((devices[0].pci_vendor_id, devices[0].pci_device_id), (0x10DE, 0x2684))
        self.assertFalse(any("llvmpipe" in d.name for d in devices))

    def test_vulkan_empty_when_no_devices_are_enumerated(self):
        with patch("aidream.hardware._run", return_value="Devices:\n========\n"):
            self.assertEqual(_vulkan(), [])


if __name__ == "__main__":
    unittest.main()
