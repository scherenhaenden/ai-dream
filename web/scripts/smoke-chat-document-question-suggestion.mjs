import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local browser/UI only. Every API call is fulfilled from fixtures; inference and skill run endpoints are rejected.
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const chat = { id: 'chat-fixture', title: 'Fixture chat', messages: [] };
const uploadedArtifacts = [];
const skills = [
  { id: 'document.summarize', name: 'Summarize document', version: '1.0.0', description: 'Summarize a selected document.', category: 'Documents', status: 'ready', inputs: [{ name: 'document', artifact: 'document', required: true }], outputs: [{ name: 'summary', artifact: 'text', required: true }], permissions: { filesystem_read: 'user-selected-only', filesystem_write: 'none', network: 'none' } },
  { id: 'document.answer-with-rag', name: 'Answer from document', version: '1.0.0', description: 'Answer a question using one selected document and citations.', category: 'Documents', status: 'ready', inputs: [{ name: 'document', artifact: 'document', required: true }, { name: 'question', artifact: 'text', required: true }], outputs: [{ name: 'answer', artifact: 'text', required: true }, { name: 'citations', artifact: 'json', required: true }], permissions: { filesystem_read: 'user-selected-only', filesystem_write: 'none', network: 'none' } },
  { id: 'document.extract-text', name: 'Extract document text', version: '1.0.0', description: 'Extract bounded text from a selected document.', category: 'Documents', status: 'ready', inputs: [{ name: 'document', artifact: 'document', required: true }], outputs: [{ name: 'text', artifact: 'text', required: true }], permissions: { filesystem_read: 'user-selected-only', filesystem_write: 'none', network: 'none' } },
  { id: 'image.describe', name: 'Describe image', version: '1.0.0', description: 'Describe a selected image.', category: 'Images', status: 'ready', inputs: [{ name: 'image', artifact: 'image', required: true }], outputs: [{ name: 'description', artifact: 'text', required: true }], permissions: { filesystem_read: 'user-selected-only', filesystem_write: 'none', network: 'none' } },
  { id: 'image.edit-from-instruction', name: 'Edit image from instruction', version: '1.0.0', description: 'Edit an image using a text instruction.', category: 'Images', status: 'not_ready', inputs: [{ name: 'image', artifact: 'image', required: true }, { name: 'instruction', artifact: 'text', required: true }], outputs: [{ name: 'image', artifact: 'image', required: true }], not_ready_reasons: ['No compatible image editor route.'], permissions: { filesystem_read: 'user-selected-only', filesystem_write: 'none', network: 'none' } },
];
const fixtureCalls = [];
let artifactSequence = 0;

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startVite() {
  const port = await reservePort();
  const vite = spawn(process.execPath, [path.join(WEB_DIR, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: WEB_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  vite.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  vite.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited with ${vite.exitCode}:\n${output}`);
    try { if ((await fetch(url)).ok) return { vite, url }; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  vite.kill('SIGTERM');
  throw new Error(`Vite did not become ready within 30 seconds:\n${output}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = new Promise(resolve => child.once('exit', resolve));
  if (await Promise.race([stopped, new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))]) === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await stopped;
  }
}

const { vite, url } = await startVite();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const method = request.method();
  fixtureCalls.push({ method, pathname });
  if (pathname === '/api/skills/document.answer-with-rag/plan' || pathname.endsWith('/run') || pathname === '/api/chat') {
    return route.fulfill({ status: 500, json: { error: 'Workloads are disabled in this smoke.' } });
  }
  if (pathname === '/api/artifacts' && method === 'POST') {
    const headers = await request.allHeaders();
    const artifact = {
      schema_version: 1, id: `art_fixture_${++artifactSequence}`, kind: headers['x-ai-dream-artifact-kind'],
      media_type: headers['content-type'], name: headers['x-ai-dream-artifact-name'],
      storage: { type: 'session', key: `fixture-${artifactSequence}` }, size_bytes: request.postDataBuffer()?.byteLength ?? 0,
      lifetime: 'session', owner: { type: 'session', id: headers['x-ai-dream-artifact-owner-id'] }, metadata: {},
    };
    uploadedArtifacts.push(artifact);
    return route.fulfill({ json: { data: { artifact } } });
  }
  let data = {};
  if (pathname === '/api/health') data = { status: 'ok', service: 'attachment-suggestion-fixture' };
  else if (pathname === '/api/models') data = { models: [{ id: 'fixture-local-model', path: '/fixture/model.gguf' }] };
  else if (pathname === '/api/model-profiles') data = { profiles: [] };
  else if (pathname === '/api/chats' && method === 'POST') data = { chat };
  else if (pathname === '/api/chats') data = { chats: [chat] };
  else if (pathname === '/api/chats/chat-fixture') data = { chat };
  else if (pathname === '/api/runtime/status') data = { status: { loaded: false, model: null } };
  else if (pathname === '/api/skills') data = { skills };
  else if (pathname === '/api/skills/document.answer-with-rag') data = { skill: skills.find(skill => skill.id === 'document.answer-with-rag') };
  else if (pathname === '/api/capability-preferences') data = { capability_preferences: {}, selection_defaults: { mode: 'auto', assisted_planner_enabled: false } };
  else if (pathname === '/api/capabilities') data = { capabilities: [{ id: 'image.generate', routes: [] }, { id: 'image.edit', routes: [] }] };
  else if (pathname === '/api/artifacts' && method === 'GET') data = { artifacts: uploadedArtifacts };
  return route.fulfill({ json: { data } });
});

