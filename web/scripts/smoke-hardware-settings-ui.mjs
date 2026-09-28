import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { promises as fs, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import finalhandler from 'finalhandler';
import serveStatic from 'serve-static';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(scriptDir, '../dist');
const artifactDir = join(scriptDir, '../../artifacts/ui-smoke');
const viewport = { width: 1320, height: 900 };
const hardwareFixture = {
  data: {
    hardware: {
      cpu: { name: 'Smoke CPU', physical_cores: 8, logical_cores: 16 },
      ram: { total_bytes: 32 * 1024 ** 3, available_bytes: 12 * 1024 ** 3 },
      os: { system: 'Linux', release: '6.8.0', version: 'test', architecture: 'x86_64', distribution: 'Smoke Linux' },
      gpus: [{
        index: 0, vendor: 'AMD', name: 'Smoke GPU', memory_total_bytes: 16 * 1024 ** 3,
        memory_free_bytes: 6 * 1024 ** 3, backends: ['rocm'], pci_address: '0000:03:00.0',
        virtual: false, pci_vendor_id: 0x1002, pci_device_id: 0x744c
      }]
    }
  }
};

function assertInsideViewport(box, label) {
  if (!box) throw new Error(`${label} has no visible layout box`);
  const epsilon = 1;
  if (box.x < -epsilon || box.y < -epsilon || box.x + box.width > viewport.width + epsilon || box.y + box.height > viewport.height + epsilon) {
    throw new Error(`${label} is clipped or outside the ${viewport.width}x${viewport.height} viewport: ${JSON.stringify(box)}`);
  }
}

async function assertStyled(locator, label) {
  const style = await locator.evaluate(element => {
    const css = getComputedStyle(element);
    return { background: css.backgroundColor, image: css.backgroundImage, borderRadius: css.borderRadius, padding: css.padding };
  });
  if ((style.background === 'rgba(0, 0, 0, 0)' && style.image === 'none') || style.borderRadius === '0px' || style.padding === '0px') {
    throw new Error(`${label} is missing its component styling: ${JSON.stringify(style)}`);
  }
}

async function main() {
  await fs.mkdir(artifactDir, { recursive: true });
  const serve = serveStatic(distDir, { index: ['index.html'] });
  const server = createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (req.url && !req.url.split('?')[0].includes('.')) req.url = '/index.html';
    serve(req, res, finalhandler(req, res));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  let browser;
  const pageErrors = [];
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not resolve the smoke server address');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const systemChrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
      .find(path => path && existsSync(path));
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
      ...(systemChrome ? { executablePath: systemChrome } : {})
    });
    const context = await browser.newContext({ viewport });
    await context.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } });
      if (pathname === '/api/hardware') return route.fulfill({ json: hardwareFixture });
      if (pathname === '/api/settings' && method === 'GET') return route.fulfill({ json: { data: { settings: {
        runtime_defaults: { backend_name: 'vulkan', runtime_id: 'runtime-1', placement: {}, load: {} },
        managed_models_dir: '/models', config_dir: '/config', data_dir: '/data',
        default_profile_behavior: 'model', keep_last_model_loaded: true
      } } } });
      if (pathname === '/api/settings' && method === 'PATCH') return route.fulfill({ json: { data: { settings: JSON.parse(route.request().postData() || '{}') } } });
      if (pathname === '/api/settings' && method === 'POST') return route.fulfill({ json: { data: { settings: JSON.parse(route.request().postData() || '{}') } } });
      if (pathname === '/api/runtime') return route.fulfill({ json: { data: { backends: [
        { name: 'vulkan', available: true, capabilities: {} }, { name: 'cpu', available: true, capabilities: {} }
      ], devices: [], status: null } } });
      if (pathname === '/api/runtime/installations') return route.fulfill({ json: { data: { installations: [
        { id: 'runtime-1', name: 'Local llama.cpp', backend: 'vulkan', enabled: true, available: true }
      ] } } });
      if (pathname === '/api/models') return route.fulfill({ json: { data: { models: [] } } });
      return route.fulfill({ status: 404, json: { error: `Unexpected smoke API request: ${method} ${pathname}` } });
    });

    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });

    await page.goto(`${baseUrl}/hardware`, { waitUntil: 'networkidle' });
    const hardwareTitle = page.getByRole('heading', { name: 'Hardware', exact: true });
    await expect(hardwareTitle).toBeVisible();
    await expect(page.getByText('Smoke CPU')).toBeVisible();
    await expect(page.getByText('Smoke GPU')).toBeVisible();
    await expect(page.getByText('6.0 GB free')).toBeVisible();
    await expect(page.getByText('rocm')).toBeVisible();
    await expect(page.getByLabel('Raw hardware response')).toHaveCount(0);

    const hardwareCard = page.locator('.hardware-card').first();
    await assertStyled(hardwareCard, 'Hardware summary card');
    assertInsideViewport(await hardwareTitle.boundingBox(), 'Hardware heading');
    assertInsideViewport(await page.locator('.gpu-card').boundingBox(), 'GPU card');
    await page.screenshot({ path: join(artifactDir, 'hardware.png') });

    await page.getByRole('button', { name: 'Show JSON' }).click();
    await expect(page.getByLabel('Raw hardware response')).toBeVisible();
    await expect(page.getByText('memory_total_bytes')).toBeVisible();
    await page.getByRole('button', { name: 'Hide JSON' }).last().click();
    await expect(page.getByLabel('Raw hardware response')).toHaveCount(0);

    await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Local API' })).toBeVisible();
    await expect(page.getByText('Managed models directory')).toBeVisible();
    const settingsCard = page.locator('.settings-card').first();
    await assertStyled(settingsCard, 'Settings card');
    assertInsideViewport(await settingsCard.boundingBox(), 'Settings card');
    await page.screenshot({ path: join(artifactDir, 'settings.png') });

    await page.getByRole('tab', { name: 'Runtime defaults' }).click();
    await expect(page.getByLabel('Default backend')).toBeVisible();
    await expect(page.getByText(/Configure them in the model profile/)).toBeVisible();
    assertInsideViewport(await page.locator('.runtime-card').boundingBox(), 'Runtime defaults card');
    await page.screenshot({ path: join(artifactDir, 'settings-runtime.png') });
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(' | ')}`);
    console.log(`UI smoke passed at ${viewport.width}x${viewport.height}; screenshots: ${artifactDir}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
