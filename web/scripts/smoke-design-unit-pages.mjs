import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
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
  if (await Promise.race([stopped, timeout]) === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await stopped;
  }
}

const hubModels = { data: { items: [
  { repo_id: 'fixture/Orion-7B-GGUF', downloads: 1250, likes: 42, pipeline_tag: 'text-generation', last_modified: '2026-10-01' }
] } };
const hubFiles = { data: { files: [
  { file_name: 'orion-7b-q4_k_m.gguf', size_bytes: 4_200_000_000, quantization: 'Q4_K_M' }
] } };
const toolCatalog = { data: {
  tools: [
    { name: 'hardware.summary', description: 'Read detected hardware summary.', parameters: {}, read_only: true },
    { name: 'models.search', description: 'Search the local model catalog.', parameters: { query: 'string' }, read_only: true },
    { name: 'runtime.status', description: 'Inspect runtime status.', parameters: {}, read_only: true }
  ],
  limits: { max_tool_calls: 8, max_seconds: 30, max_output_chars: 6000 },
  policy: { filesystem_write: false, shell: false, network_tools: false }
} };
const logSnapshot = { data: {
  lines: ['fixture startup: runtime ready', 'fixture request: GET /api/health 200'], source: 'fixture llama-server', supported: true, loaded: true, limit: 200
} };
const diagnostics = { data: { events: [
  { timestamp: '2026-10-03T08:00:00Z', incident_id: 'fixture-incident-01', level: 'error', operation: 'model.load', error_type: 'FixtureError', detail: 'Fixture diagnostic event for UI coverage.', chat_id: 'fixture-chat-01' }
] } };
let healthUnavailable = false;
let hubNoResults = false;
let toolsUnavailable = false;
let emptyLogs = false;
let emptyDiagnostics = false;