try {
  await page.goto(`${url}/chat`);
  await expect(page.getByRole('heading', { name: 'Chat workspace' })).toBeVisible();
  await page.getByRole('button', { name: /New thread/ }).click();
  await expect(page.locator('#chat-prompt')).toBeEnabled();
  await page.getByRole('button', { name: 'Direct chat' }).click();
  const originalDraft = 'Keep this as a normal chat draft';
  await page.locator('#chat-prompt').fill(originalDraft);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#chat-attachments').setInputFiles([
    { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('fixture-png') },
    { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture-01') },
  ]);

  const imageCard = page.locator('.chat-attachment-card').filter({ hasText: 'reference.png' });
  await expect(imageCard.getByText('Describe image')).toBeVisible();
  await expect(imageCard.getByText('Edit image from instruction')).toBeVisible();
  const documentCard = page.locator('.chat-attachment-card').filter({ hasText: 'notes.pdf' });
  await expect(documentCard.getByText('Summarize document')).toBeVisible();
  await expect(documentCard.getByText('Extract document text')).toBeVisible();
  const askSuggestion = documentCard.locator('.skill-suggestion').filter({ hasText: 'Answer from document' });
  await expect(askSuggestion).toContainText('READY');
  await expect(page.locator('#chat-prompt')).toHaveValue(originalDraft);
  await expect(page.getByRole('button', { name: 'Direct chat' })).toHaveClass(/active/);
  const mobileWidths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(mobileWidths.document <= mobileWidths.viewport, `Chat attachment suggestions overflow 390 px: ${mobileWidths.document}px > ${mobileWidths.viewport}px`);
  await askSuggestion.getByRole('button', { name: 'Use this document in skill' }).click();
  await expect(page).toHaveURL(/\/skills$/);
  await expect(page.getByText('Selected notes.pdf for Answer from document · document. Review the route before planning or running.')).toBeVisible();
  const askCard = page.locator('.skill-card').filter({ hasText: 'document.answer-with-rag' });
  await expect(askCard.getByRole('region', { name: 'Accepted inputs' })).toContainText('document · document');
  await expect(askCard.getByRole('region', { name: 'Accepted inputs' })).toContainText('question · text');
  await expect(askCard.getByRole('textbox', { name: 'question input' })).toBeVisible();
  await expect(askCard.locator('.upload-success')).toContainText('notes.pdf');
  assert.equal(fixtureCalls.filter(call => call.method === 'POST' && (call.pathname.endsWith('/plan') || call.pathname.endsWith('/run') || call.pathname === '/api/chat')).length, 0, 'explicit routing must not plan, execute, or send chat automatically');
  assert.equal(fixtureCalls.filter(call => call.method === 'POST' && call.pathname === '/api/artifacts').length, 2, 'only the explicitly staged image and PDF should be uploaded');
  assert.deepEqual(pageErrors, [], 'fixture-backed document suggestion flow should render without browser errors');
  console.log('Fixture-backed image and PDF suggestions preserve the direct-chat draft, carry the selected PDF into the Answer from document composer with an editable question field, and do not plan or run at 390 px.');
} finally {
  await context.close();
  await browser.close();
  await stopProcess(vite);
}
