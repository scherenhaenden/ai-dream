import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/runtime.page.ts', import.meta.url), 'utf8');

assert.match(page, /<label class="model-select-field">Model<select/,
  'Model picker should live in its constrained grid cell.');
assert.match(page, /@for\(m of models\(\);track m\.id\)\{<option \[value\]="m\.id">\{\{modelName\(m\)\}\}<\/option>/,
  'Model options should show a concise name rather than a full path.');
assert.doesNotMatch(page, /<option[^>]*>\{\{m\.id\}\}[^<]*\{\{m\.path\}\}/,
  'Model paths must not inflate native select option width.');
assert.match(page, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,210px\),1fr\)\)/,
  'Runtime controls should use responsive minmax grid columns.');
assert.match(page, /\.runtime-select-grid[^}]*min-width:0/,
  'Runtime grid must allow children to shrink below content width.');
assert.match(page, /\.runtime-select-grid select[^}]*text-overflow:ellipsis/,
  'Native selects should truncate long selected values.');
for (const tab of ['Placement', 'Load settings', 'Advanced']) {
  assert.ok(page.includes(`>${tab}</button>`), `Expected a ${tab} settings tab.`);
}
assert.match(page, /<details class="status-panel"><summary>Runtime status<\/summary>/,
  'Runtime status JSON should be in a collapsible panel.');
assert.match(page, /class="action-row"/, 'Runtime actions should share one aligned responsive row.');
assert.match(page, /Backend<select[\s\S]*?Runtime<select[\s\S]*?GPU \/ device<select/,
  'Backend, runtime, and detected device selectors must remain available.');
assert.match(page, /supports\('device_selection'\)/,
  'Device controls must remain capability-gated.');

console.log('Runtime page structural checks passed (no service, model, or GPU started).');
