import { expect, chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, '..');
const screenshotDir = path.resolve(webDir, '../artifacts/ui-smoke/model-studio');
const alphaPath = '/models/alpha.gguf';
const betaPath = '/models/beta.gguf';
const model = (id, name, modelPath) => ({
  id, path: modelPath, name, format: 'gguf', size: 1_000_000_000, metadata: { 'general.name': name },
});

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const executablePath = process.env.CHROME_BIN || [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find(candidate => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const unmatchedApiRequests = [];
  const unexpectedMutatingApiRequests = [];
  const profileRequests = [];
  const pageErrors = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.route('**/*', async (route, request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        const readOnlyFixtures = {
          '/api/capability-preferences': { data: { selection_defaults: { mode: 'auto' } } },
          '/api/resources': { data: { resources: { ram: {}, gpus: [], loaded_models: [], pending_reservations: [] }, status: 'observed' } },
          '/api/models/residency': { data: { residency: { items: [], count: 0, status: 'observed' } } },
        };
        if (request.method() === 'GET' && readOnlyFixtures[url.pathname]) {
          await route.fulfill({ json: readOnlyFixtures[url.pathname] });
          return;
        }
        if (request.method() !== 'GET') unexpectedMutatingApiRequests.push(`${request.method()} ${url.pathname}`);
        unmatchedApiRequests.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: `No fixture for ${url.pathname}` }) });
        return;
      }
      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        const assetPath = path.join(webDir, 'dist', url.pathname.replace(/^\//, ''));
        if (fs.existsSync(assetPath)) {
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: fs.readFileSync(assetPath) });
          return;
        }
        throw new Error(`Built asset not found: ${assetPath}`);
      }
      const index = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
      await route.fulfill({ status: 200, contentType: 'text/html', body: index.replace('<base href="/">', '<base href="http://localhost:4200/">') });
    });

    await page.route('**/api/health', route => route.fulfill({ json: { data: { status: 'ok' } } }));
    await page.route('**/api/model-sources', route => route.fulfill({ json: { data: { sources: [] } } }));
    await page.route('**/api/models', route => route.fulfill({ json: { data: { models: [
      model('alpha', 'Alpha model', alphaPath), model('beta', 'Beta model', betaPath),
    ] } } }));
    await page.route('**/api/runtime', route => route.fulfill({ json: { data: {
      backends: [], devices: [], status: { loaded: true, model: alphaPath },
    } } }));
    await page.route('**/api/runtime/status', route => route.fulfill({ json: { data: {
      status: { loaded: true, model_path: alphaPath },
    } } }));
    await page.route('**/api/runtime/installations', route => route.fulfill({ json: { data: { installations: [] } } }));
    await page.route(/\/api\/model-profiles(?:\?.*)?$/, async route => {
      const modelId = new URL(route.request().url()).searchParams.get('model_id');
      profileRequests.push(modelId);
      if (modelId === 'alpha') await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({ json: { data: { profiles: [{ id: `${modelId}-profile`, model_id: modelId, name: `${modelId} preset`, placement: {}, load: {} }] } } });
    });

    await page.goto('http://localhost:4200/models');
    const alphaCard = page.locator('.model-card').filter({ hasText: 'Alpha model' });
    await expect(alphaCard.locator('.loaded-tag')).toHaveText('● LOADED');
    await alphaCard.getByRole('button', { name: /Alpha model/ }).click();
    await expect(alphaCard.getByRole('button', { name: 'Unload current model' })).toBeEnabled();
    await alphaCard.getByRole('button', { name: 'Refresh status' }).click();
    await expect(alphaCard.getByRole('button', { name: 'Unload current model' })).toBeEnabled();

    const betaCard = page.locator('.model-card').filter({ hasText: 'Beta model' });
    await betaCard.getByRole('button', { name: /Beta model/ }).click();
    const presetSelect = betaCard.getByLabel('Saved preset');
    await expect(presetSelect.locator('option', { hasText: 'beta preset' })).toBeAttached();
    await page.waitForTimeout(650);
    await expect(presetSelect.locator('option', { hasText: 'alpha preset' })).toHaveCount(0);
    await expect(presetSelect.locator('option', { hasText: 'beta preset' })).toHaveCount(1);
    await page.screenshot({ path: path.join(screenshotDir, 'model-studio.png'), fullPage: true });

    expect(profileRequests).toEqual(['alpha', 'beta']);
    expect(unmatchedApiRequests).toEqual([]);
    expect(unexpectedMutatingApiRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    console.log(`Model Studio UI smoke passed. Screenshot: ${screenshotDir}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('Model Studio smoke failed:', error);
  process.exitCode = 1;
});
