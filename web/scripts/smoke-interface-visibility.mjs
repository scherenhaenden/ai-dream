import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All API traffic is fixture-backed. This checks interface visibility without
// contacting an installed service or starting a runtime/model/GPU workload.
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE_KEY = 'aidream.interfaceMode.v1';
const ADVANCED_LINKS = [
  ['/hardware', 'Hardware'], ['/resources', 'Resources'], ['/capability-map', 'Capability Map'],
  ['/runtime', 'Runtime Manager'], ['/local-api', 'Local API'], ['/tools-permissions', 'Tools & Permissions'],
  ['/logs', 'Logs & Traces'], ['/setup-assistant', 'Setup Assistant'],
];
const DESTINATIONS = [
  ['/chat', 'Chat'], ['/agent', 'Agent'], ['/models', 'Models'], ['/capability-map', 'Capability Map'],
  ['/setup-assistant', 'Setup Assistant'], ['/skills', 'Skills'], ['/runs', 'Runs'], ['/canvas', 'Canvas'],
  ['/hub', 'Model Hubs'], ['/knowledge', 'Knowledge (RAG)'], ['/resources', 'Resources'], ['/hardware', 'Hardware'],
  ['/load-model', 'Load Model (Placement)'], ['/runtime', 'Runtime Manager'], ['/downloads', 'Downloads'],
  ['/local-api', 'Local API'], ['/tools-permissions', 'Tools & Permissions'], ['/logs', 'Logs & Traces'],
  ['/settings', 'Settings'],
];
const apiRequests = [];
const settings = {
  default_profile_behavior: 'global', keep_last_model_loaded: true,
  managed_models_dir: '/fixture/models', config_dir: '/fixture/config', data_dir: '/fixture/data',
  runtime_defaults: { backend_name: 'cpu-fixture', runtime_id: 'fixture-runtime', placement: { gpu_layers: 3 }, load: { context_size: 4096 } },
};
const settingsBefore = structuredClone(settings);

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
  const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 5000));
  if (await Promise.race([stopped, timeout]) === 'timeout' && child.exitCode === null) { child.kill('SIGKILL'); await stopped; }
}

function fixtureFor(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/health') return { data: { status: 'ok', service: 'interface-visibility-fixture' } };
  if (pathname === '/api/settings') return { data: { settings } };
  if (pathname === '/api/runtime') return { data: { runtime: { backends: [{ name: 'cpu-fixture', available: true, capabilities: { gpu_layers: true, context_size: true } }], devices: [] } } };
  if (pathname === '/api/runtime/installations') return { data: { installations: [{ id: 'fixture-runtime', name: 'Fixture runtime', kind: 'executable', backend: 'cpu-fixture', enabled: true, available: true, capabilities: { gpu_layers: true, context_size: true }, devices: [] }] } };
  if (pathname === '/api/capability-preferences') return { data: { selection_defaults: { mode: 'guided' } } };
  if (pathname === '/api/models') return { data: { models: [] } };
  if (pathname === '/api/resources') return { data: { resources: { ram: { available_bytes: 0 }, gpus: [], loaded_models: [] } } };
  if (pathname === '/api/models/residency') return { data: { residency: { items: [] } } };
  return { data: {} };
}

async function stopVite(server) { await stopProcess(server?.vite); }

