import json
import threading
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from aidream.runtime import GenerationCancelled, LlamaCppBackend

FAKE_SERVER = r'''#!/usr/bin/env python3
import http.server, json, sys, time
if '--help' in sys.argv:
    print('usage -m MODEL --host HOST --port PORT -ngl N --device NAME --tensor-split LIST --split-mode MODE --main-gpu N -c CTX -t THREADS -b BATCH -ub UB --parallel N -tb THREADS --continuous-batching --no-cont-batching --numa MODE -ctk TYPE -ctv TYPE --list_devices -fa --kv-unified --no-kv-offload --mmap --no-mmap --mlock --fit on|off --reasoning on|off /v1/chat/completions')
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
    def test_detected_devices_use_help_advertised_runtime_native_ids(self):
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            if argv[-1] == "--help":
                return SimpleNamespace(returncode=0, stdout="--device LIST --list-devices", stderr="")
            return SimpleNamespace(returncode=0, stdout="Available devices:\n ROCm0: Fake AMD\n Vulkan1: Fake Vulkan", stderr="")
        with patch("aidream.runtime.subprocess.run", side_effect=run):
            backend = LlamaCppBackend("/usr/bin/llama-server")
            devices = backend.list_devices()
        self.assertEqual([item["id"] for item in devices], ["ROCm0", "Vulkan1"])
        self.assertEqual([item[0][-1] for item in calls], ["--help", "--list-devices"])
        self.assertIs(calls[1][1]["shell"], False)

    def test_detected_devices_do_not_run_unadvertised_listing_option(self):
        calls = []
        def run(argv, **kwargs):
            calls.append(argv)
            return SimpleNamespace(returncode=0, stdout="--device LIST", stderr="")
        with patch("aidream.runtime.subprocess.run", side_effect=run):
            backend = LlamaCppBackend("/usr/bin/llama-server")
            self.assertEqual(backend.list_devices(), [])
        self.assertEqual([item[-1] for item in calls], ["--help"])

    def test_all_advertised_load_settings_generate_exact_arguments(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(str(executable), port=12345)
            command = backend.effective_command(model, {
                'gpu_layers': 18, 'device': 'ROCm0,ROCm1', 'tensor_split': '2,1',
                'split_mode': 'layer', 'main_gpu': 1,
            }, {
                'context_size': 8192, 'threads': 8, 'batch_size': 512,
                'physical_batch_size': 128, 'max_concurrent': 4,
                'flash_attention': True, 'unified_kv_cache': True,
                'offload_kv_cache': False, 'mmap': False,
                'keep_model_in_memory': True, 'threads_batch': 2,
                'continuous_batching': True, 'numa': 'distribute',
                'kv_cache_type_k': 'q8_0', 'kv_cache_type_v': 'q4_0',
            })
            pairs = set(zip(command, command[1:]))
            for pair in (('-ngl', '18'), ('--device', 'ROCm0,ROCm1'),
                         ('--tensor-split', '2,1'), ('--split-mode', 'layer'),
                         ('--main-gpu', '1'), ('-c', '8192'), ('-t', '8'),
                         ('-b', '512'), ('-ub', '128')):
                self.assertIn(pair, pairs)
            self.assertIn(('--parallel', '4'), pairs)
            self.assertIn(('-tb', '2'), pairs)
            self.assertIn(('--numa', 'distribute'), pairs)
            self.assertIn(('-ctk', 'q8_0'), pairs)
            self.assertIn(('-ctv', 'q4_0'), pairs)
            self.assertIn('--continuous-batching', command)
            self.assertTrue(backend.capabilities().device_listing)
            self.assertTrue(backend.capabilities().mlock)
            self.assertTrue(backend.capabilities().mmap_disable)
            self.assertIn(('-fa', 'on'), pairs)
            for flag in ('--kv-unified', '--no-kv-offload', '--no-mmap', '--mlock'):
                self.assertIn(flag, command)

    def test_unsupported_new_settings_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text('#!/bin/sh\\nif [ "$1" = "--help" ]; then echo "usage -m MODEL"; fi\\n')
            executable.chmod(0o755)
            backend = LlamaCppBackend(str(executable))
            with self.assertRaisesRegex(ValueError, 'does not advertise split_mode'):
                backend._placement_options({'split_mode': 'layer'})
            with self.assertRaisesRegex(ValueError, 'does not advertise flash_attention'):
                backend._load_options({'flash_attention': True})
            for setting in ('threads_batch', 'continuous_batching', 'numa',
                            'kv_cache_type_k', 'kv_cache_type_v'):
                with self.subTest(setting=setting), self.assertRaisesRegex(ValueError, f'does not advertise {setting}'):
                    backend._load_options({setting: 2 if setting == 'threads_batch' else
                                           'q8_0' if setting.startswith('kv_') else
                                           'distribute' if setting == 'numa' else True})

    def test_continuous_batching_can_be_disabled_only_when_runtime_advertises_it(self):
        with tempfile.TemporaryDirectory() as td:
            executable = Path(td) / 'fake-server'
            executable.write_text('#!/bin/sh\nif [ "$1" = "--help" ]; then echo "--cont-batching --no-cont-batching"; fi\n')
            executable.chmod(0o755)
            backend = LlamaCppBackend(str(executable))
            self.assertIn('--no-cont-batching', backend._load_options({'continuous_batching': False}))

    def test_mmap_off_is_rejected_when_only_mmap_on_is_advertised(self):
        with tempfile.TemporaryDirectory() as td:
            executable = Path(td) / 'fake-server'
            executable.write_text('#!/bin/sh\nif [ "$1" = "--help" ]; then echo "--mmap"; fi\n')
            executable.chmod(0o755)
            backend = LlamaCppBackend(str(executable))
            self.assertTrue(backend.capabilities().mmap)
            self.assertFalse(backend.capabilities().mmap_disable)
            with self.assertRaisesRegex(ValueError, 'cannot disable mmap'):
                backend._load_options({'mmap': False})

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

    def test_restores_only_unchanged_local_image_and_document_attachments(self):
        from aidream.conversation import make_attachment_reference

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'model.gguf'
            model.write_bytes(b'mock')
            image = root / 'photo.png'
            image.write_bytes(bytes([137, 80, 78, 71, 13, 10, 26, 10]) + b'image')
            doc = root / 'notes.md'
            doc.write_text('Stored local note', encoding='utf-8')
            stale = root / 'stale.txt'
            stale.write_text('original', encoding='utf-8')
            references = [make_attachment_reference('image', image),
                          make_attachment_reference('document', doc),
                          make_attachment_reference('document', stale)]
            stale.write_text('changed after the chat was saved', encoding='utf-8')
            backend = LlamaCppBackend(str(executable), startup_timeout=3)
            backend.load(model)
            try:
                backend.restore_history([{'role': 'user', 'content': 'Remember these',
                                          'attachments': references}])
                self.assertEqual(backend.generate('Continue'), 'turn-2')
                request = json.loads(Path(str(model) + '.requests').read_text().splitlines()[0])
                historical = request['messages'][0]
                self.assertIsInstance(historical['content'], list)
                self.assertEqual(historical['content'][0]['type'], 'text')
                self.assertIn('Remember these', historical['content'][0]['text'])
                self.assertTrue(historical['content'][1]['image_url']['url'].startswith('data:image/png;'))
                self.assertIn('Stored local note', historical['content'][0]['text'])
                self.assertNotIn('changed after', json.dumps(historical))
            finally:
                backend.unload()

    def test_invalid_attachment_references_do_not_block_legacy_history(self):
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
                backend.restore_history([{'role': 'user', 'content': 'plain text', 'attachments': [
                    {'kind': 'image', 'path': 'relative', 'name': 'bad', 'size_bytes': 1, 'mtime_ns': 1}
                ]}])
                self.assertEqual(backend._messages, [{'role': 'user', 'content': 'plain text'}])
            finally:
                backend.unload()

    def test_rejects_vision_projector_as_chat_model(self):
        with tempfile.TemporaryDirectory() as td:
            model = Path(td) / 'projector.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(executable='/does/not/exist')
            record = SimpleNamespace(path=str(model), metadata={'general.architecture': 'clip'})
            self.assertFalse(backend.can_load(record))

    def test_prevalidates_projector_model_with_actionable_reason(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            executable = root / 'fake-server'
            executable.write_text(FAKE_SERVER)
            executable.chmod(0o755)
            model = root / 'mmproj-model.gguf'
            model.write_bytes(b'mock')
            backend = LlamaCppBackend(str(executable))
            with self.assertRaisesRegex(ValueError, 'vision projector.*compatible base model'):
                backend.validate_load(SimpleNamespace(path=model, metadata={'general.architecture': 'clip'}))

if __name__ == '__main__':
    unittest.main()
