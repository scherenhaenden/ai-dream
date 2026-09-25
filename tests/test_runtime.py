import os
from pathlib import Path
import tempfile
import unittest
from aidream.runtime import LlamaCppBackend, RuntimeRegistry

class RuntimeTest(unittest.TestCase):
    def test_fake_cli_capabilities_and_lifecycle(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            cli = root / 'fake-llama'
            cli.write_text('''#!/usr/bin/env python3
import sys
if '--help' in sys.argv:
 print('usage -m MODEL -p PROMPT -n N -ngl N --device NAME --tensor-split LIST')
else:
 print('generated:' + sys.argv[sys.argv.index('-p') + 1])
''')
            cli.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'fake')
            backend = LlamaCppBackend(str(cli))
            caps = backend.capabilities()
            self.assertTrue(caps.available)
            self.assertTrue(caps.gpu_layers)
            self.assertTrue(caps.device_selection)
            self.assertTrue(caps.tensor_split)
            self.assertTrue(backend.can_load(model))
            backend.load(model, {'gpu_layers': 4, 'device': 'GPU0', 'tensor_split': '2,1'})
            self.assertEqual(backend.generate('hello'), 'generated:hello')
            backend.unload()
            with self.assertRaises(RuntimeError):
                backend.generate('again')

if __name__ == '__main__':
    unittest.main()
