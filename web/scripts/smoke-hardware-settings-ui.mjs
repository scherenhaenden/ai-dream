import fs from 'fs';
import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';

const SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });


const hardwareResponse = {
  data: {
    hardware: {
      cpu: { name: "AMD Ryzen 9 7950X 16-Core Processor", logical_cores: 32, physical_cores: 16 },
      ram: { total_bytes: 67364000000, available_bytes: 42000000000 },
      os: { system: "Linux", release: "6.8.0-generic", version: "#1 SMP PREEMPT_DYNAMIC", architecture: "x86_64", distribution: "Ubuntu 24.04 LTS" },
      gpus: [
        { index: 0, vendor: "AMD", name: "Radeon RX 7900 XTX", memory_total_bytes: 25752000000, memory_free_bytes: 23000000000, backends: ["vulkan"], pci_address: "0000:03:00.0", virtual: false, pci_vendor_id: "1002", pci_device_id: "744c" }
      ]
    }
  }
};

const settingsResponse = {
  data: {
    settings: {
      default_profile_behavior: "global",
      keep_last_model_loaded: true,
      managed_models_dir: "/path/to/models",
      config_dir: "/path/to/config",
      data_dir: "/path/to/data",
      runtime_defaults: {
        backend_name: "vulkan",
        runtime_id: "llama-cpp-1"
      }
    }
  }
};

const healthResponse = { data: { status: 'ok', version: '0.1.0' } };
const snapshotResponse = { data: { backends: [{name: 'vulkan', available: true}] } };
const installationsResponse = { data: { installations: [{id: 'llama-cpp-1', name: 'llama.cpp v1.0', kind: 'executable', enabled: true, available: true}] } };


async function runSmokeTests() {
  console.log('starting browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const page = await context.newPage();

  let hasErrors = false;
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`Browser console error: ${msg.text()}`);
      hasErrors = true;
    } else {
        console.log(`Browser console: ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.error(`Browser page error: ${err.message}`);
    hasErrors = true;
  });

  try {
    await page.route('**/api/health', route => route.fulfill({ json: healthResponse }));
    await page.route('**/api/hardware', route => route.fulfill({ json: hardwareResponse }));
    await page.route('**/api/settings', route => route.fulfill({ json: settingsResponse }));
    await page.route('**/api/runtime', route => route.fulfill({ json: snapshotResponse }));
    await page.route('**/api/runtime', route => route.fulfill({ json: snapshotResponse }));
    await page.route('**/api/runtime/installations', route => route.fulfill({ json: installationsResponse }));
    await page.route('**/api/models', route => route.fulfill({ json: { data: { models: [] } } }));

    // Test Hardware Page
    console.log('testing hardware page...');
    await page.goto('http://127.0.0.1:5173/hardware');
    await page.waitForLoadState('networkidle');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Assert Heading exists
    const hardwareHeading = page.locator('h1', { hasText: 'Hardware' });
    await expect(hardwareHeading).toBeVisible();

    // Check cards
    await expect(page.locator('text=AMD Ryzen')).toBeVisible();
    await expect(page.locator('text=Radeon RX 7900 XTX')).toBeVisible();

    // Check JSON initially hidden
    const jsonPre = page.locator('pre');
    await expect(jsonPre).not.toBeVisible();

    // Click show JSON toggle
    const toggleButton = page.locator('button', { hasText: /Show JSON/i });
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    // Now JSON should be visible
    await expect(jsonPre).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'hardware-page.png') });
    console.log('Hardware page verified and screenshot saved.');


    // Test Settings Page
    console.log('testing settings page...');
    await page.goto('http://127.0.0.1:5173/settings');
    await page.waitForLoadState('networkidle');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Assert Heading exists
    const settingsHeading = page.locator('h1', { hasText: 'Settings' });
    await expect(settingsHeading).toBeVisible();

    await expect(page.locator('text=Application behavior')).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-page-general.png') });

    // Click Runtime defaults tab
    const runtimeTab = page.locator('button[role="tab"]', { hasText: 'Runtime defaults' });
    await runtimeTab.click();
    await page.waitForLoadState('networkidle');
    await new Promise(resolve => setTimeout(resolve, 500));

    await expect(page.locator('text=Choose the default engine')).toBeVisible();

    const backendSelect = page.locator('select').first();
    await backendSelect.selectOption('vulkan');
    await expect(backendSelect).toHaveValue('vulkan');
    const runtimeSelect = page.locator('select').nth(1);
    await runtimeSelect.selectOption('llama-cpp-1');
    await expect(runtimeSelect).toHaveValue('llama-cpp-1');


    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'settings-page-runtime.png') });
    console.log('Settings page verified and screenshots saved.');

  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (hasErrors) {
        process.exitCode = 1;
    }
  }
}

runSmokeTests();
