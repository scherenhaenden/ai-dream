import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/capability-map.page.ts', import.meta.url), 'utf8');

assert.match(page, /aria-label="Search capabilities"/,
  'the capability catalog must expose an accessible search field');
assert.match(page, /Search ID, input, output or route/,
  'the search hint should describe the searchable capability facts');
assert.match(page, /const routeTerms = \(item\.routeDetails \|\| \[\]\)\.flatMap\(route => \[/,
  'search should include discovered route details when available');
for (const field of ['route.id', 'route.model_id', 'route.runtime_id']) {
  assert.ok(page.includes(field), `search should include ${field}`);
}
assert.match(page, /'local tool'/,
  'local tool routes without model ids should remain searchable by their visible label');
assert.match(page, /\.\.\.\(item\.inputs \|\| \[\]\)[\s\S]*?\.\.\.\(item\.outputs \|\| \[\]\)/,
  'search should include declared input and output artifact roles');
assert.match(page, /evidence\.source[\s\S]*?evidence\.confidence[\s\S]*?evidence\.verified_at/,
  'search should include provenance evidence fields');

console.log('Capability map search contract checks passed.');
