import { expect, chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../../artifacts/ui-smoke/chat-agent');

(async () => {
  let browser;
  let hasErrors = false;
  const unmatchedApiRequests = [];
  let healthChecks = 0;
  let knowledgeEnabled = false;
  let chatPayload = null;
  let selectionMode = 'auto';
  let guidedPlanPayload = null;
  let guidedRunPayload = null;
  let guidedRunCount = 0;
  let forceManualMismatch = false;
  let chatMessages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' }
  ];

  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const executablePath = process.env.CHROME_BIN || [
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
    ].find(candidate => fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
    const page = await context.newPage();

    // Add console logging
    page.on('console', msg => {
      console.log('PAGE LOG:', msg.text());
      if (msg.type() === 'error') {
        hasErrors = true;
        console.error("Console error encountered:", msg.text());
      }
    });
    page.on('pageerror', err => {
      hasErrors = true;
      console.log('PAGE ERROR:', err.message);
    });

    // Intercept index.html request and serve it manually
    await page.route('**/*', async (route, request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        unmatchedApiRequests.push(url.pathname);
        await route.fulfill({
          status: 501,
          contentType: 'application/json',
          body: JSON.stringify({ error: `No smoke fixture for ${url.pathname}` })
        });
        return;
      }

      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        const filePath = path.join(__dirname, '../dist', url.pathname.replace(/^\/browser\//, '/'));
        let actualPath = filePath;
        if (!fs.existsSync(actualPath)) actualPath = path.join(__dirname, '../dist/browser', url.pathname.replace(/^\/browser\//, '/'));
        if (!fs.existsSync(actualPath)) actualPath = path.join(__dirname, '../dist/ai-dream-angular-console/browser', url.pathname.replace(/^\/browser\//, '/'));

        if (fs.existsSync(actualPath)) {
          const content = fs.readFileSync(actualPath);
          const contentType = url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css';
          await route.fulfill({ status: 200, contentType, body: content });
          return;
        } else {
            console.log("Could not find asset: ", actualPath);
        }
      }

      // Serve index.html for all other routes
      let indexPath = path.join(__dirname, '../dist/index.html');
      if (!fs.existsSync(indexPath)) indexPath = path.join(__dirname, '../dist/ai-dream-angular-console/browser/index.html');

      const indexContent = fs.readFileSync(indexPath, 'utf-8');

      // base href fix: replace <base href="/"> with <base href="http://localhost:4200/">
      const modifiedIndex = indexContent.replace('<base href="/">', '<base href="http://localhost:4200/">');
      await route.fulfill({ status: 200, contentType: 'text/html', body: modifiedIndex });
    });

    // ApiService.check() calls /api/health; keep this fixture explicit so
    // both pages exercise their connected workspace state.
    await page.route('**/api/health', async route => {
      healthChecks += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { status: 'ok', version: 'smoke' } })
      });
    });

    await page.route('**/api/runtime/status', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { status: {
          loaded: true, model: '/mock/models/model-2.gguf', backend: 'llama.cpp', runtime_id: null
        } } })
      });
    });

    await page.route('**/api/capability-preferences', route => {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON();
        if (['auto', 'guided', 'manual'].includes(payload?.selection_defaults?.mode)) {
          selectionMode = payload.selection_defaults.mode;
        }
      }
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { selection_defaults: { mode: selectionMode, eviction_policy: 'lru' } } })
      });
    });
    await page.route('**/api/resources', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { resources: { ram: {}, gpus: [], loaded_models: [] }, status: 'observed' } })
    }));
    await page.route('**/api/models/residency', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { residency: { items: [], count: 0, status: 'observed' } } })
    }));

    // Mock API for /api/models
    await page.route('**/api/models', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            models: [
              { id: 'mock-model-1', name: 'Mock Model 1', path: '/mock/models/model-1.gguf' },
              { id: 'mock-model-2', name: 'Mock Model 2', path: '/mock/models/model-2.gguf' }
            ]
          }
        })
      });
    });
    await page.route(/\/api\/model-profiles(?:\?.*)?$/, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: { profiles: [] } })
    }));
    await page.route('**/api/skills', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: { skills: [] } })
    }));
    await page.route('**/api/skills/chat.general/plan', async route => {
      guidedPlanPayload = route.request().postDataJSON();
      const pin = guidedPlanPayload?.selection?.capability_pins?.['text.chat'];
      const requestedModel = pin?.model_id || guidedPlanPayload?.selection?.pinned_model_id || 'mock-model-1';
      const modelId = forceManualMismatch && guidedPlanPayload?.selection?.mode === 'manual'
        ? 'mock-model-1' : requestedModel;
      const planId = modelId === 'mock-model-2' ? 'b'.repeat(24) : 'a'.repeat(24);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { plan: {
        plan_id: planId, mode: guidedPlanPayload?.selection?.mode || 'auto',
        resource_budget: { max_parallel_routes: 1 },
        nodes: [{ node_id: 'reply', capability_id: 'text.chat',
          selected: { id: `route-${modelId}`, model_id: modelId, runtime_id: 'llama.cpp' },
          alternatives: [{ id: 'route-mock-model-2', capability_id: 'text.chat', model_id: 'mock-model-2', runtime_id: 'vllm' }],
          why: [{ route_id: `route-${modelId}`, eligible: true, selected: true, reasons: ['compatible'] }] }]
      } } }) });
    });
    await page.route('**/api/skills/chat.general/run', async route => {
      guidedRunCount += 1;
      guidedRunPayload = route.request().postDataJSON();
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ data: { run: {
        id: 'c'.repeat(32), state: 'succeeded'
      } } }) });
    });
    await page.route(`**/api/runs/${'c'.repeat(32)}`, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: { run: {
        id: 'c'.repeat(32), state: 'succeeded', current_nodes: [], outputs: [], last_sequence: 4
      } } })
    }));

    // Mock API for /api/chats
    await page.route(/\/api\/chats(?:\/[^/?#]+)?(?:[?#].*)?$/, async route => {
      const chatPath = new URL(route.request().url()).pathname;
      if (chatPath.endsWith('/mock-chat-1')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              chat: {
                id: 'mock-chat-1',
                title: 'Mock Chat',
                messages: chatMessages
              }
            }
          })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              chats: [{ id: 'mock-chat-1', title: 'Mock Chat' }]
            }
          })
        });
      }
    });

    await page.route(/\/api\/chats\/mock-chat-1\/settings$/, async route => {
      if (route.request().method() === 'PATCH') {
        const settings = route.request().postDataJSON();
        knowledgeEnabled = settings?.knowledge?.enabled === true;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { settings: {
          generation: { temperature: 0.7, top_p: null, top_k: null, min_p: null, repeat_penalty: null, max_tokens: null },
          knowledge: { enabled: knowledgeEnabled }
        } } })
      });
    });

    await page.route('**/api/chat', async route => {
      chatPayload = route.request().postDataJSON();
      chatMessages = [...chatMessages, { role: 'user', content: chatPayload.prompt },
        { role: 'assistant', content: 'Mock answer\n\n```html\n<html><body>Hello</body></html>\n```' }];
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: delta\ndata: {"text":"Mock answer\\n\\n```html\\n<html><body>Hello</body></html>\\n```"}\n\nevent: complete\ndata: {"assistant":"Mock answer\\n\\n```html\\n<html><body>Hello</body></html>\\n```"}\n\n'
      });
    });

    // 1. Check Chat Page
    console.log("Checking Chat Page...");
    await page.goto('http://localhost:4200/chat');
    await page.waitForSelector('.chat-workspace', { state: 'visible', timeout: 30000 });

    // Geometry assertions for Chat
    const chatComposer = await page.locator('.composer').boundingBox();
    if (!chatComposer) throw new Error("Chat composer not found or invisible.");
    if (chatComposer.width < 100 || chatComposer.height < 20) throw new Error("Chat composer geometry invalid (clipped or too small).");

    const chatNewButton = await page.locator('.chat-new-button').boundingBox();
    if (!chatNewButton) throw new Error("Chat new button not found or invisible.");
    await expect(page.locator('.chat-new-button')).toBeEnabled();
    await expect(page.getByText('Local API unavailable')).toHaveCount(0);
    await expect(page.locator('.code-canvas')).toHaveCount(0);
    const knowledgeToggle = page.getByRole('checkbox', { name: 'Use local Knowledge in this chat' });
    await expect(knowledgeToggle).toBeEnabled();
    await knowledgeToggle.check();
    await expect.poll(() => knowledgeEnabled).toBe(true);
    await expect(page.getByText('Local full-text retrieval · no embeddings')).toBeVisible();
    await expect(page.locator('#chat-model')).toHaveValue('mock-model-2');
    await page.locator('#chat-model').selectOption('mock-model-1');
    await page.getByRole('button', { name: 'Direct chat' }).click();
    await page.getByRole('textbox', { name: 'Message' }).fill('Test request contract');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => chatPayload?.model_id).toBe('mock-model-1');
    await expect.poll(() => Object.keys(chatPayload || {}).sort()).toEqual(['chat_id', 'model_id', 'prompt']);
    await expect(page.getByText('Mock answer')).toBeVisible();
    await expect(page.locator('.code-canvas')).toHaveCount(0);
    await expect(page.locator('.message-content').filter({ hasText: '[html block is available to open in Canvas]' })).toBeVisible();
    await page.getByRole('button', { name: 'Open html in Canvas' }).click();
    await expect(page).toHaveURL(/\/canvas$/);
    await expect(page.getByRole('heading', { name: 'Canvas', level: 1 })).toBeVisible();
    const htmlPreview = page.locator('iframe.html-preview');
    await expect(htmlPreview).toBeVisible();
    await expect(page.frameLocator('iframe.html-preview').locator('body')).toContainText('Hello');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'chat.png') });

    // Guided plans must remain read-only until the exact reviewed plan is confirmed.
    await page.goto('http://localhost:4200/chat');
    await page.waitForSelector('.chat-workspace', { state: 'visible', timeout: 30000 });
    await page.getByRole('combobox', { name: 'Global orchestration mode' }).selectOption('guided');
    await expect.poll(() => selectionMode).toBe('guided');
    await page.getByRole('textbox', { name: 'Message' }).fill('Review this route before running');
    await page.getByRole('button', { name: 'Preview plan' }).click();
    await expect(page.getByRole('button', { name: 'Confirm plan and run' })).toBeEnabled();
    await expect.poll(() => guidedRunCount).toBe(0);
    await expect.poll(() => guidedPlanPayload?.selection?.mode).toBe('guided');
    await page.getByRole('button', { name: /Use mock-model-2/ }).click();
    await page.getByRole('button', { name: 'Preview plan' }).click();
    await expect.poll(() => guidedPlanPayload?.selection?.capability_pins?.['text.chat']?.model_id).toBe('mock-model-2');
    await expect.poll(() => guidedRunCount).toBe(0);
    await page.getByRole('button', { name: 'Confirm plan and run' }).click();
    await expect.poll(() => guidedRunCount).toBe(1);
    await expect.poll(() => guidedRunPayload?.expected_plan_id).toBe('b'.repeat(24));
    await expect.poll(() => guidedRunPayload?.selection?.capability_pins?.['text.chat']?.model_id).toBe('mock-model-2');

    // Auto executes the selected compatible plan directly; Manual keeps the
    // selected model as a hard pin and preserves the prompt if it cannot route.
    const modePicker = page.getByRole('combobox', { name: 'Global orchestration mode' });
    await modePicker.selectOption('auto');
    await expect.poll(() => selectionMode).toBe('auto');
    await page.getByRole('textbox', { name: 'Message' }).fill('Run with automatic route selection');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => guidedRunCount).toBe(2);
    await expect.poll(() => guidedRunPayload?.selection?.mode).toBe('auto');
    await expect(guidedRunPayload?.selection?.pinned_model_id).toBeUndefined();

    await modePicker.selectOption('manual');
    await expect.poll(() => selectionMode).toBe('manual');
    await page.getByRole('textbox', { name: 'Message' }).fill('Keep this prompt if the pinned route is unavailable');
    forceManualMismatch = true;
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.orchestration-error')).toContainText('Manual mode will not substitute another route');
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this prompt if the pinned route is unavailable');
    await expect.poll(() => guidedRunCount).toBe(2);
    forceManualMismatch = false;
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect.poll(() => guidedRunCount).toBe(3);
    await expect.poll(() => guidedRunPayload?.selection?.mode).toBe('manual');
    await expect.poll(() => guidedRunPayload?.selection?.pinned_model_id).toBe('mock-model-2');

    // 2. Check Agent Page
    console.log("Checking Agent Page...");
    await page.goto('http://localhost:4200/agent');
    await page.waitForSelector('.chat-workspace', { state: 'visible', timeout: 30000 });

    // Geometry assertions for Agent
    const agentComposer = await page.locator('.composer').boundingBox();
    if (!agentComposer) throw new Error("Agent composer not found or invisible.");
    if (agentComposer.width < 100 || agentComposer.height < 20) throw new Error("Agent composer geometry invalid (clipped or too small).");

    const agentNewButton = await page.locator('.chat-new-button').boundingBox();
    if (!agentNewButton) throw new Error("Agent new button not found or invisible.");
    await expect(page.locator('.chat-new-button')).toBeEnabled();
    await expect(page.getByText('Local API unavailable')).toHaveCount(0);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'agent.png') });

    if (healthChecks < 2) throw new Error(`Expected /api/health to be checked on both pages; received ${healthChecks} checks.`);
    if (unmatchedApiRequests.length) throw new Error(`Unmocked API requests: ${unmatchedApiRequests.join(', ')}`);
    if (hasErrors) {
        throw new Error("Browser or console errors were detected during execution.");
    }

    console.log("Smoke tests completed successfully!");
  } catch (error) {
    console.error("Smoke test failed:", error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
})();
