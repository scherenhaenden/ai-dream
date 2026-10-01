import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Settings information architecture smoke. Every backend request is fulfilled by
// this fixture so the smoke cannot contact a running AI Dream service or start
// any runtime/model/GPU workload.
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_TABS = ['General', 'Models & Storage', 'Runtimes', 'Connections', 'Appearance', 'Advanced'];
const settings = {
  default_profile_behavior: 'global',
  keep_last_model_loaded: true,
  managed_models_dir: '/fixture/models',
  config_dir: '/fixture/config',
  data_dir: '/fixture/data',
  runtime_defaults: { backend_name: 'cpu-fixture', runtime_id: 'fixture-runtime', placement: {}, load: {} },
};
const apiRequests = [];

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startVite() {
  const port = await reservePort();
  const vite = spawn(process.execPath, [
    path.join(WEB_DIR, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], { cwd: WEB_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  vite.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  vite.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited with ${vite.exitCode}:\n${output}`);
    try {
      const response = await fetch(url);
      if (response.ok) return { vite, url };
    } catch { /* Vite is still starting. */ }
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
  if (await Promise.race([stopped, timeout]) === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await stopped;
  }
}

function fixtureFor(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/health') return { data: { status: 'ok', service: 'settings-smoke-fixture' } };
  if (pathname === '/api/settings') return { data: { settings } };
  if (pathname === '/api/runtime') return { data: { runtime: { backends: [{ name: 'cpu-fixture', available: true }], devices: [] } } };
  if (pathname === '/api/runtime/installations') return { data: { installations: [{ id: 'fixture-runtime', name: 'Fixture runtime', kind: 'executable', backend: 'cpu-fixture', enabled: true, available: true }] } };
  if (pathname === '/api/capability-preferences') return { data: { selection_defaults: { mode: 'auto' } } };
  if (pathname === '/api/models') return { data: { models: [] } };
  if (pathname === '/api/hardware') return { data: { hardware: { cpu: { name: 'Fixture CPU', logical_cores: 2 }, ram: { total_bytes: 1024, available_bytes: 512 }, gpus: [] } } };
  return { data: {} };
}

async function routerLink(page, pathname) {
  const links = page.locator('[role="tabpanel"] a');
  const index = await links.evaluateAll((anchors, expectedPath) => anchors.findIndex(anchor => {
    const routerPath = anchor.getAttribute('routerlink') || anchor.getAttribute('ng-reflect-router-link');
    if (routerPath === expectedPath) return true;
    try {
      const url = new URL(anchor.getAttribute('href') || anchor.href, window.location.href);
      const resolvedPath = url.hash.startsWith('#/') ? url.hash.slice(1).split('?')[0] : url.pathname;
      return resolvedPath === expectedPath;
    } catch {
      return false;
    }
  }), pathname);
  const found = await links.evaluateAll(anchors => anchors.map(anchor => ({
    href: anchor.getAttribute('href'),
    routerLink: anchor.getAttribute('routerlink') || anchor.getAttribute('ng-reflect-router-link'),
    text: anchor.innerText,
  })));
  assert.notEqual(index, -1, `Expected a Settings router link to ${pathname}; found ${JSON.stringify(found)}; URL=${page.url()}.`);
  return links.nth(index);
}

async function openSettings(page, baseUrl) {
  await page.goto(`${baseUrl}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
}

async function run() {
  let server;
  let browser;
  try {
    server = await startVite();
    const executablePath = process.env.CHROME_BIN || [
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ].find(candidate => existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    // Catch API calls regardless of host, including the user-entered loopback
    // address. No API traffic can escape to a real service.
    await page.route('**/api/**', async route => {
      const request = route.request();
      apiRequests.push({ method: request.method(), url: request.url() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'Content-Type, Accept',
        },
        json: fixtureFor(request.url()),
      });
    });

    await openSettings(page, server.url);
    const tablist = page.getByRole('tablist', { name: 'Settings categories' });
    for (const tabName of SETTINGS_TABS) {
      await expect(tablist.getByRole('tab', { name: tabName, exact: true })).toBeVisible();
    }

    const tab = name => tablist.getByRole('tab', { name, exact: true });
    const apiUrlEditor = page.locator('input[type="url"]');
    await expect(apiUrlEditor).toHaveCount(0);

    await tab('Models & Storage').click();
    for (const destination of ['/models', '/hub', '/downloads']) {
      const link = await routerLink(page, destination);
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${destination.replace('/', '\\/')}$`));
      await openSettings(page, server.url);
      await tab('Models & Storage').click();
    }
    await expect(apiUrlEditor).toHaveCount(0);

    await tab('Runtimes').click();
    await expect(page.getByRole('heading', { name: 'Runtime defaults' })).toBeVisible();
    await expect(page.getByLabel('Default backend')).toBeVisible();
    const runtimeLink = await routerLink(page, '/runtime');
    await expect(runtimeLink).toBeVisible();
    await runtimeLink.click();
    await expect(page).toHaveURL(/\/runtime$/);
    await openSettings(page, server.url);
    await expect(apiUrlEditor).toHaveCount(0);

    await tab('General').click();
    await expect(apiUrlEditor).toHaveCount(0);

    await tab('Appearance').click();
    await expect(apiUrlEditor).toHaveCount(0);
    const appearanceCopy = await page.locator('main').innerText();
    const appearanceControls = page.locator('main input, main select, main textarea');
    if (await appearanceControls.count() === 0) {
      assert.match(appearanceCopy, /not yet|not available|not implemented|not configurable|no appearance preferences/i,
        'Appearance must state plainly that nonfunctional preferences are unavailable.');
    }
    await tab('Advanced').click();
    for (const destination of ['/hardware', '/resources', '/capability-map', '/local-api', '/tools-permissions', '/logs', '/setup-assistant']) {
      const link = await routerLink(page, destination);
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${destination.replace('/', '\\/')}$`));
      await openSettings(page, server.url);
      await tab('Advanced').click();
    }
    await expect(apiUrlEditor).toHaveCount(0);

    await tab('Connections').click();
    await expect(apiUrlEditor).toHaveCount(1);
    const saveCheck = page.getByRole('button', { name: 'Save & check', exact: true });
    await apiUrlEditor.fill('https://example.com');
    await saveCheck.click();
    await expect(page.getByRole('alert')).toContainText(/127\.0\.0\.1|localhost|loopback/i);
    assert.equal(await page.evaluate(() => localStorage.getItem('aidream.apiBase')), null,
      'A non-loopback URL must not be saved.');

    const validBase = 'http://127.0.0.1:8765';
    await apiUrlEditor.fill(validBase);
    await saveCheck.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('aidream.apiBase'))).toBe(validBase);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => apiRequests.some(request => request.url === `${validBase}/api/health` && request.method === 'GET')).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const tabName of SETTINGS_TABS) {
      await tab(tabName).click();
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
      assert.ok(dimensions.page <= dimensions.viewport + 1,
        `${tabName} settings layout overflows at 390px: ${dimensions.page}px > ${dimensions.viewport}px`);
    }

    assert.ok(apiRequests.length > 0, 'The API fixture should serve the Settings screen requests.');
    assert.deepEqual(pageErrors, [], 'Settings smoke should not produce browser runtime errors.');
    console.log('Settings information architecture smoke passed: six tabs, capability links, loopback URL validation/save, API isolation, and 390px layout.');
    await context.close();
  } finally {
    await browser?.close();
    await stopProcess(server?.vite);
  }
}

run().catch(error => {
  console.error('Settings information architecture smoke failed:', error);
  process.exitCode = 1;
});
