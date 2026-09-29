import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/models.page.ts', import.meta.url), 'utf8');

assert.match(page, /Configure model/, 'Each discovered model should expose a visible configuration action.');
assert.match(page, /MODEL SETUP[\s\S]*?CONFIGURATION PROFILE[\s\S]*?Settings saved specifically for this model/,
  'The selected model should clearly lead into its own configuration profile.');
assert.match(page, /profileApi\.create\(\{model_id:model\.id/,
  'New profiles must be persisted against the selected model.');
assert.match(page, /profileApi\.update\(current\.id/,
  'Existing model profiles must remain editable and persistent.');
assert.match(page, /runtime\.load\(\{ model_id: model\.id, profile_id: this\.selectedProfileId\(\)/,
  'Loading a model should apply the selected model profile.');
assert.match(page, /runtimeStatusValue\('loaded'\) === true \? 'Model loaded' : 'No model loaded'/,
  'Runtime status should have a human-readable loaded/unloaded summary.');
assert.match(page, /class=\"runtime-status-grid\"/,
  'Runtime status should present important runtime details in a summary grid.');
assert.match(page, /showRuntimeJson\(\) \? 'Hide JSON' : 'Show JSON'/,
  'Raw runtime JSON should only appear behind an explicit toggle.');
assert.match(page, /@if \(showRuntimeJson\(\)\) \{ <pre class="runtime-status-json">/,
  'The JSON panel should be hidden until the user asks to show it.');
assert.doesNotMatch(page, /<pre class="runtime-status"[^>]*>\{\{ runtimeStatus\(\) \}\}<\/pre>/,
  'Do not render the raw JSON response as the default runtime status view.');
assert.match(page, /profileSupports\('gpu_layers'\)/,
  'Runtime profile controls must remain capability-gated.');

console.log('Models configuration/status structural checks passed (no service, model, or GPU started).');
