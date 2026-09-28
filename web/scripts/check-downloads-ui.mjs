import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';

// Serve the built dist directory
const server = createServer((req, res) => {
  let filePath = './web/dist' + req.url;
  if (filePath === './web/dist/') filePath = './web/dist/index.html';

  const extname = path.extname(filePath);
  let contentType = 'text/html';
  switch (extname) {
    case '.js': contentType = 'text/javascript'; break;
    case '.css': contentType = 'text/css'; break;
    case '.json': contentType = 'application/json'; break;
    case '.png': contentType = 'image/png'; break;
    case '.jpg': contentType = 'image/jpg'; break;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if(err.code == 'ENOENT'){
         fs.readFile('./web/dist/index.html', (err, content) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content, 'utf-8');
         });
      } else {
        res.writeHead(500);
        res.end('Sorry, check with the site admin for error: '+err.code+' ..\n');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(8080, async () => {
  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });

    // Test 1: Populated State
    let page = await context.newPage();
    await page.route('**/api/downloads', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          downloads: [
            {
              id: 'dl-1',
              repo_id: 'TheBloke/Llama-2-7B-Chat-GGUF',
              file_name: 'llama-2-7b-chat.Q4_K_M.gguf',
              state: 'downloading',
              downloaded_bytes: 500000000,
              total_bytes: 4080000000,
              progress: 0.1225
            },
            {
              id: 'dl-2',
              repo_id: 'TheBloke/Mistral-7B-Instruct-v0.1-GGUF',
              file_name: 'mistral-7b-instruct-v0.1.Q5_K_M.gguf',
              state: 'error',
              error: 'Connection lost'
            },
            {
              id: 'dl-3',
              repo_id: 'Another/Repo',
              file_name: 'model.gguf',
              state: 'completed',
              downloaded_bytes: 100,
              total_bytes: 100,
              progress: 1
            }
          ]
        })
      });
    });
    await page.route('**/api/downloads/*/events', async route => { await route.abort(); });

    await page.goto('http://127.0.0.1:8080/downloads');
    await page.waitForTimeout(2000);
    fs.mkdirSync('artifacts/ui-smoke/downloads', { recursive: true });
    await page.screenshot({ path: 'artifacts/ui-smoke/downloads/downloads-populated.png' });
    const content = await page.textContent('body');
    if (!content.includes('llama-2-7b-chat')) throw new Error('Populated downloads not shown');
    await page.close();

    // Test 2: Empty State
    page = await context.newPage();
    await page.route('**/api/downloads', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ downloads: [] })
      });
    });

    await page.goto('http://127.0.0.1:8080/downloads');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'artifacts/ui-smoke/downloads/downloads-empty.png' });
    const emptyContent = await page.textContent('body');
    if (!emptyContent.includes('No active downloads')) throw new Error('Empty state not shown');
    await page.close();

    await browser.close();
    server.close();
    console.log("Smoke test passed!");
    process.exit(0);
  } catch (e) {
    console.error(e);
    server.close();
    process.exit(1);
  }
});
