import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCREENSHOT_DIR = path.join(WEB_DIR, 'screenshots');
const hardwareResponse = {
  data: {
    hardware: {
      cpu: { name: 'AMD Ryzen 9 7950X 16-Core Processor', logical_cores: 32, physical_cores: 16 },
      ram: { total_bytes: 67364000000, available_bytes: 42000000000 },
      os: { system: 'Linux', release: '6.8.0-generic', version: '#1 SMP PREEMPT_DYNAMIC', architecture: 'x86_64', distribution: 'Ubuntu 24.04 LTS' },
      gpus: [
        { index: 0, vendor: 'AMD', name: 'Radeon RX 7900 XTX', memory_total_bytes: 25752000000, memory_free_bytes: 23000000000, backends: ['vulkan'], pci_address: '0000:03:00.0', virtual: false, pci_vendor_id: '1002', pci_device_id: '744c' }
      ]
    }
  }
};

const settingsResponse = {
  data: {
    settings: {
      default_profile_behavior: 'global',
      keep_last_model_loaded: true,
      managed_models_dir: '/path/to/models',
      config_dir: '/path/to/config',
      data_dir: '/path/to/data',
      runtime_defaults: { backend_name: 'vulkan', runtime_id: 'llama-cpp-1' }
    }
  }
};

const healthResponse = { data: { status: 'ok', version: '0.1.0' } };
const modelsResponse = { data: { models: [] } };
const runtimeResponse = { data: {
  backends: [{ name: 'vulkan', available: true }, { name: 'cpu', available: false }],
  devices: []
} };
const installationsResponse = { data: { installations: [
  { id: 'llama-cpp-1', name: 'llama.cpp v1.0', kind: 'executable', backend: 'vulkan', enabled: true, available: true }
] } };
let residentItems = [{ model_id: 'fixture/model.gguf', runtime_id: 'llama-cpp-1', profile_id: 'default',
  state: 'idle', lease_count: 0, pinned: false, estimated_vram_bytes: 2147483648,
  estimated_vram_status: 'observed', loaded_for_seconds: 120, idle_for_seconds: 30,
  route_ids: ['route_fixture_model'] }];
