import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [page, capabilityService, routes, app] = await Promise.all([
  read('../src/app/pages/setup-assistant.page.ts'),
  read('../src/app/core/capability.service.ts'),
  read('../src/app/app.routes.ts'),
  read('../src/app/app.component.ts'),
]);

assert.match(capabilityService, /getMap\(\)[\s\S]*?\/api\/capability-map/,
  'setup readiness must come from the local capability-map API');
assert.match(page, /type SetupState = 'ready' \| 'unknown' \| 'unavailable'/,
  'the assistant should expose the three UX readiness states');
assert.match(page, /item\.status === 'ready'[\s\S]*?item\.status === 'unavailable'[\s\S]*?return 'unknown'/,
  'declared but unverified or degraded states must remain unknown');
assert.match(page, /path: '\/models' \| '\/runtime' \| '\/resources' \| '\/skills'/,
  'capabilities should link to concrete setup destinations');
assert.match(page, /role="alert"[\s\S]*?Capability map unavailable[\s\S]*?Retry/,
  'API failures must have an explicit fallback and retry');
assert.match(page, /role="status" aria-live="polite"[\s\S]*?announcement\(\)/,
  'refresh results should be announced to screen readers');
assert.match(page, /aria-controls="setup-results"[\s\S]*?aria-busy/,
  'the refresh control should expose its busy state and result region');
assert.match(page, /Capability map updated\.[\s\S]*?Capability map could not be updated\./,
  'refresh success and failure should provide distinct accessible feedback');
assert.match(page, /No capabilities reported[\s\S]*?No readiness is inferred/,
  'an empty successful response must not be presented as readiness');
assert.match(page, /Needs attention[\s\S]*?Capabilities needing attention[\s\S]*?Ready capabilities/,
  'first-run review should prioritize unresolved capabilities and separate ready ones');
assert.match(page, /preferredRouteSummary\(item: CapabilityMapItem\)[\s\S]*?item\.preferred_route_id[\s\S]*?No preferred route reported/,
  'only the API-reported preferred route should be displayed');
assert.match(page, /does not start services, load models, or infer readiness/,
  'first-run setup should be explicitly read-only');
assert.doesNotMatch(page, /\.post\(|\.patch\(|\.delete\(|startRuntime|loadModel|startService/,
  'the setup page must not start, load, or mutate local services');
assert.match(routes, /path: 'setup-assistant'.*setup-assistant\.page[\s\S]*?SetupAssistantPage/,
  'setup assistant should have a stable lazy route');
assert.match(app, /label: 'Setup Assistant', path: '\/setup-assistant'/,
  'setup assistant should be available in primary navigation');

console.log('Setup Assistant readiness and read-only contract checks passed.');
