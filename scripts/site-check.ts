// Renders the Pages site in a real browser: screenshots at 1440 and 375 px in light and dark, a sideways-scroll check,
// the 1200x630 social image and the apple touch icon.
// Usage: node scripts/site-check.ts [--og]   (screenshots go to out/site-check/, --og also writes site/img/og.png and the icon)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../src/render/chromium.ts';

const out = 'out/site-check';
fs.mkdirSync(out, { recursive: true });
const chrome = findChrome();
if (!chrome) throw new Error('No Chrome found');
const browser = await chromium.launch({ executablePath: chrome });
const site = 'file://' + path.resolve('site/index.html');

try {
  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [1440, 375]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('requestfailed', (r) => errors.push('failed ' + r.url()));
      await page.goto(site, { waitUntil: 'networkidle' });
      // Load every lazy image before the full-page shot.
      await page.evaluate(async () => {
        for (const img of document.querySelectorAll('img')) img.loading = 'eager';
        await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
        await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
        await document.fonts.ready;
        for (let y = 0; y < document.body.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise((r) => requestAnimationFrame(r)); }
        scrollTo(0, 0);
      });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        broken: [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')),
        noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
      }));
      const name = `${width}-${scheme}`;
      await page.screenshot({ path: `${out}/${name}-top.png` });
      await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
      console.log(name, JSON.stringify(m), errors.length ? errors : 'no errors');
      await ctx.close();
    }
  }
  if (process.argv.includes('--og')) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } });
    const page = await ctx.newPage();
    await page.goto('file://' + path.resolve('scripts/site-og.html'), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: 'site/img/og.png' });
    await page.setViewportSize({ width: 180, height: 180 });
    await page.setContent(`<body style="margin:0;background:#15171c"><img src="file://${path.resolve('site/favicon.svg')}" style="width:180px;height:180px;display:block"></body>`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'site/img/apple-touch-icon.png' });
    console.log('wrote site/img/og.png and site/img/apple-touch-icon.png');
    await ctx.close();
  }
} finally {
  await browser.close();
}
