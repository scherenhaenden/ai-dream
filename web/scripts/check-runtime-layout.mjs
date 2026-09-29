import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/runtime.page.ts', import.meta.url), 'utf8');

assert.match(page, /<label class="model-select-field">Model<select title=/,
  'Model picker should live in its constrained grid cell.');
assert.match(page, /@for\(m of models\(\);track m\.id\)\{<option \[value\]="m\.id">\{\{modelName\(m\)\}\}\{\{isLoadedModel\(m\)\?'/,
  'Model options should show concise names and mark the detected loaded model.');
assert.match(page, /detectedLoadedModel\(\)[\s\S]*sameModelPath/,
  'The active model should be detected by runtime-reported path.');
assert.match(page, /selectModel\(modelId:string\)\{this\.modelSelectionTouched=true/,
  'The user must still be able to select a different model explicitly.');
assert.doesNotMatch(page, /<option[^>]*>\{\{m\.id\}\}[^<]*\{\{m\.path\}\}/,
  'Model paths must not inflate native select option width.');
assert.match(page, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,210px\),1fr\)\)/,
  'Runtime controls should use responsive minmax grid columns.');
assert.match(page, /\.runtime-select-grid[^}]*min-width:0/,
  'Runtime grid must allow children to shrink below content width.');
assert.match(page, /\.runtime-select-grid select[^}]*text-overflow:ellipsis/,
  'Native selects should truncate long selected values.');
for (const step of ['Model &amp; device', 'Load options', 'Advanced']) {
  assert.ok(page.includes(`<b>${step}</b>`), `Expected the ${step} runtime configuration step.`);
}
assert.match(page, /settingsTab\(\)==='placement'[\s\S]*settingsTab\(\)==='load'[\s\S]*settingsTab\(\)==='advanced'/,
  'Runtime configuration steps should reveal the placement, load, and advanced panels.');
assert.match(page, /<details class="status-panel"><summary title="[^"]+">Runtime status<\/summary>/,
  'Runtime status JSON should be in a collapsible panel.');
assert.match(page, /class="action-row"/, 'Runtime actions should share one aligned responsive row.');
assert.match(page, /Backend<select[\s\S]*?Runtime<select[\s\S]*?GPU \/ device<select/,
  'Backend, runtime, and detected device selectors must remain available.');
assert.match(page, /\[selected\]="b\.name===backendName\(\)"/,
  'A backend loaded asynchronously must remain selected in the native selector.');
assert.match(page, /Runtime installations[\s\S]*Register & probe[\s\S]*Probe[\s\S]*Remove/,
  'Runtime Manager must expose registration, probing, and registry removal.');
assert.match(page, /Show effective llama\.cpp command[\s\S]*async showCommand\(\)[\s\S]*result\.data\.command/,
  'Command preview must unwrap the API envelope without starting a model server.');
assert.match(page, /async load\(\)[\s\S]*this\.runtime\.load\(this\.payload\(\)\)/,
  'Load model must submit the selected model and explicit supported settings to the runtime API.');
assert.match(page, /supports\('device_selection'\)/,
  'Device controls must remain capability-gated.');
assert.match(page, /modelLayerCount\(\)[\s\S]*block_count/,
  'Model layer suggestions should come from architecture-specific GGUF block metadata.');
assert.match(page, /nativeId\(d:RuntimeDevice\)\{return d\.id;\}/,
  'Device selection must submit the native device id, not the registry runtime id.');
assert.match(page, /title="Use the exact block count declared in this model's GGUF metadata/,
  'Layer suggestions must disclose their metadata source and avoid implying memory safety.');

console.log('Runtime page structural checks passed (no service, model, or GPU started).');