async function run() {
  let server;
  let browser;
  try {
    server = await startVite();
    const executablePath = process.env.CHROME_BIN || [
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
    ].find(candidate => existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    const unexpectedRequests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') && ![
        '/api/health', '/api/downloads', '/api/hub/search', '/api/hub/repos/fixture%2FOrion-7B-GGUF/files',
        '/api/agent/tools', '/api/logs', '/api/diagnostics', '/api/resources', '/api/models/residency',
        '/api/capability-preferences'
      ].includes(url.pathname)) unexpectedRequests.push(`${request.method()} ${url.pathname}`);
    });
    page.on('pageerror', error => unexpectedRequests.push(`pageerror: ${error.message}`));

    await page.route('**/api/health', route => route.fulfill({
      status: healthUnavailable ? 503 : 200,
      json: healthUnavailable ? { error: 'Fixture API unavailable' } : { data: { status: 'ok', version: 'fixture' } }
    }));
    await page.route('**/api/resources', route => route.fulfill({ json: { data: { resources: { ram: {}, gpus: [], loaded_models: [], pending_reservations: [] }, status: 'observed' } } }));
    await page.route('**/api/capability-preferences', route => route.fulfill({ json: { data: { selection_defaults: { mode: 'auto', eviction_policy: 'lru' } } } }));
    await page.route('**/api/models/residency', route => route.fulfill({ json: { data: { residency: { items: [], count: 0, active_lease_count: 0, status: 'observed', source: 'fixture' } } } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { data: { downloads: [] } } }));
    await page.route('**/api/hub/search**', route => route.fulfill({ json: hubNoResults ? { data: { items: [] } } : hubModels }));
    await page.route('**/api/hub/repos/**/files', route => route.fulfill({ json: hubFiles }));
    await page.route('**/api/agent/tools', route => route.fulfill({
      status: toolsUnavailable ? 503 : 200,
      json: toolsUnavailable ? { error: 'Fixture tool registry unavailable' } : toolCatalog
    }));
    await page.route('**/api/logs**', route => route.fulfill({ json: emptyLogs ? {
      data: { lines: [], source: null, supported: false, loaded: false, limit: 200 }
    } : logSnapshot }));
    await page.route('**/api/diagnostics**', route => route.fulfill({ json: emptyDiagnostics ? { data: { events: [] } } : diagnostics }));

    console.log('Model Hubs: search and inspect fixture repository files');
    await page.goto(`${server.url}/hub`);
    await expect(page.getByRole('heading', { name: /Model Hubs/ })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search Hugging Face models' }).fill('Orion');
    await page.getByRole('button', { name: 'Search repositories' }).click();
    await page.getByRole('button', { name: /fixture\/Orion-7B-GGUF/ }).click();
    await expect(page.getByRole('heading', { name: 'fixture/Orion-7B-GGUF' })).toBeVisible();
    await expect(page.getByText('orion-7b-q4_k_m.gguf')).toBeVisible();
    hubNoResults = true;
    await page.getByRole('searchbox', { name: 'Search Hugging Face models' }).fill('no-match');
    await page.getByRole('button', { name: 'Search repositories' }).click();
    await expect(page.getByRole('heading', { name: 'No repositories found' })).toBeVisible();
    hubNoResults = false;

    console.log('Local API Server: connected state and implemented endpoint list');
    await page.goto(`${server.url}/local-api`);
    await expect(page.getByRole('heading', { name: 'Local API Server' })).toBeVisible();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByText('GET /api/health', { exact: true })).toBeVisible();
    await expect(page.getByText('127.0.0.1', { exact: true })).toBeVisible();
    healthUnavailable = true;
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(page.getByText('UNAVAILABLE', { exact: true })).toBeVisible();
    await expect(page.getByText('Could not reach local API')).toBeVisible();
    healthUnavailable = false;

    console.log('Tools & Permissions: registry, limits, and blocked policy');
    await page.goto(`${server.url}/tools-permissions`);
    await expect(page.getByRole('heading', { name: 'Tools & Permissions' })).toBeVisible();
    await expect(page.getByText('3 REGISTERED')).toBeVisible();
    await expect(page.getByText('hardware.summary')).toBeVisible();
    await expect(page.getByText('8 max')).toBeVisible();
    await expect(page.getByText('Arbitrary shell commands').locator('..').getByText('BLOCKED')).toBeVisible();
    await expect(page.getByText('Filesystem writes / deletion').locator('..').getByText('BLOCKED')).toBeVisible();
    await expect(page.getByText('Network tools').locator('..').getByText('BLOCKED')).toBeVisible();
    toolsUnavailable = true;
    await page.getByRole('button', { name: /Refresh registry/ }).click();
    await expect(page.getByText('REGISTRY UNAVAILABLE')).toBeVisible();
    await expect(page.getByText('Could not read the local agent registry')).toBeVisible();
    toolsUnavailable = false;

    console.log('Logs & Traces: runtime output, filter, and application incident');
    await page.goto(`${server.url}/logs`);
    await expect(page.getByRole('heading', { name: 'Logs & Traces' })).toBeVisible();
    await expect(page.getByText('fixture startup: runtime ready')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Filter log text' }).fill('startup');
    await expect(page.getByText('fixture request: GET /api/health 200')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Filter log text' }).fill('');
    await page.getByRole('tab', { name: /Application errors/ }).click();
    await expect(page.getByText('fixture-incident-01')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Filter application errors' }).fill('absent');
    await expect(page.getByText('No incidents match this filter')).toBeVisible();
    emptyDiagnostics = true;
    await page.getByRole('searchbox', { name: 'Filter application errors' }).fill('');
    await page.getByRole('button', { name: /Refresh/ }).click();
    await expect(page.getByText('No application errors recorded')).toBeVisible();
    emptyLogs = true;
    await page.getByRole('tab', { name: /Runtime output/ }).click();
    await page.getByRole('button', { name: /Refresh/ }).click();
    await expect(page.getByText('This runtime does not expose captured server output')).toBeVisible();

    expect(unexpectedRequests, `Unexpected API requests or browser errors: ${unexpectedRequests.join(', ')}`).toEqual([]);
    console.log('PASS: all four design-mapped routes rendered and exercised with fixture responses only.');
  } finally {
    await browser?.close();
    await stopProcess(server?.vite);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
