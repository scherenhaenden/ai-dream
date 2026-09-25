import json
from pathlib import Path
import tempfile
import unittest
from aidream.runtime import LlamaCppBackend

FAKE_SERVER = r'''#!/usr/bin/env python3
import http.server, json, sys
if '--help' in sys.argv:
    print('usage -m MODEL --host HOST --port PORT -ngl N --device NAME --tensor-split LIST')
    raise SystemExit(0)
port = int(sys.argv[sys.argv.index('--port') + 1])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
        else: self.send_error(404)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        answer = 'turn-' + str(len(body['messages']))
        data = json.dumps({'choices':[{'message':{'content':answer}}]}).encode()
        self.send_response(200); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, *args): pass
http.server.HTTPServer(('127.0.0.1', port), Handler).serve_forever()
'''

class PersistentServerTest(unittest.TestCase):
    def test_load_generates_with_history_and_unloads_process(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(str(executable), startup_timeout=3, port=0)
            self.assertTrue(backend.capabilities().available)
            backend.load(model, {'gpu_layers': 2, 'device': 'GPU0', 'tensor_split': '1,1'})
            pid = backend._process.pid
            self.assertEqual(backend.generate('hello'), 'turn-1')
            self.assertEqual(backend.generate('follow up'), 'turn-3')
            self.assertEqual([m['role'] for m in backend._messages], ['user', 'assistant', 'user', 'assistant'])
            backend.unload()
            self.assertIsNone(backend._process)
            with self.assertRaises(RuntimeError):
                backend.generate('after unload')
            with self.assertRaises(ProcessLookupError):
                import os
                os.kill(pid, 0)
            backend.unload()

if __name__ == '__main__':
    unittest.main()
