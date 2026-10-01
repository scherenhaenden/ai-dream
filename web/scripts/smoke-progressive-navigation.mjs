import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(webDir, 'dist');
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
    const body = url.pathname === '/api/health'
      ? { data: { status: 'ok', service: 'ai-dream' } }
      : { data: {} };
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
  const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(mainNav.getByRole('link')).toHaveCount(6);
  for (const label of ['Chat', 'Models', 'Create / Skills', 'Knowledge (RAG)', 'Downloads', 'Settings']) {
    await expect(mainNav.getByRole('link', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  }

  await page.getByRole('button', { name: /Search pages/ }).click();
  const search = page.getByRole('combobox', { name: 'Search all pages' });
  const results = page.getByRole('listbox', { name: 'Available pages' });
  const destinations = [
    ['Chat', '/chat'], ['Agent', '/agent'], ['Models', '/models'], ['Capability Map', '/capability-map'],
    ['Setup Assistant', '/setup-assistant'], ['Skills', '/skills'], ['Runs', '/runs'], ['Canvas', '/canvas'],
    ['Model Hubs', '/hub'], ['Knowledge (RAG)', '/knowledge'], ['Resources', '/resources'], ['Hardware', '/hardware'],
    ['Load Model (Placement)', '/load-model'], ['Runtime Manager', '/runtime'], ['Downloads', '/downloads'],
    ['Local API', '/local-api'], ['Tools & Permissions', '/tools-permissions'], ['Logs & Traces', '/logs'],
    ['Settings', '/settings'],
  ];
  for (const [label] of destinations) {
    await search.fill(label);
    const result = results.getByRole('option', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    await expect(result).toHaveCount(1);
    await expect(result).toHaveAttribute('aria-selected', 'true');
  }

  await search.fill('Model');
  const options = results.getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowDown');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/hub$/);

  await page.goto('http://localhost:4200/capability-map');
  await expect(page.getByRole('heading', { name: 'Capability Map' })).toBeVisible();
  for (const [label, destination] of destinations) {
    await page.getByRole('button', { name: /Search pages/ }).click();
    await page.getByRole('combobox', { name: 'Search all pages' }).fill(label);
    await results.getByRole('option', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.width <= dimensions.viewport, `Navigation shell overflows mobile viewport: ${dimensions.width}px > ${dimensions.viewport}px`);
  assert.deepEqual(pageErrors, [], 'Navigation smoke should not produce browser runtime errors');
  console.log('Progressive navigation preserves all 19 destinations, supports keyboard selection, deep links and 390 px layout.');
} finally {
  await context.close();
  await browser.close();
}
