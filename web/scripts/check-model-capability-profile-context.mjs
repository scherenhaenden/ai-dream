import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const models = await readFile(new URL('../src/app/pages/models.page.ts', import.meta.url), 'utf8');
const map = await readFile(new URL('../src/app/pages/capability-map.page.ts', import.meta.url), 'utf8');

assert.match(models, /profileOptionLabel\(profile\)/, 'profile selector should expose semantic context');
assert.match(models, /profile\.name\} · \$\{category\} · \$\{runtime\} · \$\{verification\}/,
  'profile options should identify purpose/class, runtime and recorded verification');
assert.match(models, /Purpose not set/);
assert.match(models, /Verification not recorded/);
assert.match(models, /In · \{\{ kind \}\}[\s\S]*?Out · \{\{ kind \}\}/,
  'model details should state input versus output direction');
assert.match(models, /manifest\.provenance\?\.source/);
assert.match(models, /not successful inference verification/,
  'runtime compatibility must not be presented as inference verification');

assert.match(map, /Preferred route/);
assert.match(map, /evidence\.source/);
assert.match(map, /\{\{ artifactLabel\(input\) \}\} · \{\{ input \}\}/);
assert.match(map, /\{\{ artifactLabel\(output\) \}\} · \{\{ output \}\}/);
assert.match(map, /missing fields remain “Not reported”/);
console.log('Model profile context and capability evidence checks passed.');
