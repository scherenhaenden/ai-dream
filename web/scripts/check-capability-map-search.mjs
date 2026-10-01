import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/app/pages/capability-map.page.ts', import.meta.url), 'utf8');

assert.match(page, /aria-label="Search capabilities"/,
  'the capability catalog must expose an accessible search field');
assert.match(page, /role="group" aria-label="Filter capabilities by status"/,
  'status filters must be grouped under an accessible label');
assert.match(page, /\[attr\.aria-pressed\]="statusFilter\(\) === 'all'"/,
  'the all-capabilities summary button must expose its selected state');
assert.match(page, /\[attr\.aria-pressed\]="statusFilter\(\) === status"/,
  'status summary buttons must expose their selected state to assistive technology');
assert.match(page, /\[attr\.aria-pressed\]="statusFilter\(\) === filter\.value"/,
  'catalog filter buttons must expose their selected state to assistive technology');
assert.match(page, /Search ID, input, output or route/,
  'the search hint should describe the searchable capability facts');
assert.match(page, /const routeTerms = \(item\.routeDetails \|\| \[\]\)\.flatMap\(route => \[/,
  'search should include discovered route details when available');
for (const field of ['route.id', 'route.model_id', 'route.runtime_id']) {
  assert.ok(page.includes(field), `search should include ${field}`);
}
assert.match(page, /'local tool'/,
  'local tool routes without model ids should remain searchable by their visible label');
assert.match(page, /aria-label="Skills using this capability"/,
  'the capability card must expose the installed skill relationships');
assert.match(page, /@for \(skill of skills; track skill\.id \+ '@' \+ skill\.version\)/,
  'the capability card must render each API-reported skill');
assert.match(page, /No installed skill declares this capability as a requirement/,
  'an empty declared relationship list must be distinguished from an API that omits the mapping');
assert.match(page, /Skill relationships are not reported by this API/,
  'older or partial API responses must not be presented as proof that no skill uses a capability');
assert.match(page, /\.\.\.\(item\.inputs \|\| \[\]\)[\s\S]*?\.\.\.\(item\.outputs \|\| \[\]\)/,
  'search should include declared input and output artifact roles');
assert.match(page, /evidence\.source[\s\S]*?evidence\.confidence[\s\S]*?evidence\.verified_at/,
  'search should include provenance evidence fields');

console.log('Capability map search contract checks passed.');
