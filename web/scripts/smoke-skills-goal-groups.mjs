import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All AI Dream API traffic is fixture-backed. This smoke covers the Skills UI
// without contacting a running service or starting a runtime/model/GPU workload.
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const skills = [
  { id: 'chat.general', name: 'General chat', version: '1.0.0', description: 'Chat with a local model.', category: 'Chat', inputs: [{ name: 'prompt', artifact: 'text', required: true }], outputs: [{ name: 'response', artifact: 'text' }], status: 'ready', preferred_route_id: 'route-chat-fixture' },
  { id: 'image.generate', name: 'Generate image', version: '1.0.0', description: 'Create an image from a prompt.', category: 'Images', inputs: [{ name: 'prompt', artifact: 'text', required: true }], outputs: [{ name: 'image', artifact: 'image' }], status: 'not_ready', not_ready_reasons: ['No compatible local image runtime is configured.'], alternatives: ['Use chat.general to refine the image prompt.'], preferred_route_id: null },
  { id: 'document.summarize', name: 'Summarize document', version: '1.0.0', description: 'Summarize a selected document.', category: 'Documents', inputs: [{ name: 'document', artifact: 'document', required: true }], outputs: [{ name: 'summary', artifact: 'text' }], status: 'ready', preferred_route_id: 'route-document-fixture' },
  { id: 'document.create-pdf', name: 'Create PDF', version: '1.0.0', description: 'Create a PDF from text.', category: 'Documents', inputs: [{ name: 'text', artifact: 'text', required: true }], outputs: [{ name: 'document', artifact: 'document' }], status: 'unknown', preferred_route_id: null },
  { id: 'voice.transcribe', name: 'Transcribe audio', version: '1.0.0', description: 'Transcribe selected audio.', category: 'Audio', inputs: [{ name: 'audio', artifact: 'audio', required: true }], outputs: [{ name: 'transcript', artifact: 'text' }], status: 'unknown', alternatives: ['Use chat.general with an existing transcript.'] },
  { id: 'voice.respond', name: 'Respond to transcript', version: '1.0.0', description: 'Reply to a reviewed transcript and synthesize speech.', category: 'Audio', inputs: [{ name: 'transcript', artifact: 'text', required: true }, { name: 'voice', artifact: 'text', required: true }], outputs: [{ name: 'reply_audio', artifact: 'audio' }], status: 'ready' },
  { id: 'knowledge.search', name: 'Search knowledge', version: '1.0.0', description: 'Search local indexed documents.', category: 'Knowledge', inputs: [{ name: 'query', artifact: 'text', required: true }], outputs: [{ name: 'results', artifact: 'json' }], status: 'ready' },
  { id: 'custom.review', name: 'Review local data', version: '1.0.0', description: 'Review a selected local input.', category: 'Automation / Agents', inputs: [{ name: 'text', artifact: 'text', required: true }], outputs: [{ name: 'review', artifact: 'text' }], status: 'ready' },
];
let savedImagePin = 'image-model-no-longer-available';

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
  const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 5000));
  if (await Promise.race([stopped, timeout]) === 'timeout' && child.exitCode === null) { child.kill('SIGKILL'); await stopped; }
}

const { vite, url } = await startVite();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const skillCard = id => page.locator('.skill-card').filter({ has: page.locator('.card-head code').filter({ hasText: id }) });
await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  const body = pathname === '/api/health'
    ? { data: { status: 'ok', service: 'skills-goal-fixture' } }
      : pathname === '/api/skills'
        ? { data: { skills } }
        : pathname === '/api/skills/voice.respond'
          ? { data: { skill: { permissions: { filesystem_read: 'none', filesystem_write: 'none', network: 'none', shell: 'none', browser_control: 'none', computer_control: 'none', desktop_control: 'none', microphone: 'none', camera: 'none', clipboard: 'none' } } } }
      : pathname === '/api/artifacts'
        ? { data: { artifacts: [] } }
          : pathname === '/api/capability-preferences'
          ? { data: { capability_preferences: { 'image.generate': savedImagePin ? { model_id: savedImagePin } : null }, selection_defaults: { assisted_planner_enabled: false, mode: 'auto' } } }
          : pathname === '/api/runtime/status'
            ? { data: { status: { loaded: false, model: null } } }
            : pathname === '/api/capabilities'
              ? { data: { capabilities: [
                { id: 'image.generate', routes: [] }, { id: 'image.edit', routes: [] },
                { id: 'audio.synthesize', routes: [{ id: 'flite-fixture', model_id: 'ffmpeg-flite:kal', runtime_id: 'local-voice', voices: ['kal', 'slt'] }] },
              ] } }
              : pathname === '/api/resources'
                ? { data: { resources: { ram: {}, gpus: [], loaded_models: [] } } }
                : pathname === '/api/models/residency'
                  ? { data: { residency: { items: [] } } }
              : { data: {} };
  if (pathname === '/api/capability-preferences' && route.request().method() === 'PATCH') {
    const requested = route.request().postDataJSON()?.capability_preferences?.['image.generate'];
    savedImagePin = typeof requested?.model_id === 'string' ? requested.model_id : '';
    return route.fulfill({ json: { data: { capability_preferences: { 'image.generate': savedImagePin ? { model_id: savedImagePin } : null } } } });
  }
  return route.fulfill({ json: body });
});

