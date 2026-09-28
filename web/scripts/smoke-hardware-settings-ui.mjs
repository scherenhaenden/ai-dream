import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'http';
import serveStatic from 'serve-static';
import finalhandler from 'finalhandler';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run() {
  const serve = serveStatic(join(__dirname, '../dist'), { index: ['index.html'] });
  const server = createServer(function onRequest(req, res) {
    if (!req.url.includes('.')) {
      req.url = '/index.html';
    }
    serve(req, res, finalhandler(req, res));
  });

  server.listen(3334, async () => {
    console.log('Static server listening on 3334');

    let success = false;
    let browser;
    try {
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const context = await browser.newContext();
      const page = await context.newPage();

      // Mocks
      await page.route('**/api/health', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' })
      }));

      await page.route('**/api/settings', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          data: {
            settings: {
              default_profile_behavior: 'model', keep_last_model_loaded: true,
              managed_models_dir: '/path/to/models', config_dir: '/path/to/config', data_dir: '/path/to/data',
              runtime_defaults: { backend_name: 'vulkan', runtime_id: 'llama-cpp-1' }
            }
          }
        })
      }));

      await page.route('**/api/runtime', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          data: { backends: [ { name: 'vulkan', available: true }, { name: 'cuda', available: false }, { name: 'cpu', available: true } ] }
        })
      }));

      await page.route('**/api/models', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          data: { models: [] }
        })
      }));

      await page.route('**/api/runtime/installations', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          data: { installations: [ { id: 'llama-cpp-1', name: 'Llama.cpp (stable)', backend: 'vulkan', enabled: true, available: true } ] }
        })
      }));

      await page.route('**/api/hardware', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          data: { hardware: { cpu: { name: 'AMD Ryzen 9 7950X', physical_cores: 16, logical_cores: 32 }, ram: { total_bytes: 68719476736, available_bytes: 38229606400 }, os: { system: 'Linux', release: '6.8.0', distribution: 'Ubuntu' }, gpus: [ { id: 'gpu-0', name: 'Radeon RX 9070', vendor: 'AMD', memory: { total_bytes: 17179869184, free_bytes: 2147483648 }, temp_c: 54 } ] } }
        })
      }));

      console.log('Navigating to hardware page...');
      await page.goto('http://127.0.0.1:3334/hardware', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      const hwTitle = await page.textContent('body');
      if (!hwTitle.includes('Hardware Orchestration')) throw new Error('Hardware title missing in body');
      if (!hwTitle.includes('AMD Ryzen 9 7950X')) throw new Error('CPU mock data not found on hardware page');
      if (!hwTitle.includes('Radeon RX 9070')) throw new Error('GPU mock data not found on hardware page');

      await fs.mkdir(join(__dirname, '../../artifacts/ui-smoke'), { recursive: true });
      await page.screenshot({ path: join(__dirname, '../../artifacts/ui-smoke/hardware.png') });
      console.log('Hardware screenshot saved.');

      console.log('Navigating to settings page...');
      await page.goto('http://127.0.0.1:3334/settings', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      const setBody = await page.textContent('body');
      if (!setBody.includes('Workstation Engine & Hardware Preferences')) throw new Error('Settings title missing');
      if (!setBody.includes('/path/to/models')) throw new Error('Mock model path not found on settings page');

      await page.click('button[role="tab"]:has-text("Runtime defaults")');
      await page.waitForTimeout(1000);

      const htmlContent = await page.content();
      if (!htmlContent.includes('vulkan')) throw new Error('Mock backend not found on settings page html');
      if (!htmlContent.includes('Llama.cpp')) throw new Error('Mock installation not found on settings page html');

      await page.screenshot({ path: join(__dirname, '../../artifacts/ui-smoke/settings.png') });
      console.log('Settings screenshot saved.');

      success = true;
    } catch (e) {
      console.error('Test failed:', e);
    } finally {
      if (browser) await browser.close();
      server.close();
      process.exit(success ? 0 : 1);
    }
  });
}

run();
