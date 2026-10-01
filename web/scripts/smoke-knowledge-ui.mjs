import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = process.env.KNOWLEDGE_UI_DIST || path.join(webDir, 'dist');
const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
let documentAttempts = 0;
page.on('pageerror', error => pageErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('status of 503')) pageErrors.push(message.text());
});

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/health') return route.fulfill({ json: { data: { status: 'ok', service: 'ai-dream' } } });
    if (url.pathname === '/api/knowledge/documents') {
      documentAttempts++;
      if (documentAttempts === 1) return route.fulfill({ status: 503, json: { error: 'Index temporarily unavailable.' } });
      return route.fulfill({ json: { data: { documents: [], indexed_chars: 0, max_indexed_chars: 80000, max_documents: 100 } } });
    }
    if (url.pathname === '/api/knowledge/search') {
      if (url.searchParams.get('q') === 'nothing') return route.fulfill({ json: { data: { results: [] } } });
      return route.fulfill({ json: { data: { results: [{ id: 'doc-1', name: 'Guide.md', snippet: 'Local text matched exactly.', created_at: '2026-10-01T00:00:00Z' }] } } });
    }
    return route.fulfill({ json: { data: {} } });
  }
  const assetPath = path.join(distDir, url.pathname.replace(/^\//, ''));
  if (/\.(js|css)$/.test(url.pathname) && fs.existsSync(assetPath)) {
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: fs.readFileSync(assetPath) });
  }
  return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(distDir, 'index.html'), 'utf8') });
});

try {
  await page.goto('http://localhost:4200/knowledge');
  await expect(page.locator('.error')).toContainText('Index temporarily unavailable.');
  await expect(page.getByText('No documents indexed. Add a local text document to begin.')).toHaveCount(0);
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.getByText('No documents indexed. Add a local text document to begin.')).toBeVisible();

  await page.getByLabel('Search indexed text').fill('nothing');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/No full-text matches/)).toBeVisible();
  await page.getByLabel('Search indexed text').fill('local guide');
  const searchButton = page.getByRole('button', { name: 'Search', exact: true });
  await searchButton.click();
  await expect(searchButton).toBeEnabled();
  const match = page.locator('.result');
  await expect(match).toHaveCount(1);
  await expect(match).toContainText('Local text matched exactly.');

  await page.setViewportSize({ width: 360, height: 800 });
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.page <= dimensions.viewport, `Knowledge page overflows mobile viewport: ${dimensions.page}px > ${dimensions.viewport}px`);
  assert.deepEqual(pageErrors, [], 'Knowledge screen should complete load, retry and search without browser errors');
  console.log('Knowledge load error/retry, successful empty index, lexical empty/matched search and mobile layout passed.');
} finally {
  await context.close();
  await browser.close();
}
