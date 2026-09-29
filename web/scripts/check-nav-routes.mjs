import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/app/app.component.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');
const navBlock = app.match(/const NAV_GROUPS = ([\s\S]*?)\nconst NAV =/);
assert.ok(navBlock, 'grouped navigation declaration exists');

const menuPaths = [...navBlock[1].matchAll(/path:\s*'\/([^']+)'/g)].map((match) => match[1]);
const routePaths = new Set([...routes.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((match) => match[1]));
const missing = menuPaths.filter((path) => !routePaths.has(path));
assert.deepEqual(missing, [], `Every nav link must have a route: ${missing.join(', ')}`);
assert.match(routes, /path:\s*'load-model',[^\n]*RuntimePage/,
  'Load Model (Placement) aliases the real Runtime experience');
assert.match(routes, /path:\s*'logs',[^\n]*logs\.page[^\n]*LogsPage/,
  'Logs & Traces routes to the log viewer');
const logsPage = readFileSync(new URL('../src/app/pages/logs.page.ts', import.meta.url), 'utf8');
assert.match(logsPage, /\/api\/logs\?limit=/,
  'Logs viewer requests the bounded real runtime log endpoint');

console.log(`Navigation routes verified: ${menuPaths.length} links.`);
