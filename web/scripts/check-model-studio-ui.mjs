import { expect, chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, '..');
const screenshotDir = path.resolve(webDir, '../artifacts/ui-smoke/model-studio');
const alphaPath = '/models/alpha.gguf';
const betaPath = '/models/beta.gguf';
const model = (id, name, modelPath, metadata = {}) => ({
  id, path: modelPath, name, format: 'gguf', size: 1_000_000_000, metadata: { 'general.name': name, ...metadata },
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
  const loadRequests = [];
  const verificationRequests = [];
  let betaVerified = false;
  let failNextLoad = true;
  const pageErrors = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.route('**/*', async (route, request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        const readOnlyFixtures = {
          '/api/capability-preferences': { data: { selection_defaults: { mode: 'auto' } } },
          '/api/resources': { data: { resources: { ram: {}, gpus: [], loaded_models: [{ model_id: 'alpha', state: 'idle' }], pending_reservations: [] }, status: 'observed' } },
          '/api/models/residency': { data: { residency: { items: [{ model_id: 'alpha', state: 'idle' }], count: 1, status: 'observed' } } },
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
      model('alpha', 'Alpha model', alphaPath), model('beta', 'Beta model', betaPath, { 'ai_dream.input_modalities': ['Image'] }),
    ] } } }));
    await page.route('**/api/capabilities', route => route.fulfill({ json: { data: { capabilities: [
      { id: 'text.chat', status: 'supported', inputs: [{ kind: 'text' }], outputs: [{ kind: 'text' }], evidence: [],
        routes: [{ id: 'route-alpha-chat', model_id: 'alpha', runtime_id: 'llama.cpp' }] },
      { id: 'vision.understand', status: 'supported', inputs: [{ kind: 'image' }], outputs: [{ kind: 'text' }], evidence: [],
        routes: [{ id: 'route-beta-vision', model_id: 'beta', runtime_id: 'llama.cpp' }] },
    ] } } }));
    const manifestRows = () => [
      { id: 'local.alpha', display_name: 'Alpha model', artifacts: [{ role: 'model', model_id: 'alpha' }],
        provenance: { source: 'verified_run', status: 'verified', verified_at: '2026-10-01T10:00:00Z' } },
      { id: 'local.beta', display_name: 'Beta model', artifacts: [{ role: 'model', model_id: 'beta' }, { role: 'projector', model_id: 'mmproj-beta', optional: true }],
        description: 'Fixture vision model', modalities: { inputs: ['image'], outputs: ['text'] },
        capabilities: [{ id: 'vision.understand', inputs: [{ kind: 'image' }], outputs: [{ kind: 'text' }], features: [],
          evidence: betaVerified ? { source: 'verified_run', status: 'verified', verified_at: '2026-10-01T11:00:00Z' }
            : { source: 'model_metadata', status: 'unknown' } }],
        provenance: betaVerified
          ? { source: 'verified_run', status: 'verified', verified_at: '2026-10-01T11:00:00Z' }
          : { source: 'model_metadata', status: 'unknown' } },
    ];
    await page.route('**/api/model-manifests', route => route.fulfill({ json: { data: { manifests: manifestRows() } } }));
    await page.route(/\/api\/model-manifests\/[^/]+$/, async route => {
      const id = new URL(route.request().url()).pathname.split('/').pop();
      const manifest = manifestRows().find(item => item.id === id);
      if (!manifest) return route.fulfill({ status: 404, json: { error: 'No fixture manifest' } });
      const available = id === 'local.beta';
      await route.fulfill({ json: { data: { manifest, verification_available: available,
        verification_unavailable_reason: available ? null : 'No bounded local semantic verifier is configured.',
        verification: betaVerified ? { success: true, completed_at: '2026-10-01T11:00:00Z' } : null } } });
    });
    await page.route(/\/api\/model-manifests\/[^/]+\/verify$/, async route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      verificationRequests.push({ id, body: route.request().postDataJSON() });
      if (id !== 'local.beta') return route.fulfill({ status: 404, json: { error: 'No verifier fixture' } });
      betaVerified = true;
      await route.fulfill({ json: { data: { verification: { success: true, completed_at: '2026-10-01T11:00:00Z' },
        profile: { id: 'beta-verified-profile', model_id: 'beta' }, manifest: manifestRows()[1] } } });
    });
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
    await page.route('**/api/chats', route => route.fulfill({ json: { data: { chats: [] } } }));
    await page.route('**/api/skills', route => route.fulfill({ json: { data: { skills: [] } } }));
    await page.route('**/api/runtime/load', async route => {
      const request = route.request();
      loadRequests.push(JSON.parse(request.postData() || '{}'));
      if (failNextLoad) {
        failNextLoad = false;
        await route.fulfill({ status: 503, json: { error: 'Fixture load failure' } });
        return;
      }
      await route.fulfill({ json: { data: { status: { loaded: true, model_path: betaPath } } } });
    });

    await page.goto('http://localhost:4200/models');
    const alphaCard = page.locator('.model-card').filter({ hasText: 'Alpha model' });
    await expect(alphaCard.locator('.model-state.present')).toHaveText('● PRESENT');
    await expect(alphaCard.locator('.model-state.runnable')).toHaveText('↗ RUNNABLE');
    await expect(alphaCard.locator('.model-state.verified')).toHaveText('✓ VERIFIED');
    await expect(alphaCard.locator('.loaded-tag')).toHaveText('● LOADED');
    await expect(alphaCard.locator('.capability-role')).toHaveText('ROLE Unknown');
    await expect(alphaCard.locator('.capability-tag')).toHaveCount(0);
    await alphaCard.getByRole('button', { name: /Alpha model/ }).click();
    await expect(alphaCard.getByText(/No bounded local semantic verifier is configured/)).toBeVisible();
    await expect(alphaCard.getByRole('button', { name: 'Verify on local runtime' })).toHaveCount(0);
    await expect(alphaCard.getByRole('button', { name: 'Unload current model' })).toBeEnabled();
    await alphaCard.getByRole('button', { name: 'Refresh status' }).click();
    await expect(alphaCard.getByRole('button', { name: 'Unload current model' })).toBeEnabled();

    const betaCard = page.locator('.model-card').filter({ hasText: 'Beta model' });
    await expect(betaCard.locator('.model-state.present')).toHaveText('● PRESENT');
    await expect(betaCard.locator('.model-state.runnable')).toHaveText('↗ RUNNABLE');
    await expect(betaCard.locator('.model-state.verified')).toHaveCount(0);
    await betaCard.getByRole('button', { name: /Beta model/ }).click();
    await expect(betaCard.getByText('Fixture vision model')).toBeVisible();
    await expect(betaCard.getByText(/projector · mmproj-beta · optional/)).toBeVisible();
    await expect(betaCard.getByRole('button', { name: 'Verify on local runtime' })).toBeEnabled();
    const presetSelect = betaCard.getByLabel('Saved preset');
    await expect(betaCard.locator('.capability-role')).toHaveText('ROLE Unknown');
    await expect(betaCard.locator('.capability-tag')).toHaveCount(1);
    await expect(betaCard.locator('.capability-tag')).toHaveText('IN Image');
    await expect(presetSelect.locator('option', { hasText: 'beta preset' })).toBeAttached();
    await page.waitForTimeout(650);
    await expect(presetSelect.locator('option', { hasText: 'alpha preset' })).toHaveCount(0);
    await expect(presetSelect.locator('option', { hasText: 'beta preset' })).toHaveCount(1);
    await page.evaluate(() => { const content = document.querySelector('.content'); if (content) content.scrollTop = 0; });
    await page.screenshot({ path: path.join(screenshotDir, 'model-studio.png'), fullPage: true });
    await page.locator('.content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: path.join(screenshotDir, 'model-studio-detail.png'), fullPage: true });

    expect(profileRequests).toEqual(['alpha', 'beta']);

    await page.goto('http://localhost:4200/models?model_id=beta&profile_id=beta-profile');
    const linkedBeta = page.locator('.model-card').filter({ hasText: 'Beta model' });
    await expect(linkedBeta.locator('.model-config')).toBeVisible();
    await expect(linkedBeta.getByLabel('Saved preset')).toHaveValue('beta-profile');
    await page.reload();
    const reloadedBeta = page.locator('.model-card').filter({ hasText: 'Beta model' });
    await expect(reloadedBeta.locator('.model-config')).toBeVisible();
    await expect(reloadedBeta.getByLabel('Saved preset')).toHaveValue('beta-profile');
    await reloadedBeta.getByRole('button', { name: 'Runtime settings' }).click();
    await expect(page).toHaveURL(/\/runtime\?model_id=beta&profile_id=beta-profile/);
    await expect(page.locator('.model-select-field select')).toHaveValue('beta');
    await page.getByRole('button', { name: 'Back to Models' }).click();
    await expect(page).toHaveURL(/\/models\?model_id=beta&profile_id=beta-profile/);
    const returnedBeta = page.locator('.model-card').filter({ hasText: 'Beta model' });
    await expect(returnedBeta.locator('.model-config')).toBeVisible();
    await expect(returnedBeta.getByLabel('Saved preset')).toHaveValue('beta-profile');
    await returnedBeta.getByRole('button', { name: 'Verify on local runtime' }).click();
    await expect(returnedBeta.locator('.model-state.verified')).toHaveText('✓ VERIFIED');
    await expect(returnedBeta.getByText(/Runtime verification succeeded at 2026-10-01T11:00:00Z/)).toBeVisible();
    expect(verificationRequests).toEqual([{ id: 'local.beta', body: {} }]);
    await returnedBeta.getByRole('button', { name: 'Load model' }).click();
    await expect(returnedBeta.locator('.model-state.failed')).toHaveText('! ERROR');
    await expect(page.getByRole('alert')).toContainText('The local model request failed.');
    await returnedBeta.getByRole('button', { name: 'Load model' }).click();
    await expect(returnedBeta.getByText('Loaded in memory')).toBeVisible();
    await expect(returnedBeta.locator('.model-state.failed')).toHaveCount(0);
    expect(loadRequests).toEqual([
      { model_id: 'beta', placement: {}, load: {} },
      { model_id: 'beta', placement: {}, load: {} },
    ]);
    await returnedBeta.getByRole('button', { name: 'Use in Chat' }).click();
    await expect(page).toHaveURL(/\/chat\?model_id=beta&profile_id=beta-profile/);
    await expect(page.locator('#chat-model')).toHaveValue('beta');
    await expect(page.getByLabel('PROFILE')).toHaveValue('beta-profile');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost:4200/models?model_id=beta&profile_id=beta-profile');
    const mobileBeta = page.locator('.model-card').filter({ hasText: 'Beta model' });
    await expect(mobileBeta.locator('.model-config')).toBeVisible();
    await expect(mobileBeta.getByLabel('Saved preset')).toHaveValue('beta-profile');
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(mobileOverflow, 'Model Studio detail and profile controls should fit 390 px').toBe(false);
    await page.locator('.content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(mobileBeta.getByRole('button', { name: 'Update preset' })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDir, 'model-studio-mobile.png'), fullPage: true });

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
