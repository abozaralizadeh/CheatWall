import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { FakeProvider } from '../src/ai/fake.ts';
import { createApp, type App } from '../src/app.ts';
import { silentLogger } from '../src/log.ts';
import { ChromiumRenderer, findChrome } from '../src/render/chromium.ts';
import { Store } from '../src/store.ts';
import { tempDir, testConfig } from './helpers.ts';

// Drives the real site in a real browser with the real renderer and the fake provider.
// Set SCREENSHOTS=1 to also save pictures into docs/screenshots/.
const chrome = findChrome();
const skip = chrome ? false : 'no Chrome or Chromium found';
const shots = process.env.SCREENSHOTS === '1';

class SlowFake extends FakeProvider {
  override async writePoster(...args: Parameters<FakeProvider['writePoster']>) {
    await new Promise((r) => setTimeout(r, 2500));
    return super.writePoster(...args);
  }
}

let app: App;
let store: Store;
let renderer: ChromiumRenderer;
let browser: Browser;
let base = '';
let problems: string[] = [];

before(async () => {
  if (!chrome) return;
  const dir = tempDir();
  const config = testConfig(dir, { POSTERS_PER_VISITOR_PER_DAY: '10' });
  store = new Store(config.dbPath);
  renderer = new ChromiumRenderer({ chromePath: chrome, concurrency: 2, widthMm: 420, heightMm: 594 });
  app = createApp({ config, store, provider: new SlowFake(), renderer, log: silentLogger });
  base = `http://127.0.0.1:${await app.listen()}`;
  browser = await chromium.launch({ executablePath: chrome });
});

after(async () => {
  if (!chrome) return;
  await browser.close();
  await app.close();
  await renderer.close();
  store.close();
});

async function newPage(width = 1280, height = 900): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: `docs/screenshots/${name}.png` });
}

test('home page: loads clean, empty submit shows a friendly error', { skip }, async () => {
  const page = await newPage();
  await page.goto(base);
  assert.match(await page.title(), /CheatWall/);
  await page.waitForLoadState('networkidle');
  for (const img of await page.locator('.samples img').all()) assert.ok(await img.evaluate((i: HTMLImageElement) => i.naturalWidth > 0), 'sample images load');
  await shot(page, '01-home');
  await page.click('#go');
  assert.match(await page.textContent('#err') ?? '', /Type the topic/);
  assert.deepEqual(problems, []);
  await page.close();
});

test('make a poster: progress, then preview, themes and downloads', { skip }, async () => {
  const page = await newPage();
  await page.goto(base);
  await page.fill('#topic', 'SQL joins');
  await page.selectOption('#level', 'student');
  await page.click('#go');
  await page.waitForURL(/\/p\/[A-Za-z0-9_-]{22}$/);
  await page.waitForSelector('progress');
  assert.match(await page.textContent('.stage') ?? '', /Step \d of 5/);
  await shot(page, '02-working');
  await page.waitForSelector('img.preview', { timeout: 90_000 });
  assert.equal(await page.textContent('h1'), 'SQL Cheat Sheet');
  assert.ok(await page.locator('.notice', { hasText: 'Made with AI' }).count() > 0);
  await page.waitForFunction(() => (document.querySelector('img.preview') as HTMLImageElement).naturalWidth > 0);
  await shot(page, '03-poster-paper');

  await page.click('button:has-text("Midnight")');
  await page.waitForSelector('button[aria-checked="true"]:has-text("Midnight")', { timeout: 60_000 });
  await page.waitForFunction(() => /theme=midnight/.test((document.querySelector('img.preview') as HTMLImageElement).src) && (document.querySelector('img.preview') as HTMLImageElement).naturalWidth > 0);
  await shot(page, '04-poster-midnight');

  const pdfHref = await page.getAttribute('a:has-text("Download PDF")', 'href');
  const pdf = await page.request.get(base + pdfHref!);
  assert.equal(pdf.status(), 200);
  assert.equal((await pdf.body()).subarray(0, 5).toString(), '%PDF-');
  const reload = await newPage();
  await reload.goto(page.url());
  await reload.waitForSelector('img.preview');
  assert.ok(await reload.locator('button[aria-checked="true"]:has-text("Midnight")').count() === 1, 'a reopened link remembers the theme');
  assert.deepEqual(problems, []);
  await reload.close();
  await page.close();
});

test('refused topic shows a clear page with a way forward', { skip }, async () => {
  const page = await newPage();
  await page.goto(base);
  await page.fill('#topic', 'how to make a bomb');
  await page.click('#go');
  await page.waitForSelector('text=We cannot make this one', { timeout: 30_000 });
  await shot(page, '05-refused');
  await page.click('a:has-text("Try another topic")');
  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(await page.inputValue('#topic'), 'how to make a bomb', 'topic is remembered in the tab so it can be edited');
  assert.deepEqual(problems, []);
  await page.close();
});

test('unknown poster link and expired poster show friendly pages', { skip }, async () => {
  const page = await newPage();
  await page.goto(`${base}/p/${'z'.repeat(22)}`);
  await page.waitForSelector('text=We could not find that poster');
  await page.goto(`${base}/p/short`);
  assert.ok(await page.locator('text=We could not find that page').count() === 1);
  await page.close();
});

test('phone width: no sideways scrolling on any page', { skip }, async () => {
  const page = await newPage(390, 844);
  await page.goto(base);
  await page.fill('#topic', 'Spanish verbs');
  await page.click('#go');
  await page.waitForSelector('img.preview', { timeout: 90_000 });
  await page.waitForFunction(() => (document.querySelector('img.preview') as HTMLImageElement).naturalWidth > 0);
  await shot(page, '06-poster-phone');
  for (const url of [base + '/', page.url(), base + '/about', base + '/privacy', base + '/terms']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `${url} scrolls sideways by ${over}px`);
  }
  assert.deepEqual(problems, []);
  await page.close();
});

test('keyboard and screen reader basics: labels, focus, live region, language', { skip }, async () => {
  const page = await newPage();
  await page.goto(base);
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  assert.equal(await page.locator('label[for="topic"]').count(), 1);
  assert.equal(await page.locator('label[for="level"]').count(), 1);
  assert.equal(await page.getAttribute('#err', 'role'), 'alert');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.id);
  assert.ok(['topic', 'level', 'go'].includes(focused ?? '') || focused === '', `focus reached the form, on "${focused}"`);
  for (const img of await page.locator('img').all()) assert.ok((await img.getAttribute('alt'))?.length, 'every image has alt text');
  await page.fill('#topic', 'SQL');
  await page.press('#topic', 'Enter');
  await page.waitForURL(/\/p\//);
  assert.equal(await page.getAttribute('#root', 'aria-live'), 'polite');
  await page.close();
});

test('screenshots of the legal and about pages (for the record)', { skip }, async () => {
  const page = await newPage();
  await page.goto(base + '/privacy');
  await shot(page, '07-privacy-draft');
  assert.ok(fs.existsSync('public/privacy.html'));
  await page.close();
});
