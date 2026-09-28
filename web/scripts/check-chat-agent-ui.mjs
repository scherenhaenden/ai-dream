import { test, expect, chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });

  let hasErrors = false;

  try {
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
        return; // Handle APIs in specific routes below
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

    // Mock API for /api/check
    await page.route('**/api/check', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({})
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
    await page.route('**/api/chats*', route => {
      if (route.request().url().endsWith('mock-chat-1')) {
        route.fulfill({
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
        route.fulfill({
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

    await page.screenshot({ path: 'artifacts/ui-smoke/chat-agent/chat.png' });

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

    await page.screenshot({ path: 'artifacts/ui-smoke/chat-agent/agent.png' });

    if (hasErrors) {
        throw new Error("Browser or console errors were detected during execution.");
    }

    console.log("Smoke tests completed successfully!");
  } catch (error) {
    console.error("Smoke test failed:", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
