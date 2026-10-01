import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(webDir, 'dist');
const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(candidate => fs.existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
let apiOffline = false;
let resourceFailure = false;
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/health' && apiOffline) return route.fulfill({ status: 503, json: { error: 'fixture offline' } });
    if (resourceFailure && ['/api/resources', '/api/models/residency'].includes(url.pathname)) return route.fulfill({ status: 503, json: { error: 'fixture resource failure' } });
    const body = url.pathname === '/api/health'
      ? { data: { status: 'ok', service: 'ai-dream' } }
      : url.pathname === '/api/resources'
        ? { data: { resources: { ram: { available_bytes: 23 * 1024 ** 3, total_bytes: 32 * 1024 ** 3 }, gpus: [
          { id: 'gpu0', index: 0, free_vram_bytes: 10.2 * 1024 ** 3, total_vram_bytes: 16 * 1024 ** 3 },
          { id: 'gpu1', index: 1, free_vram_bytes: null, total_vram_bytes: null },
        ], loaded_models: [] } } }
        : url.pathname === '/api/models/residency'
          ? { data: { residency: { items: [{ model_id: 'fixture-chat' }, { model_id: 'fixture-vision' }] } } }
          : { data: { selection_defaults: { eviction_policy: 'lru' } } };
    return route.fulfill({ json: body });
  }
  const assetPath = path.join(distDir, url.pathname.replace(/^\//, ''));
  if (/\.(js|css)$/.test(url.pathname) && fs.existsSync(assetPath)) {
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: fs.readFileSync(assetPath) });
  }
  const index = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  return route.fulfill({ status: 200, contentType: 'text/html', body: index.replace('<base href="/">', '<base href="http://localhost:4200/">') });
});

try {
  await page.goto('http://localhost:4200/chat');
  const topbar = page.locator('.topbar');
  await expect(topbar.getByRole('link', { name: 'Local API online' })).toHaveCount(1);
  await expect(topbar.getByRole('link', { name: /Open Resources/ })).toBeVisible();
  const healthyResources = topbar.getByRole('link', { name: /Open Resources/ });
  await expect(healthyResources).toContainText('GPU0 10.2 GiB/16.0 GiB · GPU1 Unknown/Unknown · RAM 23.0 GiB free · 2 loaded');
  await expect(healthyResources).toHaveAttribute('aria-label', /GPU0 10\.2 GiB\/16\.0 GiB.*RAM 23\.0 GiB free.*2 loaded/);
  await expect(page.locator('.sidebar')).not.toContainText(/LOCAL API|ONLINE|OFFLINE/);
  await expect(page.locator('.statusbar')).not.toContainText(/LOCAL API|ENDPOINT|Connected|Unavailable/);
  await expect(page.locator('.statusbar')).toContainText('LOCAL ONLY');

  resourceFailure = true;
  await page.reload();
  const resourcesLink = topbar.getByRole('link', { name: /Open Resources/ });
  await expect(resourcesLink).toContainText('Resources need attention');
  await expect(resourcesLink).toHaveAttribute('aria-label', /Open Resources · /);
  await expect(resourcesLink).toHaveClass(/resource-alert/);
  await resourcesLink.click();
  await expect(page).toHaveURL(/\/resources$/);

  apiOffline = true;
  await page.goto('http://localhost:4200/chat');
  const apiLink = page.locator('.topbar').getByRole('link', { name: /Local API needs attention/ });
  await expect(apiLink).toBeVisible();
  await expect(apiLink).toContainText('API Offline');
  await apiLink.click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:4200/chat');
  await expect(page.locator('.topbar').getByRole('link', { name: /Local API needs attention/ })).toBeVisible();
  const mobileResources = page.locator('.topbar').getByRole('link', { name: /Open Resources/ });
  await expect(mobileResources).toBeVisible();
  await expect(mobileResources).toHaveAttribute('aria-label', /Open Resources · Http failure response/);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.width <= dimensions.viewport, `Shell overflows mobile viewport: ${dimensions.width}px > ${dimensions.viewport}px`);
  assert.deepEqual(pageErrors, [], 'Shell telemetry smoke should not produce browser runtime errors');
  console.log('Shell telemetry has one actionable API status, one-click Resources access, visible resource errors, and a non-overflowing 390 px offline state.');
} finally {
  await context.close();
  await browser.close();
}
