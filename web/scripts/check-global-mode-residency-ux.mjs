import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app/app.component.ts', import.meta.url), 'utf8');
const resources = await readFile(new URL('../src/app/pages/resources.page.ts', import.meta.url), 'utf8');
const resourcesService = await readFile(new URL('../src/app/core/resources.service.ts', import.meta.url), 'utf8');
const localApi = await readFile(new URL('../src/app/pages/local-api.page.ts', import.meta.url), 'utf8');

assert.match(app, /aria-label="Global orchestration mode"/);
assert.match(app, /<option value="auto">Auto<\/option>[\s\S]*?<option value="guided">Guided<\/option>[\s\S]*?<option value="manual">Manual \/ pinned<\/option>/);
assert.match(app, /modeDescription\(\)/);
assert.match(app, /auto: 'Auto:[\s\S]*?guided: 'Guided:[\s\S]*?manual: 'Manual \/ pinned:/);
assert.match(app, /api\.get<PreferenceResponse>\('\/api\/capability-preferences'\)/,
  'mode picker should load the persisted local default');
assert.match(app, /api\.patch<PreferenceResponse>\('\/api\/capability-preferences',[\s\S]*?selection_defaults: \{ mode: value \}/,
  'mode changes should persist through the existing validated API');
assert.match(app, /modeError\(\)[\s\S]*?role="alert"/);
assert.match(app, /routerLink="\/resources"[\s\S]*?resourceIndicator\(\)/,
  'a persistent topbar indicator should link to the resource dashboard');
assert.match(app, /RAM Unknown[\s\S]*?models Unknown/,
  'missing resource observations should remain explicitly unknown');
assert.match(app, /free_vram_bytes[\s\S]*?total_vram_bytes[\s\S]*?GPU Unknown/,
  'global indicator should show free/total VRAM per reported device or GPU Unknown');
assert.match(app, /setInterval\(\(\) =>[\s\S]*?resourceService\.refresh\(\)/,
  'the global residency indicator should refresh without loading models');

assert.match(resources, /Default eviction policy/);
assert.match(resources, /LRU idle models/);
assert.match(resources, /Never evict automatically/);
assert.match(resources, /service\.setEvictionPolicy\(value\)/);
assert.match(resourcesService, /selection_defaults: \{ eviction_policy: policy \}/,
  'residency policy must persist through the validated local preferences API');
assert.match(resources, /applyControl\(routeId, model\.pinned \? 'unpin' : 'pin'\)/);
assert.match(resources, /!canUnload\(model\)/,
  'unload is guarded by known idle, lease-free and unpinned residency state');
assert.match(localApi, /capability-preferences', note: 'Read or update route preferences, Auto\/Guided\/Manual defaults and LRU\/Never eviction policy'/,
  'Local API should describe persisted global mode and eviction policy');
assert.match(localApi, /residency\/actions', note: 'Pin, unpin or unload an existing allowlisted orchestration resident \(POST\)'/,
  'Local API should keep residency actions distinct from eviction policy preferences');
console.log('Global mode and residency UX checks passed.');
