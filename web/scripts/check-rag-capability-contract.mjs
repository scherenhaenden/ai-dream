import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/capability-map.page.ts', import.meta.url), 'utf8');
const types = await readFile(new URL('../src/app/core/capability.types.ts', import.meta.url), 'utf8');
const rag = await readFile(new URL('../../aidream/skills/builtins.py', import.meta.url), 'utf8');

assert.match(types, /model_id\?: string \| null/, 'local tool routes must not fabricate a model id');
assert.match(page, /routeLabel\(route\)/, 'route cards should use a local-tool-aware label');
assert.match(page, /startsWith\('local-'\)[\s\S]*?'Local tool'/,
  'routes without a model should be identified as local tools when the runtime says so');
assert.match(page, /embedding_batch: 'Embedding batch'/);
assert.match(page, /rerank_candidates: 'Rerank candidates'/);
assert.match(page, /evidence\.details[\s\S]*?<p>\{\{ evidence\.details \}\}<\/p>/,
  'capability evidence explanations should be visible in the map');
assert.match(rag, /"id": "document\.answer-with-rag"/,
  'the current temporary RAG skill should remain declarative');
assert.match(rag, /"tool_id": "document\.retrieve-temporary"/,
  'temporary lexical retrieval should remain its existing tool route');
console.log('RAG capability catalog/UI contract checks passed.');
