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
        { id: 'image.generate', status: 'unavailable', routes: 0, preferred_route_id: null, inputs: ['text'], outputs: ['image'], skills: [] },
      ] } },
      '/api/capabilities': { data: { capabilities: [{
        id: 'text.chat', status: 'ready', inputs: [{ kind: 'text' }], outputs: [{ kind: 'text' }],
        evidence: [{ source: 'fixture-catalog', status: 'verified', confidence: 'high', verified_at: '2026-09-01', details: 'Fixture verification record.' }], preferred_route_id: 'route-chat',
        routes: [
          { id: 'route-chat', model_id: 'chat-model', runtime_id: 'llama.cpp', estimated_vram_bytes: 2147483648, available_vram_bytes: 4294967296 },
          { id: 'route-chat-unknown-memory', model_id: 'chat-fallback', runtime_id: 'vllm' },
        ],
      }, {
        id: 'image.generate', status: 'unavailable', inputs: [{ kind: 'text' }], outputs: [{ kind: 'image' }],
        evidence: [], routes: [],
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
  const capabilityDetails = capability.locator('details.capability-details');
  const capabilitySummary = capabilityDetails.locator(':scope > summary');
  await capabilitySummary.focus();
  await page.keyboard.press('Enter');
  await expect(capabilityDetails).toHaveAttribute('open', '');
  await expect(capability.getByRole('region', { name: 'Skills using this capability' })).toBeVisible();
  await expect(capability.getByText('General chat', { exact: true })).toBeVisible();
  await expect(capability.getByText('Summarize document', { exact: true })).toBeVisible();
  await expect(capability.getByText('Documents · Not ready', { exact: true })).toBeVisible();
  await expect(capability.getByText(/Route route-chat · llama\.cpp · VRAM estimate 2\.00 GiB · available VRAM reported 4\.00 GiB/)).toBeVisible();
  await expect(capability.getByText(/Route route-chat-unknown-memory · vllm · VRAM estimate Not reported · available VRAM reported Not reported/)).toBeVisible();
  const evidenceDetails = capability.locator('details.evidence-details');
  await evidenceDetails.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(evidenceDetails).toHaveAttribute('open', '');
  await expect(evidenceDetails.getByText('Fixture verification record.', { exact: true })).toBeVisible();
  const filters = page.locator('.filter-row');
  await expect(filters).toHaveAttribute('role', 'group');
  await expect(filters).toHaveAttribute('aria-label', 'Filter capabilities by status');
  const unavailableFilter = filters.getByRole('button', { name: /^Unavailable\b/ });
  await unavailableFilter.focus();
  await page.keyboard.press('Enter');
  await expect(unavailableFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1 of 2 shown')).toBeVisible();
  const unavailable = page.locator('.capability-card').filter({ hasText: 'image.generate' });
  await expect(unavailable).toBeVisible();
  const unavailableDetails = unavailable.locator('details.capability-details');
  await unavailableDetails.locator(':scope > summary').click();
  await expect(unavailable.getByText('No compatible runtime route is currently reported for this capability.')).toBeVisible();
  await expect(unavailable.getByText('No installed skill declares this capability as a requirement.')).toBeVisible();
  await expect(unavailable.getByText('This capability API does not report dependency records; missing dependencies cannot be confirmed here.')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole('heading', { name: 'Capability Map' })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  assert.ok(widths.document <= widths.viewport, `mobile layout overflows horizontally: ${JSON.stringify(widths)}`);
  assert.deepEqual(errors, [], 'capability map should render without browser errors');
  console.log('Capability Map disclosure keyboard interaction, evidence records, skill relationships, reported and unavailable dependencies, route VRAM, status filtering, and mobile layout smoke passed.');
} finally {
  await context.close();
  await browser.close();
}
