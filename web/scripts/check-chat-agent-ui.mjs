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

    // Mock API for /api/models
    await page.route('**/api/models', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            models: [{ id: 'mock-model-1', name: 'Mock Model' }]
          }
        })
      });
    });

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
                messages: [
                  { role: 'user', content: 'Hello' },
                  { role: 'assistant', content: 'Hi there!' }
                ]
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

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'chat.png') });

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
