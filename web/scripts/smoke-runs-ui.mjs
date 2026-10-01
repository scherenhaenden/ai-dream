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
const runId = 'd'.repeat(32);
const artifactId = 'art_preview';
const artifact = {
  schema_version: 1, id: artifactId, kind: 'document', media_type: 'text/html', name: 'report-preview.html',
  storage: { type: 'run-local', key: 'report-preview.html' }, size_bytes: 59, lifetime: 'ephemeral',
  owner: { type: 'run', id: runId }, metadata: {},
};
let previewAttempts = 0;
const requestedOwner = [];
page.on('pageerror', error => pageErrors.push(error.message));

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === `/api/runs/${runId}`) {
      return route.fulfill({ json: { data: { run: {
        id: runId, skill_id: 'document.create-report', skill_version: '1.0.0', state: 'succeeded',
        chat_id: 'chat-associated', recovered: true, durable: false,
        durability_error: 'The local run journal could not be written.',
        created_at: 1790800000, started_at: 1790800001, completed_at: 1790800002,
        current_nodes: [], outputs: [
          { kind: 'text', text: 'A report is ready.' },
          { kind: 'json', value: { status: 'complete', rows: 3 } },
          artifact,
        ],
      } } } });
    }
    if (url.pathname === `/api/artifacts/${artifactId}/content`) {
      previewAttempts += 1;
      requestedOwner.push({ type: url.searchParams.get('owner_type'), id: url.searchParams.get('owner_id') });
      if (previewAttempts === 1) return route.fulfill({ status: 403, json: { error: { message: 'Artifact is not available to this run.' } } });
      const html = '<!doctype html><title>Report</title><h1>Report preview</h1>';
      assert.equal(Buffer.byteLength(html), artifact.size_bytes);
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    if (url.pathname === '/api/chats') return route.fulfill({ json: { data: { chats: [{ id: 'chat-associated', title: 'Associated chat' }] } } });
    if (url.pathname === '/api/chats/chat-associated') return route.fulfill({ json: { data: { chat: { id: 'chat-associated', messages: [] } } } });
    if (url.pathname === '/api/chats/chat-associated/settings') return route.fulfill({ json: { data: { settings: {} } } });
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://localhost:4200/runs/${runId}`);
  await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Run recovered after restart' })).toContainText('This run was not resumed');
  await expect(page.getByRole('status', { name: 'Run is not durable' })).toContainText('The local run journal could not be written.');
  const chatLink = page.getByRole('link', { name: 'Open associated conversation' });
  await expect(chatLink).toHaveAttribute('href', /\/chat\?chat_id=chat-associated$/);
  await chatLink.click();
  await expect(page.locator('.active-thread-bar')).toContainText('Associated chat');
  await page.goto(`http://localhost:4200/runs/${runId}`);
  await expect(page.getByText('A report is ready.')).toBeVisible();
  await expect(page.getByText('"status": "complete"')).toBeVisible();
  const previewButton = page.getByRole('button', { name: 'Preview here' });
  await previewButton.click();
  await expect(page.locator('.preview-error')).toContainText('Artifact upload failed (HTTP 403).');
  await expect(page.getByText(/Content is fetched using this artifact’s declared owner/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.getByTitle('Preview of report-preview.html')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download report-preview.html' })).toHaveAttribute('download', 'report-preview.html');
  assert.deepEqual(requestedOwner, [
    { type: 'run', id: runId }, { type: 'run', id: runId },
  ], 'artifact requests must carry the declared run owner on initial fetch and retry');
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(mobileOverflow, false, 'run output preview should fit a narrow viewport');
  assert.deepEqual(pageErrors, [], 'Runs should render and filter without browser errors');
  console.log('Runs list filters, typed outputs, owner-scoped preview failure/retry, download action and mobile layout browser smoke passed.');
} finally {
  await context.close();
  await browser.close();
}
