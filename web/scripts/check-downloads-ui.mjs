import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'web', 'dist');
const artifactDir = path.join(root, 'artifacts', 'ui-smoke', 'downloads');
fs.mkdirSync(artifactDir, { recursive: true });

const mimeTypes = {
  '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const requested = path.resolve(dist, `.${decodeURIComponent(pathname)}`);
  const target = requested.startsWith(`${dist}${path.sep}`) || requested === path.join(dist, 'index.html')
    ? requested
    : path.join(dist, 'index.html');
  const sendFile = file => fs.readFile(file, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT' && file !== path.join(dist, 'index.html')) {
        sendFile(path.join(dist, 'index.html'));
        return;
      }
      res.writeHead(500);
      res.end(`Could not read built web asset: ${error.code}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  });
  sendFile(target);
});

function downloadsEnvelope(downloads) {
  // Match ApiServices' actual {data: {downloads: [...]}} response envelope.
  return { data: { downloads } };
}

async function serveDownloads(page, responseForCall) {
  await page.route('**/api/downloads', async route => {
    const response = await responseForCall(route.request());
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  // Active-job SSE is intentionally not part of this page smoke check.
  await page.route('**/api/downloads/*/events', route => route.abort());
}

async function expectDownloadsResponse(page, status = 200) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/downloads' && response.request().method() === 'GET' && response.status() === status;
  });
}

let browser;
let context;
let serverStarted = false;
try {
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('web/dist/index.html is missing; build the web app before running this smoke test.');
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  serverStarted = true;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the ephemeral smoke server port.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(candidate => fs.existsSync(candidate));
  browser = await chromium.launch({ headless: true, ...(systemChrome ? { executablePath: systemChrome } : {}) });
  context = await browser.newContext({ viewport: { width: 1320, height: 900 } });

  // Populated state: mixed in-progress, failed, and completed entries render as cards.
  {
    const page = await context.newPage();
    const jobs = [
      { id: 'dl-1', repo_id: 'TheBloke/Llama-2-7B-Chat-GGUF', file_name: 'llama-2-7b-chat.Q4_K_M.gguf', state: 'downloading', downloaded_bytes: 500000000, total_bytes: 4080000000, progress: 0.1225 },
      { id: 'dl-2', repo_id: 'TheBloke/Mistral-7B-Instruct-v0.1-GGUF', file_name: 'mistral-7b-instruct-v0.1.Q5_K_M.gguf', state: 'error', downloaded_bytes: 0, error: 'Connection lost' },
      { id: 'dl-3', repo_id: 'Another/Repo', file_name: 'model.gguf', state: 'completed', downloaded_bytes: 100, total_bytes: 100, progress: 1 },
    ];
    await serveDownloads(page, async () => ({ status: 200, body: downloadsEnvelope(jobs) }));
    const responsePromise = expectDownloadsResponse(page);
    await page.goto(`${baseUrl}/downloads`);
    const response = await responsePromise;
    expect(await response.json()).toEqual(downloadsEnvelope(jobs));
    await expect(page.getByText('llama-2-7b-chat.Q4_K_M.gguf')).toBeVisible();
    await expect(page.getByText('mistral-7b-instruct-v0.1.Q5_K_M.gguf')).toBeVisible();
    await expect(page.getByText('model.gguf')).toBeVisible();
    await page.screenshot({ path: path.join(artifactDir, 'downloads-populated.png'), fullPage: true });
    await page.close();
  }

  // Empty state: show only after the successful empty response has been received.
  {
    const page = await context.newPage();
    await serveDownloads(page, async () => ({ status: 200, body: downloadsEnvelope([]) }));
    const responsePromise = expectDownloadsResponse(page);
    await page.goto(`${baseUrl}/downloads`);
    const response = await responsePromise;
    expect(await response.json()).toEqual(downloadsEnvelope([]));
    await expect(page.getByRole('heading', { name: 'No active downloads' })).toBeVisible();
    await page.screenshot({ path: path.join(artifactDir, 'downloads-empty.png'), fullPage: true });
    await page.close();
  }

  // Loading state: hold the API response so the UI has a deterministic loading interval.
  {
    const page = await context.newPage();
    let releaseResponse;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    await serveDownloads(page, async () => {
      await responseGate;
      return { status: 200, body: downloadsEnvelope([]) };
    });
    const responsePromise = expectDownloadsResponse(page);
    await page.goto(`${baseUrl}/downloads`);
    try {
      await expect(page.locator('[role="status"]').getByRole('heading', { name: 'Loading downloads' })).toBeVisible();
      await page.screenshot({ path: path.join(artifactDir, 'downloads-loading.png'), fullPage: true });
    } finally {
      releaseResponse();
    }
    await responsePromise;
    await expect(page.getByRole('heading', { name: 'No active downloads' })).toBeVisible();
    await page.close();
  }

  // Error and retry: first request fails, retry succeeds with the actual empty envelope.
  {
    const page = await context.newPage();
    let callCount = 0;
    await serveDownloads(page, async () => {
      callCount += 1;
      return callCount === 1
        ? { status: 503, body: { error: 'Downloads API unavailable' } }
        : { status: 200, body: downloadsEnvelope([]) };
    });
    const failedResponsePromise = expectDownloadsResponse(page, 503);
    await page.goto(`${baseUrl}/downloads`);
    await failedResponsePromise;
    await expect(page.locator('section.hub-empty[role="alert"]'))
      .toContainText(/downloads api unavailable/i);
    await page.screenshot({ path: path.join(artifactDir, 'downloads-error.png'), fullPage: true });

    const retryResponsePromise = expectDownloadsResponse(page, 200);
    await page.getByRole('button', { name: /retry/i }).click();
    const retryResponse = await retryResponsePromise;
    expect(await retryResponse.json()).toEqual(downloadsEnvelope([]));
    await expect(page.getByRole('heading', { name: 'No active downloads' })).toBeVisible();
    await page.close();
  }

  console.log(`Downloads UI smoke passed. Screenshots: ${artifactDir}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (serverStarted) {
    await new Promise(resolve => server.close(() => resolve()));
  }
}