let evictionPolicy = 'lru';
const residencyPayload = () => ({ data: { residency: {
  items: residentItems, count: residentItems.length, active_lease_count: 0, status: 'observed', source: 'fixture'
} } });
const resourceResponse = { data: { resources: {
  ram: { total_bytes: 67364000000, available_bytes: 42000000000 },
  gpus: [{ id: 'gpu-0', index: 0, name: 'Radeon RX 7900 XTX', vendor: 'AMD', total_vram_bytes: 25752000000, free_vram_bytes: 23000000000 }],
  loaded_models: [], pending_reservations: [],
}, status: 'observed' } };
let selectionMode = 'auto';

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
    path.join(WEB_DIR, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'
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

async function runSmokeTests() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  let server;
  let browser;
  let hasErrors = false;
  try {
    server = await startVite();
    const executablePath = process.env.CHROME_BIN || [
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
    ].find(candidate => existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`Browser console error: ${msg.text()}`);
        hasErrors = true;
      }
    });
    page.on('pageerror', err => {
      console.error(`Browser page error: ${err.message}`);
      hasErrors = true;
    });

    await page.route('**/api/health', route => route.fulfill({ json: healthResponse }));
    await page.route('**/api/models', route => route.fulfill({ json: modelsResponse }));
    await page.route('**/api/hardware', route => route.fulfill({ json: hardwareResponse }));
    await page.route('**/api/settings', route => route.fulfill({ json: settingsResponse }));
    // RuntimeService.snapshot() calls /api/runtime (not /api/runtime/snapshot).
    await page.route('**/api/runtime', route => route.fulfill({ json: runtimeResponse }));
    await page.route('**/api/runtime/installations', route => route.fulfill({ json: installationsResponse }));
    await page.route('**/api/models/residency', route => route.fulfill({ json: residencyPayload() }));
    await page.route('**/api/resources', route => route.fulfill({ json: resourceResponse }));
    await page.route('**/api/models/residency/actions', async route => {
      const action = route.request().postDataJSON()?.action;
      if (action === 'pin' || action === 'unpin') {
        residentItems = residentItems.map(model => ({ ...model, pinned: action === 'pin' }));
      } else if (action === 'unload') {
        residentItems = [];
      }
      await route.fulfill({ json: residencyPayload() });
    });
    await page.route('**/api/capability-preferences', async route => {
      if (route.request().method() === 'PATCH') {
        const defaults = route.request().postDataJSON()?.selection_defaults || {};
        selectionMode = defaults.mode || selectionMode;
        evictionPolicy = defaults.eviction_policy || evictionPolicy;
      }
      await route.fulfill({ json: { data: { selection_defaults: { mode: selectionMode, eviction_policy: evictionPolicy } } } });
    });

    console.log('Testing Hardware page...');
    await page.goto(`${server.url}/hardware`);
    await expect(page.getByRole('heading', { name: 'Hardware', level: 1 })).toBeVisible();
    const topbar = page.locator('.topbar');
    await expect.poll(() => topbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const resourceChip = page.locator('.resource-chip');
    await expect(resourceChip).toContainText('GPU0');
    await expect(resourceChip).toContainText('RAM 39.1 GiB free');
    await expect(resourceChip).toContainText('1 loaded');
    const modePicker = page.getByRole('combobox', { name: 'Global orchestration mode' });
    await expect(modePicker).toHaveValue('auto');
    await modePicker.selectOption('guided');
    await expect(modePicker).toHaveValue('guided');
    await modePicker.selectOption('manual');
    await expect(modePicker).toHaveValue('manual');
    await modePicker.selectOption('auto');
    await expect(modePicker).toHaveValue('auto');
    await expect(page.getByRole('heading', { name: 'AMD Ryzen 9 7950X 16-Core Processor' })).toBeVisible();
    await expect(page.getByText('System memory')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Radeon RX 7900 XTX' })).toBeVisible();
    await expect(page.getByText('21.4 GB')).toBeVisible();
    const json = page.getByRole('region', { name: 'Raw hardware response' }).locator('pre');
    await expect(json).toHaveCount(0);
    await page.getByRole('button', { name: 'Show JSON' }).click();
    await expect(json).toContainText('Radeon RX 7900 XTX');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'hardware-page.png'), fullPage: true });

    console.log('Testing Settings page...');
    await page.goto(`${server.url}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Application behavior' })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-page-general.png'), fullPage: true });

    await page.getByRole('tab', { name: 'Runtimes' }).click();
    await expect(page.getByRole('heading', { name: 'Runtime defaults' })).toBeVisible();
    const backend = page.locator('label').filter({ hasText: 'Default backend' }).locator('select');
    const runtime = page.locator('label').filter({ hasText: 'Default runtime' }).locator('select');
    await expect(backend.locator('option', { hasText: 'vulkan' })).toBeAttached();
    await expect(backend.locator('option', { hasText: 'cpu' })).toHaveAttribute('disabled', '');
    await backend.selectOption('vulkan');
    await expect(backend).toHaveValue('vulkan');
    await expect(runtime.locator('option', { hasText: 'llama.cpp v1.0' })).toBeEnabled();
    await runtime.selectOption('llama-cpp-1');
    await expect(runtime).toHaveValue('llama-cpp-1');
    await expect(page.getByText(/Context size, GPU placement, split mode, tensor split/)).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-page-runtime.png'), fullPage: true });

    console.log('Testing Resources residency controls...');
    await page.goto(`${server.url}/resources`);
    await expect(page.getByRole('heading', { name: 'Resources', level: 1 })).toBeVisible();
    const eviction = page.getByRole('combobox', { name: 'Default model eviction policy' });
    await expect(eviction).toHaveValue('lru');
    await eviction.selectOption('never');
    await expect.poll(() => evictionPolicy).toBe('never');
    await page.getByRole('button', { name: /fixture\/model\.gguf/ }).click();
    await expect(page.getByRole('heading', { name: 'fixture/model.gguf' })).toBeVisible();
    await page.getByRole('button', { name: 'Pin model' }).click();
    const selectedModel = page.getByRole('complementary', { name: 'Selected model residency' });
    await expect(selectedModel.getByText('Pinned', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unpin model' }).click();
    await expect(selectedModel.getByText('Not pinned', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unload idle model' })).toBeEnabled();
    await page.getByRole('button', { name: 'Unload idle model' }).click();
    await expect(page.getByText('No loaded model residency records were reported.')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Default model eviction policy' })).toHaveValue('never');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'resources-residency.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${server.url}/hardware`);
    await expect(page.getByRole('heading', { name: 'Hardware Topology', level: 1 })).toBeVisible();
    let width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
    if (width.page > width.viewport + 1) throw new Error(`Hardware page overflows mobile viewport: ${width.page}px > ${width.viewport}px.`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'hardware-page-mobile.png'), fullPage: true });
    await page.goto(`${server.url}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
    if (width.page > width.viewport + 1) throw new Error(`Settings page overflows mobile viewport: ${width.page}px > ${width.viewport}px.`);

    if (hasErrors) throw new Error('Browser console or page errors were reported.');
    console.log(`Hardware and Settings UI smoke passed. Screenshots: ${SCREENSHOT_DIR}`);
  } finally {
    await browser?.close();
    await stopProcess(server?.vite);
  }
}

runSmokeTests().catch(error => {
  console.error('UI smoke failed:', error);
  process.exitCode = 1;
});
