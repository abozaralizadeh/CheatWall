// Drives a RUNNING CheatWall (fake provider, fresh data folder) and saves sharp screenshots and posters for the Pages site.
// Usage: BASE_URL=http://127.0.0.1:3100 node scripts/site-shots.ts   (writes PNGs to out/site/)
import fs from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../src/render/chromium.ts';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const dir = 'out/site';
const chrome = findChrome();
if (!chrome) throw new Error('No Chrome found');
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome });

async function flow(scheme: 'light' | 'dark', topic: string, level: string, themes: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForLoadState('networkidle');
  await page.fill('#topic', topic);
  await page.selectOption('#level', level);
  await shot(page, `step-1-${scheme}`);
  await page.click('#go');
  await page.waitForSelector('progress');
  await page.waitForFunction(() => Number((document.querySelector('progress') as HTMLProgressElement | null)?.value ?? 0) >= 2, undefined, { timeout: 60_000 }).catch(() => {});
  await shot(page, `step-2-${scheme}`);
  await page.waitForSelector('img.preview', { timeout: 120_000 });
  await page.waitForFunction(() => (document.querySelector('img.preview') as HTMLImageElement).naturalWidth > 0);
  await shot(page, `step-3-${scheme}`);
  const id = page.url().split('/').pop()!;
  for (const t of themes) {
    if (t !== 'paper') {
      const r = await page.request.post(`${base}/api/posters/${id}/theme`, { data: { theme: t } });
      if (!r.ok()) throw new Error(`theme ${t}: ${r.status()}`);
    }
    const png = await page.request.get(`${base}/api/posters/${id}/poster.png?theme=${t}`);
    fs.writeFileSync(`${dir}/poster-${slug(topic)}-${t}.png`, await png.body());
  }
  await ctx.close();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log('saved', name);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

try {
  await flow('light', 'Organic chemistry', 'student', ['paper', 'sunrise']);
  await flow('dark', 'Spanish verbs', 'beginner', ['paper', 'midnight', 'sunrise']);
  // Third poster straight through the API, no screenshots.
  const ctx = await browser.newContext();
  const made = await ctx.request.post(`${base}/api/posters`, { data: { topic: 'SQL', level: 'student' } });
  const { id } = (await made.json()) as { id: string };
  for (let i = 0; i < 120; i++) {
    const s = (await (await ctx.request.get(`${base}/api/posters/${id}`)).json()) as { status: string };
    if (s.status === 'ready') break;
    if (s.status === 'failed' || s.status === 'refused') throw new Error('SQL poster ' + s.status);
    await new Promise((r) => setTimeout(r, 1000));
  }
  fs.writeFileSync(`${dir}/poster-sql-paper.png`, await (await ctx.request.get(`${base}/api/posters/${id}/poster.png?theme=paper`)).body());
  await ctx.close();
} finally {
  await browser.close();
}
