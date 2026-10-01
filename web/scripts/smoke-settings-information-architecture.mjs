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
let providerStorageAvailable = true;
const providerConnections = [];
const providerId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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

function fixtureFor(request) {
  const pathname = new URL(request.url()).pathname;
  if (pathname === '/api/health') return { data: { status: 'ok', service: 'settings-smoke-fixture' } };
  if (pathname === '/api/settings') return { data: { settings } };
  if (pathname === '/api/runtime') return { data: { runtime: { backends: [{ name: 'cpu-fixture', available: true }], devices: [] } } };
  if (pathname === '/api/runtime/installations') return { data: { installations: [{ id: 'fixture-runtime', name: 'Fixture runtime', kind: 'executable', backend: 'cpu-fixture', enabled: true, available: true }] } };
  if (pathname === '/api/capability-preferences') return { data: { selection_defaults: { mode: 'auto' } } };
  if (pathname === '/api/models') return { data: { models: [{ id: 'local-fixture-model', name: 'Local Fixture Model' }] } };
  if (pathname === '/api/hardware') return { data: { hardware: { cpu: { name: 'Fixture CPU', logical_cores: 2 }, ram: { total_bytes: 1024, available_bytes: 512 }, gpus: [] } } };
  if (pathname === '/api/provider-connections' && request.method() === 'GET') {
    return { data: { connections: providerConnections.map(connection => ({ ...connection })),
      secure_storage: { available: providerStorageAvailable, reason: providerStorageAvailable ? null : 'The fixture has no available OS keyring.' } } };
  }
  if (pathname === '/api/provider-connections' && request.method() === 'POST') {
    const body = request.postDataJSON();
    assert.equal(body.api_key, 'fixture-provider-secret', 'The typed secret should be submitted only in the create body.');
    const id = providerConnections.length ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : providerId;
    const connection = { id, name: body.name, provider_type: 'openai-compatible', base_url: body.base_url,
      enabled: false, secret_ref: 'opaque-fixture-reference', credential_configured: true };
    providerConnections.push(connection);
    return { status: 201, data: { connection } };
  }
  const providerMatch = pathname.match(/^\/api\/provider-connections\/([a-f0-9]{32})(?:\/(test|models))?$/);
  if (providerMatch) {
    const connection = providerConnections.find(item => item.id === providerMatch[1]);
    if (!connection) return { status: 404, error: 'Provider connection not found' };
    const action = providerMatch[2];
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'api_key'), false,
        'Metadata updates without a replacement key must not re-submit the stored credential.');
      Object.assign(connection, body);
      return { data: { connection } };
    }
    if (request.method() === 'DELETE') {
      providerConnections.splice(providerConnections.indexOf(connection), 1);
      return { data: { deleted: true } };
    }
    if (request.method() === 'POST' && action === 'test') {
      assert.deepEqual(request.postDataJSON(), {}, 'Test requests must not carry credentials.');
      return connection.enabled ? { data: { connection_id: providerId, connected: true, model_count: 2 } }
        : { status: 400, error: 'Provider connection is disabled' };
    }
    if (request.method() === 'GET' && action === 'models') {
      if (!connection.enabled) return { status: 400, error: 'Provider connection is disabled' };
      return { data: { models: [
        { id: `provider:${providerId}:fixture-chat`, provider_model_id: 'fixture-chat', connection_id: providerId,
          connection_name: connection.name, provider_type: 'openai-compatible', name: 'Fixture Chat', source: 'remote-provider' },
        { id: `provider:${providerId}:fixture-small`, provider_model_id: 'fixture-small', connection_id: providerId,
          connection_name: connection.name, provider_type: 'openai-compatible', name: 'Fixture Small', source: 'remote-provider' },
      ] } };
    }
  }
  if (pathname === '/api/provider-models') return { data: { models: [] } };
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
        const fixture = fixtureFor(request);
        const status = fixture.status || 200;
        const body = { ...fixture };
        delete body.status;
        await route.fulfill({
          status,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'Content-Type, Accept',
        },
        json: body,
      });
    });

    await openSettings(page, server.url);
    const tablist = page.getByRole('tablist', { name: 'Settings categories' });
    for (const tabName of SETTINGS_TABS) {
      await expect(tablist.getByRole('tab', { name: tabName, exact: true })).toBeVisible();
    }

    const tab = name => tablist.getByRole('tab', { name, exact: true });
    const apiUrlEditor = page.locator('#api-url');
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

    // Every API request below is fulfilled by fixtureFor; no provider is contacted.
    const providerName = page.getByLabel('Name', { exact: true });
    const providerUrl = page.locator('.provider-panel input[placeholder="https://api.example.com/v1"]');
    const providerKey = page.locator('.provider-panel input[type="password"]');
    await providerName.fill('Fixture Provider');
    await providerUrl.fill('http://provider.example.test/v1');
    await providerKey.fill('fixture-provider-secret');
    await page.getByRole('button', { name: 'Save connection securely' }).click();
    await expect(page.getByRole('alert')).toContainText(/external provider URLs must use HTTPS/i);
    assert.equal(providerConnections.length, 0, 'An invalid endpoint must not be submitted.');
    await providerUrl.fill('https://provider.example.test/v1');
    await page.getByRole('button', { name: 'Save connection securely' }).click();
    await expect(page.getByText('Fixture Provider', { exact: true })).toBeVisible();
    await expect(providerKey).toHaveValue('');
    assert.equal((await page.locator('.provider-panel').innerText()).includes('fixture-provider-secret'), false,
      'A saved API key must disappear from the rendered interface.');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(providerKey).toHaveValue('');
    await providerName.fill('Fixture Provider Renamed');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(page.getByText('Fixture Provider Renamed', { exact: true })).toBeVisible();
    const providerCard = page.locator('.provider-card');
    await providerCard.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(providerCard.getByText('Enabled', { exact: true })).toBeVisible();
    await providerCard.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(/2 models discovered/i);
    await providerCard.getByRole('button', { name: 'Models', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Remote provider models' })).toBeVisible();
    await expect(page.getByText('provider:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:fixture-chat')).toBeVisible();
    // Explicit discovery is shared in this SPA session as read-only metadata;
    // remote entries are visible but cannot be selected or executed.
    await page.locator('a[routerlink="/chat"]').click();
    const chatPicker = page.locator('#chat-model');
    await expect(chatPicker).toBeVisible();
    await expect(chatPicker.locator('option[value="local-fixture-model"]')).toBeEnabled();
    const chatRemote = chatPicker.locator('option[value="provider:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:fixture-chat"]');
    await expect(chatRemote).toHaveAttribute('disabled', '');
    await expect(chatRemote).toContainText(/unavailable for chat/i);
    await page.locator('a[routerlink="/models"]').click();
    const studioPicker = page.getByLabel('Remote provider models (discovery only)');
    await expect(studioPicker).toBeVisible();
    await expect(studioPicker.locator('option[value="provider:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:fixture-chat"]')).toHaveAttribute('disabled', '');
    await page.locator('a[routerlink="/settings"]').click();
    await tab('Connections').click();
    await expect(page.locator('.provider-card')).toBeVisible();
    assert.equal(apiRequests.some(request => new URL(request.url).pathname === '/api/provider-connections' && request.method === 'POST'), true);
    assert.equal(apiRequests.some(request => new URL(request.url).pathname.startsWith('/api/provider-connections/') && new URL(request.url).search), false,
      'Provider credentials must never be placed in a query string.');
    assert.equal(apiRequests.some(request => new URL(request.url).pathname === '/api/models'), true,
      'The local model catalog stays on its separate endpoint.');
    await providerCard.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(providerCard.getByText('Disabled', { exact: true })).toBeVisible();
    await page.locator('a[routerlink="/chat"]').click();
    await expect(page.locator('#chat-model option[value="provider:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:fixture-chat"]')).toHaveCount(0);
    await expect(page.locator('#chat-model option[value="local-fixture-model"]')).toBeEnabled();
    await page.locator('a[routerlink="/settings"]').click();
    await tab('Connections').click();

    await providerName.fill('Delete Fixture');
    await providerUrl.fill('https://delete.example.test/v1');
    await providerKey.fill('fixture-provider-secret');
    await page.getByRole('button', { name: 'Save connection securely' }).click();
    const deleteCard = page.locator('.provider-card').filter({ hasText: 'Delete Fixture' });
    await expect(deleteCard).toBeVisible();
    await deleteCard.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(deleteCard).toHaveCount(0);
    await expect(page.locator('.provider-card')).toHaveCount(1);

    providerStorageAvailable = false;
    await page.reload();
    await openSettings(page, server.url);
    await tab('Connections').click();
    await expect(page.getByRole('alert')).toContainText(/secure credential storage is unavailable/i);
    await expect(page.getByText(/keyring dependency/i)).toBeVisible();
    await expect(providerKey).toBeDisabled();
    await expect(page.locator('.provider-card').getByRole('button', { name: 'Enable', exact: true })).toBeDisabled();
    await expect(page.locator('.provider-card').getByRole('button', { name: 'Test', exact: true })).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    for (const tabName of SETTINGS_TABS) {
      await tab(tabName).click();
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
      assert.ok(dimensions.page <= dimensions.viewport + 1,
        `${tabName} settings layout overflows at 390px: ${dimensions.page}px > ${dimensions.viewport}px`);
    }

    assert.ok(apiRequests.length > 0, 'The API fixture should serve the Settings screen requests.');
    assert.deepEqual(pageErrors, [], 'Settings smoke should not produce browser runtime errors.');
    console.log('Settings information architecture smoke passed: six tabs, loopback URL, provider CRUD/test/model fixtures, discovery-only Chat/Model Studio visibility, disabled-provider removal, keyring fail-closed state, API isolation, and 390px layout.');
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