async function expectAllPaletteDestinations(page) {
  await page.getByRole('button', { name: /Search pages/ }).click();
  const search = page.getByRole('combobox', { name: 'Search all pages' });
  const results = page.getByRole('listbox', { name: 'Available pages' });
  for (const [, label] of DESTINATIONS) {
    await search.fill(label);
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(results.getByRole('option', { name: new RegExp(escaped) })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
}

async function run() {
  let server;
  let browser;
  try {
    server = await startVite();
    const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      apiRequests.push({ method: request.method(), url: request.url() });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: {
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'Content-Type, Accept',
      }, json: fixtureFor(request.url()) });
    });

    await page.goto(`${server.url}/chat`);
    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(mainNav.getByRole('link')).toHaveCount(6);
    await expect(mainNav.getByRole('link', { name: 'Hardware' })).toHaveCount(0);
    const resourcesChip = page.locator('.resource-chip');
    await expect(resourcesChip).toContainText(/GPU Unknown · RAM 0 B free · 0 loaded/);
    await expect(resourcesChip).not.toHaveClass(/resource-alert/);
    await expect(page.getByLabel('Global orchestration mode')).toHaveValue('guided');
    await expectAllPaletteDestinations(page);

    await page.goto(`${server.url}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    const interfaceMode = page.getByRole('combobox', { name: 'Interface visibility' });
    await interfaceMode.focus();
    await expect(interfaceMode).toBeFocused();
    await expect(interfaceMode).toHaveValue('standard');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), null,
      'A first visit defaults to Standard without creating a stored value.');
    const localBefore = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));
    assert.deepEqual(localBefore, {}, 'The visibility picker must not initialize unrelated local settings.');
    const mutationCountBeforeAdvanced = apiRequests.filter(request => request.method !== 'GET' && request.method !== 'OPTIONS').length;

    await interfaceMode.selectOption('advanced');
    await expect(interfaceMode).toHaveValue('advanced');
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe('advanced');
    for (const [route, label] of ADVANCED_LINKS) {
      const href = await mainNav.getByRole('link', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).getAttribute('href');
      assert.equal(new URL(href, server.url).pathname, route, `${label} must retain its existing route.`);
    }
    await expect(mainNav.getByRole('link')).toHaveCount(14);
    await expectAllPaletteDestinations(page);
    const mutationCountAfterAdvanced = apiRequests.filter(request => request.method !== 'GET' && request.method !== 'OPTIONS').length;
    assert.equal(mutationCountAfterAdvanced, mutationCountBeforeAdvanced, 'Switching to Advanced must not add API mutations.');
    assert.deepEqual(Object.fromEntries(Object.entries(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])))).filter(([key]) => key !== STORAGE_KEY)), {},
      'Advanced visibility may write only its own preference key.');
    await page.reload();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await expect(page.getByRole('combobox', { name: 'Interface visibility' })).toHaveValue('advanced');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(14);

    await page.getByRole('combobox', { name: 'Interface visibility' }).selectOption('standard');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(6);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe('standard');
    const mutationCountAfterStandard = apiRequests.filter(request => request.method !== 'GET' && request.method !== 'OPTIONS').length;
    assert.equal(mutationCountAfterStandard, mutationCountAfterAdvanced, 'Switching back to Standard must not add API mutations.');
    await page.reload();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await expect(page.getByRole('combobox', { name: 'Interface visibility' })).toHaveValue('standard');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(6);

    await page.evaluate(key => localStorage.setItem(key, '{"mode":"advanced","version":999}'), STORAGE_KEY);
    await page.reload();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await expect(page.getByRole('combobox', { name: 'Interface visibility' })).toHaveValue('standard');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(6);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe('{"mode":"advanced","version":999}');

    await page.goto(`${server.url}/settings`);
    await page.getByRole('tab', { name: 'Advanced' }).click();
    for (const [route] of ADVANCED_LINKS) {
      const link = page.locator(`[role="tabpanel"] a[href$="${route}"]`);
      await expect(link).toBeVisible();
    }
    await page.goto(`${server.url}/load-model`);
    await expect(page).toHaveURL(/\/load-model$/);
    await expect(page.getByRole('heading', { name: /Runtime|Load Model/i }).first()).toBeVisible();

    await page.goto(`${server.url}/settings`);
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByRole('combobox', { name: 'Interface visibility' }).selectOption('advanced');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileMenu = page.getByRole('button', { name: 'Toggle navigation' });
    await expect(mobileMenu).toHaveAttribute('aria-controls', 'main-navigation');
    await expect(mobileMenu).toHaveAttribute('aria-expanded', 'false');
    await mobileMenu.click();
    await expect(mobileMenu).toHaveAttribute('aria-expanded', 'true');
    for (const [, label] of ADVANCED_LINKS) await expect(mainNav.getByRole('link', { name: label })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
    assert.ok(dimensions.page <= dimensions.viewport + 1, `Advanced mobile navigation overflows: ${dimensions.page}px > ${dimensions.viewport}px`);
    await page.keyboard.press('Escape');
    await expect(mobileMenu).toHaveAttribute('aria-expanded', 'false');

    assert.ok(apiRequests.some(request => request.url.endsWith('/api/settings') && request.method === 'GET'), 'Settings fixture should serve a settings read.');
    const mutations = apiRequests.filter(request => request.method !== 'GET' && request.method !== 'OPTIONS');
    assert.deepEqual(mutations, [], 'Changing interface visibility must not mutate any local API configuration.');
    assert.deepEqual(settings, settingsBefore, 'Runtime defaults and other Settings data must remain unchanged.');
    assert.ok(apiRequests.every(request => !/\/api\/(models|model-profiles|runtime|providers)(\/|\?|$)/.test(new URL(request.url).pathname) || request.method === 'GET'),
      'The smoke must not issue model, profile, runtime or provider mutations.');
    assert.deepEqual(pageErrors, [], 'Interface visibility smoke should not produce browser runtime errors.');
    console.log('Interface visibility smoke passed: Standard default, Advanced navigation, persistence, Standard round trip, invalid-value fallback, intact routes, mobile layout, and no API mutations.');
    await context.close();
  } finally {
    await browser?.close();
    await stopVite(server);
  }
}

run().catch(error => { console.error('Interface visibility smoke failed:', error); process.exitCode = 1; });
