import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import type { PosterContent } from '../content.ts';
import type { Logger } from '../log.ts';
import type { FitResult, PosterRenderer, RenderResult } from './renderer.ts';
import { buildPosterHtml } from './template.ts';
import type { Theme } from './themes.ts';

const MM_TO_PX = 96 / 25.4;

class Semaphore {
  private waiting: Array<() => void> = [];
  private free: number;
  constructor(n: number) { this.free = n; }
  async acquire(): Promise<void> {
    if (this.free > 0) { this.free--; return; }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) next(); else this.free++;
  }
}

// Looks for a usable Chrome: CHROME_PATH, Playwright's own browser, a cached Playwright browser, or a system Chrome.
export function findChrome(configured = ''): string | null {
  const ok = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (configured) return ok(configured) ? configured : null;
  try { const p = chromium.executablePath(); if (ok(p)) return p; } catch { /* not installed */ }
  const cacheRoots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')].filter(Boolean) as string[];
  for (const base of cacheRoots) {
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse(); } catch { continue; }
    for (const d of dirs) {
      const candidates = [
        path.join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(base, d, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(base, d, 'chrome-linux64/chrome'),
        path.join(base, d, 'chrome-linux/chrome'),
      ];
      for (const c of candidates) if (ok(c)) return c;
    }
  }
  for (const c of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (ok(c)) return c;
  }
  return null;
}

export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

export interface ChromiumOptions {
  chromePath?: string;
  concurrency: number;
  widthMm: number;
  heightMm: number;
  // PNG sharpness. 1.5 gives about 2400 px wide for A2. Samples use a small value for thumbnails.
  pngScale?: number;
  log?: Logger;
}

export class ChromiumRenderer implements PosterRenderer {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private gate: Semaphore;
  // Requests the poster page tried to make. Should always stay 0.
  blockedRequests = 0;

  private opts: ChromiumOptions;

  constructor(opts: ChromiumOptions) {
    this.opts = opts;
    this.gate = new Semaphore(opts.concurrency);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    const executablePath = findChrome(this.opts.chromePath);
    if (!executablePath) throw new Error('No Chrome or Chromium found. Set CHROME_PATH, or run setup_service.sh.');
    this.launching = chromium
      .launch({ executablePath, args: [
        '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none',
        // Layer 1, in the browser itself: every connection goes to a dead proxy, loopback included, so nothing can leave.
        // Playwright's request blocking alone is not enough: navigator.sendBeacon slips past it.
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      ] })
      .then((b) => {
        this.browser = b;
        b.on('disconnected', () => { this.browser = null; });
        return b;
      })
      .finally(() => { this.launching = null; });
    return this.launching;
  }

  // Blocks every request that is not a data: URL. The poster page needs nothing from outside.
  private async newLockedContext(browser: Browser, js: boolean, deviceScaleFactor: number) {
    const wpx = Math.ceil(this.opts.widthMm * MM_TO_PX) + 2;
    const hpx = Math.ceil(this.opts.heightMm * MM_TO_PX) + 2;
    const ctx = await browser.newContext({ viewport: { width: wpx, height: hpx }, deviceScaleFactor, javaScriptEnabled: js, acceptDownloads: false });
    // Layer 2: offline mode. Layer 3: refuse every request that is not a data: URL. Layer 4: the page's own CSP.
    await ctx.setOffline(true);
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
      this.blockedRequests++;
      return route.abort();
    });
    return ctx;
  }

  async render(content: PosterContent, theme: Theme): Promise<RenderResult> {
    await this.gate.acquire();
    try {
      const browser = await this.getBrowser();
      const { widthMm, heightMm } = this.opts;
      const shrinks = [0.985, 0.955, 0.92, 0.88];
      let last: RenderResult | null = null;
      for (const shrink of shrinks) {
        // Step 1: page with our own fit script, scripts allowed, network blocked. Measures and takes the PNG.
        const a = await this.newLockedContext(browser, true, this.opts.pngScale ?? 1.5);
        let fit: FitResult;
        let png: Buffer;
        try {
          const page = await a.newPage();
          await page.setContent(buildPosterHtml(content, { theme, widthMm, heightMm, mode: 'measure', shrink }), { waitUntil: 'load' });
          await page.waitForFunction('window.__fit !== undefined', undefined, { timeout: 30_000 });
          fit = (await page.evaluate('window.__fit')) as FitResult;
          png = await page.locator('.poster').screenshot({ type: 'png' });
        } finally {
          await a.close();
        }
        // Step 2: the same poster with scripts switched off for good, saved as a vector PDF.
        const b = await this.newLockedContext(browser, false, 1);
        let pdf: Buffer;
        try {
          const page = await b.newPage();
          await page.setContent(buildPosterHtml(content, { theme, widthMm, heightMm, mode: 'final', scale: fit.scale, gap: fit.gap, tableFonts: fit.tableFonts }), { waitUntil: 'load' });
          await page.waitForTimeout(250);
          pdf = await page.pdf({ width: `${widthMm}mm`, height: `${heightMm}mm`, printBackground: true, preferCSSPageSize: true });
        } finally {
          await b.close();
        }
        const pages = countPdfPages(pdf);
        last = { pdf, png, fit, pages };
        if (!fit.fits || pages === 1) break;
        this.opts.log?.warn('poster spilled onto extra PDF pages, retrying a bit smaller', { pages, shrink });
      }
      return last!;
    } finally {
      this.gate.release();
    }
  }

  // For tests: load raw HTML in the same locked context the measure step uses (scripts on, network blocked)
  // and report how many outside requests were stopped.
  async probeLocked(html: string): Promise<{ blocked: number }> {
    await this.gate.acquire();
    try {
      const browser = await this.getBrowser();
      const before = this.blockedRequests;
      const ctx = await this.newLockedContext(browser, true, 1);
      try {
        const page = await ctx.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForTimeout(500);
      } finally {
        await ctx.close();
      }
      return { blocked: this.blockedRequests - before };
    } finally {
      this.gate.release();
    }
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => undefined);
  }
}
