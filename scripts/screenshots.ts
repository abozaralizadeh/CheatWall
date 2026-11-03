// Drives a RUNNING CheatWall (npm start) in a real browser and saves screenshots into docs/screenshots/.
// Usage: BASE_URL=http://127.0.0.1:3100 node scripts/screenshots.ts
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { findChrome } from '../src/render/chromium.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const chrome = findChrome();
if (!chrome) throw new Error('No Chrome found');
fs.mkdirSync('docs/screenshots', { recursive: true });
const browser = await chromium.launch({ executablePath: chrome });
const problems: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'docs/screenshots/01-home.png' });
  await page.fill('#topic', 'Spanish verbs');
  await page.selectOption('#level', 'student');
  await page.click('#go');
  await page.waitForURL(/\/p\//);
  await page.waitForSelector('progress');
  await page.screenshot({ path: 'docs/screenshots/02-working.png' });
  await page.waitForSelector('img.preview', { timeout: 120_000 });
  await page.waitForFunction(() => (document.querySelector('img.preview') as HTMLImageElement).naturalWidth > 0);
  await page.screenshot({ path: 'docs/screenshots/03-poster-paper.png' });
  await page.click('button:has-text("Midnight")');
  await page.waitForSelector('button[aria-checked="true"]:has-text("Midnight")', { timeout: 60_000 });
  await page.waitForFunction(() => /theme=midnight/.test((document.querySelector('img.preview') as HTMLImageElement).src) && (document.querySelector('img.preview') as HTMLImageElement).naturalWidth > 0);
  await page.screenshot({ path: 'docs/screenshots/04-poster-midnight.png' });
  const png = await page.request.get(base + (await page.getAttribute('a:has-text("Download PNG")', 'href'))!.replace('&download=1', ''));
  fs.writeFileSync('docs/screenshots/08-poster-full-size.png', await png.body());
  const pdfHref = await page.getAttribute('a:has-text("Download PDF")', 'href');
  const pdf = await page.request.get(base + pdfHref!);
  console.log('pdf', pdf.status(), (await pdf.body()).subarray(0, 5).toString(), (await pdf.body()).length, 'bytes');
  await page.goto(base);
  await page.fill('#topic', 'how to make a bomb');
  await page.click('#go');
  await page.waitForSelector('text=We cannot make this one', { timeout: 30_000 });
  await page.screenshot({ path: 'docs/screenshots/05-refused.png' });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(base);
  await phone.fill('#topic', 'SQL');
  await phone.click('#go');
  await phone.waitForSelector('img.preview', { timeout: 120_000 });
  await phone.waitForFunction(() => (document.querySelector('img.preview') as HTMLImageElement).naturalWidth > 0);
  await phone.screenshot({ path: 'docs/screenshots/06-poster-phone.png' });
  await (await browser.newPage()).goto(base + '/privacy').then(() => undefined);
  console.log('browser problems:', problems.length ? problems : 'none');
} finally {
  await browser.close();
}
