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
const failedRunId = 'e'.repeat(32);
const cancelledRunId = 'f'.repeat(32);
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
    if (url.pathname === `/api/runs/${failedRunId}` || url.pathname === `/api/runs/${cancelledRunId}`) {
      const failed = url.pathname.includes(failedRunId);
      return route.fulfill({ json: { data: { run: {
        id: failed ? failedRunId : cancelledRunId,
        skill_id: 'document.answer-with-rag', skill_version: '1.0.0',
        state: failed ? 'failed' : 'cancelled', current_nodes: [], outputs: [],
        created_at: 1790800000, started_at: 1790800001, completed_at: 1790800002,
        error: failed ? { kind: 'route_failure', message: 'Fixture route failed.' } : null,
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
    if (url.pathname.endsWith('/events')) {
      const streamRunId = url.pathname.split('/')[3];
      const events = streamRunId === failedRunId ? [
        { sequence: 1, type: 'run.started', data: {} },
        { sequence: 2, type: 'node.started', data: { node_id: 'retrieve-document' } },
        { sequence: 3, type: 'node.failed', data: { node_id: 'retrieve-document', error: 'Fixture retrieval failed.' } },
        { sequence: 4, type: 'run.failed', data: { kind: 'route_failure' } },
      ] : streamRunId === cancelledRunId ? [
        { sequence: 1, type: 'run.started', data: {} },
        { sequence: 2, type: 'node.started', data: { node_id: 'synthesize-response' } },
        { sequence: 3, type: 'node.cancelled', data: { node_id: 'synthesize-response' } },
        { sequence: 4, type: 'run.cancelled', data: {} },
      ] : [
        { sequence: 1, type: 'run.started', data: {} },
        { sequence: 2, type: 'node.started', data: { node_id: 'extract-document' } },
        { sequence: 3, type: 'node.completed', data: { node_id: 'extract-document' } },
        { sequence: 4, type: 'run.succeeded', data: {} },
      ];
      const body = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify({
        ...event, run_id: streamRunId, timestamp: 1790800001,
      })}\n\n`).join('');
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body });
    }
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:4200/runs');
  const rows = page.locator('.run-row');
  await expect(rows).toHaveCount(3);
  await expect(page.getByLabel('Search runs by skill or ID')).toBeVisible();
  await expect(page.getByLabel('Filter runs by state')).toBeVisible();
  let mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(mobileOverflow, false, 'run filters and retained list should fit a 390 px viewport');

  // The list API exposes skill_id, state, and id, so search and state controls
  // can operate on the retained records without issuing broader API queries.
  await page.getByLabel('Search runs by skill or ID').fill('IMAGE.DESCRIBE');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('image.describe');
  await page.getByLabel('Search runs by skill or ID').fill('bbbbbbbb');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('chat.general');

  await page.getByLabel('Filter runs by state').selectOption('failed');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('chat.general');
  await page.getByLabel('Search runs by skill or ID').fill('image');
  await expect(page.getByText('No runs match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(3);
  await page.getByLabel('Filter runs by state').selectOption('running');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('image.generate');
  mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(mobileOverflow, false, 'filtered run rows should fit a 390 px viewport');

  await page.goto(`http://localhost:4200/runs/${runId}`);
  await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
  await expect(page.locator('.timeline')).toContainText('Run Started');
  await expect(page.locator('.timeline')).toContainText('Node Started');
  await expect(page.locator('.timeline')).toContainText('Node Completed');
  await expect(page.locator('.timeline')).toContainText('Run Succeeded');
  await expect(page.locator('.run-facts')).toContainText('4');
  await expect(page.getByRole('status', { name: 'Run recovered after restart' })).toContainText('This run was not resumed');
  await expect(page.getByRole('status', { name: 'Run is not durable' })).toContainText('The local run journal could not be written.');
  const chatLink = page.getByRole('link', { name: 'Open associated conversation' });
  await expect(chatLink).toHaveAttribute('href', /\/chat\?chat_id=chat-associated$/);
  await chatLink.click();
  await expect(page.locator('.active-thread-bar')).toContainText('Associated chat');
  await page.goto(`http://localhost:4200/runs/${runId}`);
  const nodeEvent = page.locator('.timeline li').filter({ hasText: 'Node Started' });
  await nodeEvent.getByText('Node event data').click();
  await expect(nodeEvent).toContainText('extract-document');

  await page.goto(`http://localhost:4200/runs/${failedRunId}`);
  await expect(page.locator('.timeline')).toContainText('Node Failed');
  await expect(page.locator('.timeline')).toContainText('Run Failed');
  const failedNodeEvent = page.locator('.timeline li').filter({ hasText: 'Node Failed' });
  await failedNodeEvent.getByText('Node event data').click();
  await expect(failedNodeEvent).toContainText('retrieve-document');
  await expect(page.locator('.run-error')).toContainText('Fixture route failed.');

  await page.goto(`http://localhost:4200/runs/${cancelledRunId}`);
  await expect(page.locator('.timeline')).toContainText('Node Cancelled');
  await expect(page.locator('.timeline')).toContainText('Run Cancelled');
  const cancelledNodeEvent = page.locator('.timeline li').filter({ hasText: 'Node Cancelled' });
  await cancelledNodeEvent.getByText('Node event data').click();
  await expect(cancelledNodeEvent).toContainText('synthesize-response');
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
  mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(mobileOverflow, false, 'run output preview should fit a narrow viewport');
  assert.deepEqual(pageErrors, [], 'Runs should render and filter without browser errors');
  console.log('Runs success/failure/cancellation traces, recovery and durability notices, chat association, skill/ID search, state filtering, typed outputs, owner-scoped preview retry/download and 390 px layout browser smoke passed.');
} finally {
  await context.close();
  await browser.close();
}
