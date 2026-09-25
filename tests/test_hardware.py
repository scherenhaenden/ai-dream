import unittest
from unittest.mock import patch

from aidream.hardware import HardwareService, GPUInfo


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


if __name__ == "__main__":
    unittest.main()
