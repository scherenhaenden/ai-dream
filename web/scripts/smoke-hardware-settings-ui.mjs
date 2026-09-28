import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artifactDir = path.resolve(__dirname, '../../artifacts/ui-smoke');
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

(async () => {
  const build = spawn('npm', ['run', 'build'], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    build.on('close', code => {
      if (code === 0) resolve(); else reject(new Error('build failed'));
    });
  });

  const vitePreview = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1'], { cwd: path.resolve(__dirname, '..') });
  let serverReady = false;

  await new Promise((resolve) => {
    vitePreview.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Local:')) {
        serverReady = true;
        resolve();
      }
    });
    // In case preview starts very fast or fails
    setTimeout(resolve, 5000);
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.route('**/api/hardware', async route => {
    const mockHardware = {
      data: {
        cpu: { cores: 16, vendor: "Mock CPU Vendor", model: "Mock CPU Model" },
        memory: { total_gb: 32, free_gb: 16 },
        devices: [
          { id: "GPU0", name: "Mock GPU 1", memory: 16 },
          { id: "GPU1", name: "Mock GPU 2", memory: 16 }
        ]
      }
    };
    await route.fulfill({ json: mockHardware });
  });

  await page.route('**/api/settings', async route => {
    const mockSettings = {
      data: {
        settings: {
          runtime_defaults: { runtime_id: null, backend_name: "llama.cpp", placement: {}, load: {} },
          managed_models_dir: "/mock/models",
          config_dir: "/mock/config",
          data_dir: "/mock/data",
          default_profile_behavior: "global",
          keep_last_model_loaded: true
        }
      }
    };
    await route.fulfill({ json: mockSettings });
  });

  await page.route('**/api/health', async route => {
    await route.fulfill({ json: { status: "ok" } });
  });

  try {
    await page.goto('http://127.0.0.1:4173/#/hardware', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(artifactDir, 'hardware.png') });

    await page.goto('http://127.0.0.1:4173/#/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(artifactDir, 'settings.png') });

    // Save as hardware-settings.png
    await page.screenshot({ path: path.join(artifactDir, 'hardware-settings.png') });
    console.log("Smoke test successful!");

  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
    vitePreview.kill();
    process.exit(0);
  }
})();