try {
  await page.goto(`${url}/skills`);
  await expect(page.getByRole('heading', { name: 'Skills', level: 1 })).toBeVisible();
  const groups = page.locator('.skill-group');
  await expect(groups).toHaveCount(6);
  for (const goal of ['Chat & Reasoning', 'Create & Edit Images', 'Work with Documents', 'Audio & Voice', 'Find Information', 'Other Goals']) {
    await expect(groups.filter({ has: page.getByRole('heading', { name: goal }) })).toHaveCount(1);
  }

  const chatCard = skillCard('chat.general');
  await expect(chatCard).toContainText('Category · Chat');
  await expect(chatCard.locator('.card-foot')).toContainText('route-chat-fixture');
  const imageCard = skillCard('image.generate');
  await expect(imageCard).toContainText('Category · Images');
  await expect(imageCard.locator('.readiness')).toHaveText('Not ready');
  await expect(imageCard).toContainText('No compatible local image runtime is configured.');
  await expect(imageCard).toContainText('Use chat.general to refine the image prompt.');
  await expect(imageCard.locator('.card-foot')).toContainText('Automatic');
  await expect(imageCard.getByRole('button', { name: 'Open chat' })).toBeVisible();
  await imageCard.getByRole('button', { name: 'Plan or run' }).click();
  const imagePicker = imageCard.getByRole('combobox', { name: 'Image generator for this plan' });
  await expect(imagePicker).toBeEnabled();
  await expect(imagePicker).toHaveValue('__saved_image_pin_unavailable__');
  await expect(imagePicker.locator('option:checked')).toContainText('Saved pin unavailable');
  await expect(imageCard).toContainText('Choose automatic to clear it');
  await imagePicker.selectOption('');
  await expect.poll(() => savedImagePin).toBe('');
  await expect(imagePicker).toHaveValue('');
  await expect(imageCard).not.toContainText('Saved pin unavailable');
  const documentCard = skillCard('document.summarize');
  await expect(documentCard.locator('.card-foot')).toContainText('route-document-fixture');
  const pdfCard = skillCard('document.create-pdf');
  await expect(pdfCard.locator('.readiness')).toHaveText('Unknown');
  await expect(pdfCard.locator('.card-foot')).toContainText('Automatic');
  const audioCard = skillCard('voice.transcribe');
  await expect(audioCard.locator('.readiness')).toHaveText('Unknown');
  await expect(audioCard.getByRole('button', { name: 'Open chat' })).toBeVisible();
  const respondCard = skillCard('voice.respond');
  await respondCard.getByRole('button', { name: 'Plan or run' }).click();
  await expect(respondCard.getByRole('combobox', { name: 'Flite voice' })).toBeVisible();
  await expect(respondCard.getByRole('option', { name: 'slt' })).toBeAttached();
  await respondCard.getByRole('combobox', { name: 'Flite voice' }).selectOption('slt');
  await respondCard.getByRole('textbox', { name: 'transcript input' }).fill('Fixture reviewed transcript');
  let plannedInputs;
  await page.route('**/api/skills/voice.respond/plan', async route => {
    plannedInputs = route.request().postDataJSON().inputs;
    await route.fulfill({ json: { data: { plan: { plan_id: '0123456789abcdef01234567', status: 'ready', steps: [] } } } });
  });
  await respondCard.getByRole('button', { name: 'Preview plan' }).click();
  await expect.poll(() => plannedInputs?.voice?.text).toBe('slt');
  await expect(respondCard.getByLabel('Plan preview')).toContainText('ready');
  const customCard = skillCard('custom.review');
  await expect(customCard).toContainText('Category · Automation / Agents');

  await imageCard.getByRole('button', { name: 'Open chat' }).click();
  await expect(page).toHaveURL(/\/chat$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}/skills`);
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.page <= dimensions.viewport, `Skills catalog overflows 390 px viewport: ${dimensions.page}px > ${dimensions.viewport}px`);
  const mobileRespond = skillCard('voice.respond');
  await mobileRespond.getByRole('button', { name: 'Plan or run' }).click();
  await expect(mobileRespond.getByRole('combobox', { name: 'Flite voice' })).toBeVisible();
  const pickerDimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(pickerDimensions.page <= pickerDimensions.viewport, `Skills voice picker overflows 390 px viewport: ${pickerDimensions.page}px > ${pickerDimensions.viewport}px`);
  await expect(page.locator('.skill-card')).toHaveCount(skills.length);
  assert.deepEqual(pageErrors, [], 'Fixture-backed Skills UI should render and navigate without browser errors');
  console.log('Skills fixture smoke passed: goal grouping/readiness, API-grounded Flite choice, stale image pin recovery with zero compatible routes, selected voice in reviewed plan inputs, navigation, and 390 px catalog/picker layout.');
} finally {
  await context.close();
  await browser.close();
  await stopProcess(vite);
}
