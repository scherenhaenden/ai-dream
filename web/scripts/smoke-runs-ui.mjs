import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_BIN || [
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(candidate => fs.existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    const fixtures = {
      '/api/health': { data: { status: 'ok', service: 'ai-dream' } },
      '/api/runs': { data: { runs: [
        { id: 'a'.repeat(32), skill_id: 'image.describe', skill_version: '1.0.0', state: 'succeeded' },
        { id: 'b'.repeat(32), skill_id: 'chat.general', skill_version: '1.0.0', state: 'failed' },
        { id: 'c'.repeat(32), skill_id: 'image.generate', skill_version: '1.0.0', state: 'running' },
      ] } },
    };
    return route.fulfill({ json: fixtures[url.pathname] || { data: {} } });
  }
  const assetPath = path.join(webDir, 'dist', url.pathname.replace(/^\//, ''));
  if ((url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) && fs.existsSync(assetPath)) {
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: fs.readFileSync(assetPath) });
  }
  const index = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
  return route.fulfill({ status: 200, contentType: 'text/html', body: index.replace('<base href="/">', '<base href="http://localhost:4200/">') });
});

try {
  await page.goto('http://localhost:4200/runs');
  const rows = page.locator('.run-row');
  await expect(rows).toHaveCount(3);
  await page.getByLabel('Filter runs by state').selectOption('failed');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('chat.general');
  await page.getByLabel('Search runs by skill or ID').fill('image');
  await expect(page.getByText('No runs match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(3);
  assert.deepEqual(pageErrors, [], 'Runs should render and filter without browser errors');
  console.log('Runs list search and state-filter browser smoke passed.');
} finally {
  await context.close();
  await browser.close();
}
