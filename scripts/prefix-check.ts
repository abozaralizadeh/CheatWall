// Proves the site works under a path prefix, the way nginx serves it on a shared VM.
// It starts the app with BASE_PATH=/cheatwall/ and the fake provider, puts a tiny proxy in front that does what
// the nginx snippet from setup_service.sh does (strip the prefix, redirect the bare path, pass the visitor address),
// then makes a poster in a real browser and checks that every request stayed under /cheatwall/.
// Usage: node scripts/prefix-check.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../src/render/chromium.ts';

const BASE = '/cheatwall/';
const APP_PORT = 3211;
const PROXY_PORT = 3212;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheatwall-prefix-'));

const app = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], {
  env: { ...process.env, PORT: String(APP_PORT), BASE_PATH: BASE, PROVIDER: 'fake', TRUST_PROXY: '127.0.0.1', DATA_DIR: path.join(dir, 'data'), LOG_DIR: path.join(dir, 'logs') },
  stdio: ['ignore', 'ignore', 'inherit'],
});

// Same rules as the nginx location blocks.
const proxy = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === BASE.slice(0, -1)) { res.writeHead(301, { Location: BASE }); res.end(); return; }
  if (!url.startsWith(BASE)) { res.writeHead(404); res.end('outside the prefix'); return; }
  const up = http.request({ host: '127.0.0.1', port: APP_PORT, path: url.slice(BASE.length - 1), method: req.method, headers: { ...req.headers, 'x-forwarded-for': '203.0.113.7' } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});
proxy.listen(PROXY_PORT, '127.0.0.1');

const origin = `http://127.0.0.1:${PROXY_PORT}`;
const fail = (msg: string) => { throw new Error(msg); };
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${APP_PORT}/api/health`)).ok) break; } catch { /* starting */ }
    if (i > 40) fail('app did not start');
    await new Promise((r) => setTimeout(r, 250));
  }
  const bare = await fetch(origin + BASE.slice(0, -1), { redirect: 'manual' });
  if (bare.status !== 301 || bare.headers.get('location') !== BASE) fail('bare path should redirect to ' + BASE);

  browser = await chromium.launch({ executablePath: findChrome() ?? fail('no Chrome found') });
  const page = await browser.newPage();
  const outside: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === origin && !u.pathname.startsWith(BASE)) outside.push(u.pathname); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(origin + BASE);
  await page.fill('#topic', 'SQL');
  await page.click('#go');
  await page.waitForURL(new RegExp(`${BASE}p/[A-Za-z0-9_-]{22}$`));
  await page.waitForSelector('img.preview', { timeout: 60_000 });
  await page.waitForFunction(() => (document.querySelector('img.preview') as HTMLImageElement | null)?.naturalWidth! > 0);
  await page.click('text=Midnight');
  await page.waitForSelector('button[aria-checked="true"]:has-text("Midnight")');
  const pdf = await page.getAttribute('a:has-text("Download PDF")', 'href');
  if (!pdf?.startsWith(`${BASE}api/posters/`)) fail('PDF link is not under the prefix: ' + pdf);
  if ((await fetch(origin + pdf)).status !== 200) fail('PDF download failed');
  await page.click('a:has-text("Make another poster")');
  await page.waitForURL(origin + BASE);
  await page.click('a:has-text("About")');
  await page.waitForURL(origin + BASE + 'about');

  if (outside.length) fail('requests left the prefix: ' + [...new Set(outside)].join(', '));
  if (errors.length) fail('errors: ' + errors.join(', '));
  console.log(`prefix check passed: home, poster, theme switch, PDF, links, all under ${BASE}`);
} finally {
  await browser?.close();
  proxy.close();
  app.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
}
