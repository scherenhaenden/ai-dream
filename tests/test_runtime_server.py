import json
import threading
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from aidream.runtime import GenerationCancelled, LlamaCppBackend

FAKE_SERVER = r'''#!/usr/bin/env python3
import http.server, json, sys, time
if '--help' in sys.argv:
    print('usage -m MODEL --host HOST --port PORT -ngl N --device NAME --tensor-split LIST -c CTX -t THREADS -b BATCH --fit on|off --reasoning on|off /v1/chat/completions')
    raise SystemExit(0)
port = int(sys.argv[sys.argv.index('--port') + 1])
with open(sys.argv[sys.argv.index('-m') + 1] + '.argv', 'w') as f: f.write(json.dumps(sys.argv))
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
        if body.get('stream'):
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            for part in (answer[:5], answer[5:]):
                event = json.dumps({'choices':[{'delta':{'content':part}}]})
                self.wfile.write(('data: ' + event + '\n\n').encode()); self.wfile.flush()
                if body['messages'][-1]['content'] == 'cancel me' and part == answer[:5]:
                    time.sleep(3)
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
            return
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
            self.assertTrue(requests[0]['stream'])
            self.assertEqual(requests[0]['max_tokens'], 77)
            self.assertEqual(requests[0]['stop'], ['END'])
            self.assertEqual(requests[0]['messages'][0], {'role': 'system', 'content': 'Be concise'})
            self.assertEqual([m['role'] for m in requests[1]['messages']],
                             ['user', 'assistant', 'user'])
            backend.unload()
            self.assertIsNotNone(process.poll())
            command_args = json.loads(Path(str(model) + '.argv').read_text())
            fit_index = command_args.index('--fit')
            self.assertEqual(command_args[fit_index + 1], 'off')

    def test_image_attachment_reaches_chat_completions_as_multimodal_content(self):
        from aidream.image_input import load_image_attachment

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            image = root / 'photo.png'
            image.write_bytes(b'\x89PNG\r\n\x1a\nsmall-image')
            backend = LlamaCppBackend(str(executable), startup_timeout=3)
            backend.load(model)
            try:
                attachment = load_image_attachment(image)
                self.assertEqual(backend.generate('Describe this', {'images': [attachment]}), 'turn-1')
                request = json.loads(Path(str(model) + '.requests').read_text().splitlines()[0])
                content = request['messages'][-1]['content']
                self.assertEqual(content[0], {'type': 'text', 'text': 'Describe this'})
                self.assertEqual(content[1]['type'], 'image_url')
                self.assertTrue(content[1]['image_url']['url'].startswith('data:image/png;base64,'))
                self.assertEqual(backend._messages[-2]['content'], content)
            finally:
                backend.unload()

    def test_stream_delivers_chunks_and_cancellation_discards_partial_history(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(str(executable), startup_timeout=3)
            backend.load(model)
            try:
                chunks = []
                answer = backend.generate_stream('hello', on_delta=chunks.append)
                self.assertEqual(answer, 'turn-1')
                self.assertEqual(''.join(chunks), answer)
                cancel = threading.Event()
                first_chunk = threading.Event()
                result = []
                def generate_cancelled():
                    try:
                        backend.generate_stream('cancel me', on_delta=lambda _part: first_chunk.set(),
                                                cancel_event=cancel)
                    except Exception as exc:
                        result.append(exc)
                worker = threading.Thread(target=generate_cancelled)
                worker.start()
                self.assertTrue(first_chunk.wait(2), 'server did not emit the first token')
                cancel.set()
                backend.cancel_generation()
                worker.join(2)
                self.assertFalse(worker.is_alive(), 'cancel did not interrupt the active stream')
                self.assertEqual(len(result), 1)
                self.assertIsInstance(result[0], GenerationCancelled)
                self.assertEqual(backend._messages, [{'role': 'user', 'content': 'hello'},
                                                     {'role': 'assistant', 'content': 'turn-1'}])
            finally:
                backend.unload()

    def test_stream_parser_handles_sse_and_cancel_event(self):
        class Lines:
            def __init__(self, values):
                self.values = iter(values)
            def readline(self):
                return next(self.values, b'')

        event = threading.Event()
        emitted = []
        source = Lines([
            b'data: {"choices":[{"delta":{"content":"hello"}}]}\n', b'\n',
            b'data: {"choices":[{"delta":{"content":" world"}}]}\n', b'\n',
            b'data: [DONE]\n', b'\n',
        ])
        answer = LlamaCppBackend._read_stream(source, event, [], emitted.append)
        self.assertEqual(answer, 'hello world')
        self.assertEqual(emitted, ['hello', ' world'])

        event.set()
        with self.assertRaisesRegex(GenerationCancelled, 'stopped'):
            LlamaCppBackend._read_stream(Lines([]), event, [], None)

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

    def test_explicit_fit_option_is_respected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(str(executable), startup_timeout=3)
            backend.load(model, options={'fit': True, 'reasoning': False})
            backend.unload()
            command_args = json.loads(Path(str(model) + '.argv').read_text())
            fit_index = command_args.index('--fit')
            self.assertEqual(command_args[fit_index + 1], 'on')
            reasoning_index = command_args.index('--reasoning')
            self.assertEqual(command_args[reasoning_index + 1], 'off')

    def test_restores_saved_conversation_turns(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(str(executable), startup_timeout=3)
            backend.load(model)
            try:
                backend.restore_history([
                    {'role': 'user', 'content': 'earlier question'},
                    {'role': 'assistant', 'content': 'earlier answer'},
                ])
                backend.generate('continue')
                requests = [json.loads(line) for line in Path(str(model) + '.requests').read_text().splitlines()]
                self.assertEqual([m['role'] for m in requests[0]['messages']], ['user', 'assistant', 'user'])
                self.assertEqual(requests[0]['messages'][0]['content'], 'earlier question')
            finally:
                backend.unload()

    def test_rejects_vision_projector_as_chat_model(self):
        with tempfile.TemporaryDirectory() as td:
            model = Path(td) / 'projector.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(executable='/does/not/exist')
            record = SimpleNamespace(path=str(model), metadata={'general.architecture': 'clip'})
            self.assertFalse(backend.can_load(record))

if __name__ == '__main__':
    unittest.main()
