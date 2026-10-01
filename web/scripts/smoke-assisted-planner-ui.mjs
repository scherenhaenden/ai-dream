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
const requests = [];
const runRequests = [];
let assistedPlannerEnabled = false;
const skill = {
  id: 'document.create-report-pdf', name: 'Create a PDF report', version: '1.0.0',
  description: 'Creates a paginated PDF report from structured text and tables.', category: 'Documents',
  inputs: [{ name: 'content', artifact: 'text', required: true }],
  outputs: [{ name: 'report', artifact: 'document' }], status: 'ready',
};
page.on('pageerror', error => pageErrors.push(error.message));
page.on('request', request => requests.push(new URL(request.url()).pathname));

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/capability-preferences' && route.request().method() === 'GET') {
      return route.fulfill({ json: { data: { selection_defaults: { mode: 'auto', assisted_planner_enabled: assistedPlannerEnabled }, capability_preferences: {} } } });
    }
    if (url.pathname === '/api/capability-preferences' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      assistedPlannerEnabled = body.selection_defaults.assisted_planner_enabled;
      return route.fulfill({ json: { data: { selection_defaults: { mode: 'auto', assisted_planner_enabled: assistedPlannerEnabled }, capability_preferences: {} } } });
    }
    if (url.pathname === '/api/runtime/status') return route.fulfill({ json: { data: { status: { loaded: true, model: 'fixture-model' } } } });
    if (url.pathname === '/api/capabilities') return route.fulfill({ json: { data: { capabilities: [] } } });
    if (url.pathname === '/api/skills') return route.fulfill({ json: { data: { skills: [skill] } } });
    if (url.pathname === '/api/skills/document.create-report-pdf' && route.request().method() === 'GET') {
      return route.fulfill({ json: { data: { skill: { ...skill, permissions: { filesystem_write: 'user-approved-output' } } } } });
    }
    if (url.pathname === '/api/skills/document.create-report-pdf/draft') {
      const body = route.request().postDataJSON();
      assert.equal(body.goal, 'Create a PDF report from this content');
      assert.deepEqual(body.inputs, { content: { kind: 'text', text: 'Quarterly results' } });
      return route.fulfill({ json: { data: {
        draft: { skill_id: skill.id, components: [{ node_id: 'render-report', component_id: 'document.create-report-pdf' }] },
        plan: { plan_id: 'a'.repeat(24), status: 'ready', nodes: [{ node_id: 'render-report', skill_id: skill.id }] },
        model: { id: 'fixture-model', runtime_id: 'fake-local' },
      } } });
    }
    if (url.pathname === '/api/skills/document.create-report-pdf/run') {
      const body = route.request().postDataJSON();
      assert.equal(body.expected_plan_id, 'a'.repeat(24), 'Run must be bound to the reviewed resolved plan');
      assert.deepEqual(body.inputs, { content: { kind: 'text', text: 'Quarterly results' } });
      runRequests.push(body);
      return route.fulfill({ json: { data: { run: { id: 'b'.repeat(32) } } } });
    }
    if (url.pathname.startsWith('/api/artifacts')) return route.fulfill({ json: { data: { artifacts: [] } } });
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
  await page.goto('http://localhost:4200/skills');
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
  const optIn = page.getByRole('checkbox', { name: 'Enable assisted planner globally' });
  await expect(optIn).not.toBeChecked();
  await optIn.check();
  await expect.poll(() => assistedPlannerEnabled).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Find a skill by goal or name' });
  await expect(search).toHaveAttribute('placeholder', 'e.g. create a PDF report');
  await expect(page.getByText(/Goal matches use only skill names and API-reported/)).toBeVisible();
  await search.fill('I want to create a PDF report');
  await expect(page.locator('.skill-card')).toHaveCount(1);
  await expect(page.locator('.skill-card')).toContainText(skill.id);
  await expect(optIn).toBeChecked();
  await expect(page.getByText('Loaded model: fixture-model')).toBeVisible();

  await page.getByRole('button', { name: 'Plan or run' }).click();
  await expect(page.locator('.assisted-draft')).toBeVisible();
  const goal = page.locator('.assisted-draft textarea');
  await goal.fill('Create a PDF report from this content');
  await page.getByRole('textbox', { name: 'content input' }).fill('Quarterly results');
  await expect(page.getByRole('button', { name: 'Generate assisted draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate assisted draft' }).click();
  await expect(page.getByRole('region', { name: 'Plan preview' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Generated assisted draft' })).toContainText('fixture-model');
  await expect(page.getByRole('region', { name: 'Deterministically resolved plan' })).toContainText('render-report');

  const run = page.getByRole('button', { name: 'Run skill' });
  await expect(run).toBeDisabled();
  const review = page.getByRole('checkbox', { name: 'I reviewed the validated draft and resolved plan' });
  await review.check();
  await expect(run).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'assisted review should fit a mobile viewport');
  const panelRects = await page.locator('.assisted-plan-review > section').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  assert.equal(panelRects.length, 2);
  assert.ok(panelRects[1] > panelRects[0], 'draft and resolved plan review panels should stack on mobile');
  await run.click();
  await expect.poll(() => runRequests.length).toBe(1);
  await expect(page).toHaveURL(/\/runs\/b{32}$/);
  assert.deepEqual(runRequests[0].inputs, { content: { kind: 'text', text: 'Quarterly results' } });

  assert.equal(requests.some(pathname => /\/api\/(runtime\/load|models\/.*\/load)$/.test(pathname)), false, 'planner UX must not start or load a model');
  assert.equal(requests.some(pathname => pathname.endsWith('/draft')), true, 'goal submission should request the assisted draft endpoint');
  assert.equal(requests.filter(pathname => pathname.endsWith('/run')).length, 1, 'only the explicitly approved run should reach the fixture API');
  assert.deepEqual(pageErrors, [], 'assisted planner fixture UI should render without browser errors');
  console.log('Assisted planner goal entry, fixture draft, dual-plan review, explicit Run approval, mobile review layout, and no-real-workload smoke passed.');
} finally {
  await context.close();
  await browser.close();
}
