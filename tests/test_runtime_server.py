import json
from pathlib import Path
import tempfile
import unittest
from aidream.runtime import LlamaCppBackend

FAKE_SERVER = r'''#!/usr/bin/env python3
import http.server, json, sys
if '--help' in sys.argv:
    print('usage -m MODEL --host HOST --port PORT -ngl N --device NAME --tensor-split LIST -c CTX -t THREADS -b BATCH /v1/chat/completions')
    raise SystemExit(0)
port = int(sys.argv[sys.argv.index('--port') + 1])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
        else: self.send_error(404)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with open(sys.argv[sys.argv.index('-m') + 1] + '.requests', 'a') as f:
            f.write(json.dumps(body) + '\n')
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
            backend.load(model, {'gpu_layers': 2, 'device': 'GPU0', 'tensor_split': '1,1'},
                         {'context_size': 4096, 'threads': 4, 'batch_size': 128})
            process = backend._process
            self.assertEqual(backend.generate('hello', {'temperature': 0.2, 'max_tokens': 77,
                                                        'system_prompt': 'Be concise', 'stop': ['END']}), 'turn-2')
            self.assertEqual(backend.generate('follow up'), 'turn-3')
            self.assertEqual([m['role'] for m in backend._messages], ['user', 'assistant', 'user', 'assistant'])
            requests = [json.loads(line) for line in (Path(str(model) + '.requests')).read_text().splitlines()]
            self.assertEqual(requests[0]['temperature'], 0.2)
            self.assertEqual(requests[0]['max_tokens'], 77)
            self.assertEqual(requests[0]['stop'], ['END'])
            self.assertEqual(requests[0]['messages'][0], {'role': 'system', 'content': 'Be concise'})
            self.assertEqual([m['role'] for m in requests[1]['messages']],
                             ['user', 'assistant', 'user'])
            backend.unload()
            self.assertIsNotNone(process.poll())

    def test_rejects_unsupported_and_invalid_options(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(str(executable), startup_timeout=3, port=0)
            with self.assertRaisesRegex(ValueError, 'positive integer'):
                backend.load(model, options={'threads': 0})
            backend.load(model)
            with self.assertRaisesRegex(ValueError, 'temperature'):
                backend.generate('hello', {'temperature': -1})
            with self.assertRaisesRegex(ValueError, 'Unsupported generation option'):
                backend.generate('hello', {'top_k': 5})
            self.assertEqual(backend._messages, [])
            backend.unload()
            self.assertIsNone(backend._process)
            with self.assertRaises(RuntimeError):
                backend.generate('after unload')
            backend.unload()

if __name__ == '__main__':
    unittest.main()
