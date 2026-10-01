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
const errors = [];
page.on('pageerror', error => errors.push(error.message));

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    const fixtures = {
      '/api/health': { data: { status: 'ok', service: 'ai-dream' } },
      '/api/capability-map': { data: { capabilities: [
        { id: 'text.chat', status: 'ready', routes: 1, preferred_route_id: 'route-chat', inputs: ['text'], outputs: ['text'], skills: [
          { id: 'chat.general', name: 'General chat', version: '1.0.0', category: 'Chat', status: 'ready' },
          { id: 'document.summarize', name: 'Summarize document', version: '1.0.0', category: 'Documents', status: 'not_ready' },
        ] },
      ] } },
      '/api/capabilities': { data: { capabilities: [{
        id: 'text.chat', status: 'ready', inputs: [{ kind: 'text' }], outputs: [{ kind: 'text' }],
        evidence: [], preferred_route_id: 'route-chat',
        routes: [{ id: 'route-chat', model_id: 'chat-model', runtime_id: 'llama.cpp' }],
      }] } },
    };
    return route.fulfill({ json: fixtures[url.pathname] || { data: {} } });
  }
  const assetPath = path.join(webDir, 'dist', url.pathname.replace(/^\//, ''));
  if ((url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) && fs.existsSync(assetPath)) {
    return route.fulfill({
      status: 200,
      contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css',
      body: fs.readFileSync(assetPath),
    });
  }
  const index = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
  return route.fulfill({ status: 200, contentType: 'text/html', body: index.replace('<base href="/">', '<base href="http://localhost:4200/">') });
});

try {
  await page.goto('http://localhost:4200/capability-map');
  const capability = page.locator('.capability-card').filter({ hasText: 'text.chat' });
  await expect(capability.getByRole('region', { name: 'Skills using this capability' })).toBeVisible();
  await expect(capability.getByText('General chat', { exact: true })).toBeVisible();
  await expect(capability.getByText('Summarize document', { exact: true })).toBeVisible();
  await expect(capability.getByText('Documents · Not ready', { exact: true })).toBeVisible();
  assert.deepEqual(errors, [], 'capability map should render without browser errors');
  console.log('Capability map skill relationship browser smoke passed.');
} finally {
  await context.close();
  await browser.close();
}
