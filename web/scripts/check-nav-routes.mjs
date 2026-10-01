import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app/app.component.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');
const navBlock = app.match(/const NAV_GROUPS = ([\s\S]*?)\nconst PALETTE_NAV_GROUPS =/);
const paletteBlock = app.match(/const PALETTE_NAV_GROUPS = ([\s\S]*?)\nconst PALETTE_NAV =/);
assert.ok(navBlock, 'standard grouped navigation declaration exists');
assert.ok(paletteBlock, 'complete command palette navigation declaration exists');

const parseItems = (block) => [...block.matchAll(/label:\s*'([^']+)'\s*,\s*path:\s*'([^']+)'/g)]
  .map((match) => ({ label: match[1], path: match[2] }));
const sidebarItems = parseItems(navBlock[1]);
const paletteItems = parseItems(paletteBlock[1]);
const sidebarPaths = sidebarItems.map(({ path }) => path);
const palettePaths = paletteItems.map(({ path }) => path);
const routePaths = new Set([...routes.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((match) => match[1]));
const missingPaletteRoutes = palettePaths.filter((path) => !routePaths.has(path.slice(1)));
assert.deepEqual(missingPaletteRoutes, [], `Every palette destination must have a route: ${missingPaletteRoutes.join(', ')}`);
assert.deepEqual(sidebarItems.map(({ label }) => label), [
  'Chat', 'Models', 'Create / Skills', 'Knowledge (RAG)', 'Downloads', 'Settings',
], 'Standard sidebar exposes only the six primary destinations');
assert.deepEqual(sidebarPaths, ['/chat', '/models', '/skills', '/knowledge', '/downloads', '/settings'],
  'Standard sidebar paths remain stable');
const previousDestinations = [
  ['/chat', 'Chat'], ['/agent', 'Agent'], ['/models', 'Models'], ['/capability-map', 'Capability Map'],
  ['/setup-assistant', 'Setup Assistant'], ['/skills', 'Skills'], ['/runs', 'Runs'], ['/hub', 'Model Hubs'],
  ['/canvas', 'Canvas'], ['/knowledge', 'Knowledge (RAG)'], ['/resources', 'Resources'], ['/hardware', 'Hardware'],
  ['/load-model', 'Load Model (Placement)'], ['/runtime', 'Runtime Manager'], ['/downloads', 'Downloads'],
  ['/local-api', 'Local API'], ['/tools-permissions', 'Tools & Permissions'], ['/logs', 'Logs & Traces'],
  ['/settings', 'Settings'],
];
for (const [path, label] of previousDestinations) {
  assert.ok(paletteItems.some((item) => item.path === path && item.label === label),
    `Previously visible destination remains indexed in command palette: ${label} (${path})`);
  assert.ok(routePaths.has(path.slice(1)), `Previously visible destination retains its deep-link route: ${path}`);
}
const staticRoutePaths = [...routePaths].filter((path) => path && path !== '**' && !path.includes(':'));
const unindexedRoutes = staticRoutePaths.filter((path) => !palettePaths.includes(`/${path}`));
assert.deepEqual(unindexedRoutes, [], `Every static route remains discoverable in the palette: ${unindexedRoutes.join(', ')}`);
assert.match(app, /ArrowDown/);
assert.match(app, /ArrowUp/);
assert.match(app, /goActive\(\)/, 'Enter opens the active command-palette destination');
assert.match(app, /activePaletteIndex\.update/, 'Arrow navigation updates the highlighted palette item');
assert.match(routes, /path:\s*'load-model',[^\n]*RuntimePage/,
  'Load Model (Placement) aliases the real Runtime experience');
assert.match(routes, /path:\s*'logs',[^\n]*logs\.page[^\n]*LogsPage/,
  'Logs & Traces routes to the log viewer');
const logsPage = readFileSync(new URL('../src/app/pages/logs.page.ts', import.meta.url), 'utf8');
assert.match(logsPage, /\/api\/logs\?limit=/,
  'Logs viewer requests the bounded real runtime log endpoint');

console.log(`Standard navigation verified: ${sidebarItems.length} links; command palette destinations verified: ${paletteItems.length}.`);
