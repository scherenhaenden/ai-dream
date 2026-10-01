import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixture-backed UI smoke: never contacts the AI Dream API or starts a model/runtime.
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const capabilities = [
  { id: 'text.chat', status: 'ready', routes: 2, preferred_route_id: 'route-chat-local', evidence: [{ source: 'local-runtime', status: 'ready', confidence: 'verified' }], skills: [{ id: 'chat.general', name: 'General chat', version: '1.0.0', category: 'Chat', status: 'ready' }] },
  { id: 'image.generate', status: 'unavailable', routes: 0, preferred_route_id: null, evidence: [], skills: [{ id: 'image.generate', name: 'Generate image', version: '1.0.0', category: 'Images', status: 'not_ready' }] },
  { id: 'audio.transcribe', status: 'degraded', route_count: 1, evidence: [{ source: 'local-assets', status: 'missing-model', confidence: 'observed' }] },
  { id: 'document.create-pdf', status: 'supported', routes: 1 },
  { id: 'knowledge.search', status: 'unknown' },
];

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startVite() {
  const port = await reservePort();
  const vite = spawn(process.execPath, [path.join(WEB_DIR, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: WEB_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  vite.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  vite.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited with ${vite.exitCode}:\n${output}`);
    try { if ((await fetch(url)).ok) return { vite, url }; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  vite.kill('SIGTERM');
  throw new Error(`Vite did not become ready within 30 seconds:\n${output}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = new Promise(resolve => child.once('exit', resolve));
  if (await Promise.race([stopped, new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))]) === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await stopped;
  }
}

const { vite, url } = await startVite();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
let responseMode = 'normal';
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/api/capability-map' && responseMode === 'error') return route.fulfill({ status: 503, json: { error: 'fixture unavailable' } });
  const data = pathname === '/api/health'
    ? { status: 'ok', service: 'setup-assistant-fixture' }
    : pathname === '/api/capability-map' ? { capabilities: responseMode === 'empty' ? [] : capabilities }
      : pathname === '/api/capability-preferences'
        ? { capability_preferences: {}, selection_defaults: { mode: 'auto', assisted_planner_enabled: false } }
        : pathname === '/api/resources' ? { resources: { ram: {}, gpus: [], loaded_models: [] } }
          : pathname === '/api/runtime/status' ? { status: { loaded: false, model: null } } : {};
  return route.fulfill({ json: { data } });
});

try {
  await page.goto(`${url}/setup-assistant`);
  await expect(page.getByRole('heading', { name: 'Setup Assistant', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready capabilities' })).toBeVisible();
  const attention = page.locator('[aria-label="Capabilities needing attention"]');
  const ready = page.locator('[aria-label="Ready capabilities"]');
  await expect(attention.getByText('image.generate')).toBeVisible();
  await expect(attention.getByText('unavailable', { exact: true })).toBeVisible();
  await expect(attention.getByText('audio.transcribe')).toBeVisible();
  await expect(attention.locator('.capability-row').filter({ hasText: 'audio.transcribe' }).locator('.state-badge')).toHaveText('unknown');
  await expect(attention.getByText('document.create-pdf')).toBeVisible();
  await expect(attention.getByText('knowledge.search')).toBeVisible();
  await expect(attention.locator('.capability-row').filter({ hasText: 'knowledge.search' }).locator('.state-badge')).toHaveText('unknown');
  const chat = ready.locator('.capability-row').filter({ hasText: 'text.chat' });
  await expect(chat).toContainText('2 routes reported');
  await expect(chat).toContainText('Preferred route: route-chat-local');
  await expect(attention.locator('.capability-row').filter({ hasText: 'image.generate' })).toContainText('No preferred route reported');
  await expect(attention.getByRole('link', { name: /Review speech-to-text setup/ })).toHaveAttribute('href', /\/runtime$/);
  await expect(chat.getByRole('link', { name: /Review compatible models/ })).toHaveAttribute('href', /\/models$/);
  await expect(chat.getByRole('link', { name: /General chat ready/ })).toHaveAttribute('href', /\/skills\?skill=chat\.general$/);
  const image = attention.locator('.capability-row').filter({ hasText: 'image.generate' });
  await expect(image.getByRole('link', { name: /Review image runtime setup/ })).toHaveAttribute('href', /\/runtime$/);
  await expect(image.getByRole('link', { name: /Generate image not_ready/ })).toHaveAttribute('href', /\/skills\?skill=image\.generate$/);
  await expect(page.getByText('Read-only check')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  let dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.document <= dimensions.viewport, `Setup Assistant overflows 390 px viewport: ${dimensions.document}px > ${dimensions.viewport}px`);
  await expect(attention.getByText('image.generate')).toBeVisible();
  await expect(image.getByRole('link', { name: /Generate image not_ready/ })).toBeVisible();

  responseMode = 'empty';
  await page.reload();
  await expect(page.getByText('No capabilities reported')).toBeVisible();
  dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.document <= dimensions.viewport, `Empty map overflows 390 px viewport: ${dimensions.document}px > ${dimensions.viewport}px`);

  responseMode = 'error';
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Capability map unavailable');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.document <= dimensions.viewport, `API error overflows 390 px viewport: ${dimensions.document}px > ${dimensions.viewport}px`);
  assert.deepEqual(pageErrors, [], 'Setup Assistant fixture UI should render without browser errors');
  console.log('Setup Assistant capability-specific destinations, API-linked workflows, ready/unknown/unavailable, empty/error fallbacks, and 390 px layouts passed.');
} finally {
  await context.close();
  await browser.close();
  await stopProcess(vite);
}
