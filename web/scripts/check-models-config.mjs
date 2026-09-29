import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routes = await readFile(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');
const modelsRoute = routes.match(/path:\s*'models',[\s\S]*?import\('\.\/pages\/([^']+)'\)/);
assert.ok(modelsRoute, 'The models route must resolve to a page component.');
const page = await readFile(new URL(`../src/app/pages/${modelsRoute[1]}.ts`, import.meta.url), 'utf8');

assert.match(page, /<h1>Models<\/h1>[\s\S]*?Configuration preset/,
  'The active models page must expose its configuration workflow.');
assert.match(page, /this\.profileApi\.create\(payload\)/, 'New model presets must be persisted.');
assert.match(page, /this\.profileApi\.update\(this\.selectedProfileId\(\), payload\)/, 'Saved model presets must remain editable.');
assert.match(page, /this\.runtime\.load\(\{/, 'Loading must use the current runtime configuration.');
assert.match(page, /isLoaded\(model\) \? 'Loaded in memory' : 'Not loaded'/, 'Runtime state must have a human-readable summary.');
assert.match(page, /aria-label="Sort models by"/, 'The active models route must expose an accessible sort control.');
for (const criterion of ['name', 'size', 'architecture', 'quantization', 'context']) {
  assert.match(page, new RegExp(`<option value="${criterion}">`), `The active page must offer ${criterion} sorting.`);
}
assert.match(page, /if \(left == null && right != null\) return 1;[\s\S]*?if \(left != null && right == null\) return -1;/,
  'Unavailable metadata must sort last in either direction.');
assert.match(page, /fieldHelp\(field\.key\)/, 'Technical settings must have explanatory tooltips.');
assert.match(page, /Architecture read from GGUF metadata/, 'Model metadata tooltips must state their source.');
assert.match(page, /source\.file_count/, 'The model summary must distinguish physical GGUF files from logical models.');
assert.match(page, /source\.model_count/, 'The model summary must use the catalog logical model count.');
assert.match(page, /<option \[value\]="device\.id"/, 'Device placement must send the native device ID, not the runtime installation UUID.');

console.log(`Models configuration/status/sorting checks passed for ${modelsRoute[1]} (no service, model, or GPU started).`);
