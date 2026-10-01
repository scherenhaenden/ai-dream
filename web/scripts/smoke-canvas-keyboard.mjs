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
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9BUAAAAASUVORK5CYII=', 'base64');
const artifact = {
  schema_version: 1, id: 'art_canvas_preview', kind: 'image', media_type: 'image/png', name: 'sample.png',
  storage: { type: 'session', key: 'sample.png' }, size_bytes: png.length, lifetime: 'session',
  owner: { type: 'user', id: 'fixture-user' }, metadata: {},
};
const tabs = [
  { id: 'text:notes', title: 'Notes', kind: 'markdown', source: 'chat', sourceId: 'chat-fixture', updatedAt: 1, content: '# Notes\nA retained Markdown result.' },
  { id: 'artifact:user:fixture-user:art_canvas_preview', title: artifact.name, kind: 'image', source: 'chat', sourceId: 'chat-fixture', updatedAt: 2, artifact },
  { id: 'text:data', title: 'Data', kind: 'json', source: 'run', sourceId: 'run-fixture', updatedAt: 3, content: '[{"name":"fixture","count":1}]' },
];
await page.addInitScript(({ storageKey, value }) => sessionStorage.setItem(storageKey, JSON.stringify(value)), {
  storageKey: 'aidream.canvasTabs.v1', value: { tabs, activeTabId: 'text:notes', closedIds: [] },
});
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === `/api/artifacts/${artifact.id}/content`) {
      assert.equal(url.searchParams.get('owner_type'), 'user');
      assert.equal(url.searchParams.get('owner_id'), 'fixture-user');
      return route.fulfill({ status: 200, contentType: artifact.media_type, body: png });
    }
    if (url.pathname === '/api/health') return route.fulfill({ json: { data: { status: 'ok' } } });
    return route.fulfill({ json: { data: {} } });
  }
  const assetPath = path.join(webDir, 'dist', url.pathname.replace(/^\//, ''));
  if ((url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) && fs.existsSync(assetPath)) {
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: fs.readFileSync(assetPath) });
  }
  const index = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
  return route.fulfill({ status: 200, contentType: 'text/html', body: index.replace('<base href="/">', '<base href="http://localhost:4200/">') });
});

try {
  await page.goto('http://localhost:4200/canvas');
  const tabsList = page.getByRole('tablist', { name: 'Open Canvas outputs' });
  const tabButtons = page.getByRole('tab');
  await expect(tabsList).toBeVisible();
  await expect(tabButtons).toHaveCount(3);
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(0)).toHaveAttribute('tabindex', '0');
  await expect(tabButtons.nth(1)).toHaveAttribute('tabindex', '-1');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await tabButtons.nth(0).getAttribute('id'));

  await tabButtons.nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabButtons.nth(1)).toBeFocused();
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('img', { name: 'sample.png' })).toBeVisible();
  const openImage = page.getByRole('link', { name: 'Open image' });
  const saveImage = page.getByRole('link', { name: 'Save image' });
  await expect(openImage).toHaveAttribute('href', /^blob:/);
  await expect(saveImage).toHaveAttribute('download', 'sample.png');
  await openImage.focus();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await popup.close();
  await saveImage.focus();
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'sample.png');

  await tabButtons.nth(1).focus();
  await page.keyboard.press('End');
  await expect(tabButtons.nth(2)).toBeFocused();
  await expect(tabButtons.nth(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tabButtons.nth(0)).toBeFocused();
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Close sample.png' }).focus();
  await page.keyboard.press('Enter');
  await expect(tabButtons.nth(1)).toBeFocused();
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(1)).toContainText('Data');
  await page.getByRole('button', { name: 'Close Data' }).focus();
  await page.keyboard.press('Enter');
  await expect(tabButtons.nth(0)).toBeFocused();
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Close Notes' }).focus();
  await page.keyboard.press('Enter');
  const emptyHeading = page.getByRole('heading', { name: 'No outputs open' });
  await expect(emptyHeading).toBeFocused();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(mobileOverflow, false, 'Canvas tabs, preview actions, and empty state should fit 390 px');
  assert.deepEqual(pageErrors, [], 'Canvas keyboard workflow should not raise browser errors');
  console.log('Canvas tab keyboard navigation, close-focus recovery, artifact preview actions, and 390 px layout passed.');
} finally {
  await context.close();
  await browser.close();
}
