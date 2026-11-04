import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { after, test } from 'node:test';
import { bigPoster, genericPoster, orgChemPoster, sqlPoster } from '../src/ai/fake-data.ts';
import { parsePoster, repairPoster, type PosterContent } from '../src/content.ts';
import { azureFailingShape } from './fixtures/big-posters.ts';
import { ChromiumRenderer, countPdfPages, findChrome } from '../src/render/chromium.ts';
import { getTheme } from '../src/render/themes.ts';

// These use a real Chrome. They are skipped when none is installed.
const chrome = findChrome();
const skip = chrome ? false : 'no Chrome or Chromium found';
const renderer = new ChromiumRenderer({ chromePath: chrome ?? undefined, concurrency: 2, widthMm: 420, heightMm: 594 });
// The same renderer without the bigger sheets, for tests about fitting one fixed page.
const fixed = new ChromiumRenderer({ chromePath: chrome ?? undefined, concurrency: 1, widthMm: 420, heightMm: 594, growSteps: 0 });
after(async () => { await renderer.close(); await fixed.close(); });

const paper = getTheme('paper')!;

function pngSize(png: Buffer): { w: number; h: number } {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

test('A2 poster: one PDF page, fits, fills the page, PNG has the right shape', { skip }, async () => {
  const r = await renderer.render(sqlPoster, paper);
  assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(r.pages, 1);
  assert.equal(countPdfPages(r.pdf), 1);
  assert.equal(r.fit.fits, true);
  assert.ok(r.fit.fill > 0.85, `page fill ${r.fit.fill}`);
  assert.ok(r.fit.scale >= 0.6 && r.fit.scale <= 1.7);
  const { w, h } = pngSize(r.png);
  assert.ok(Math.abs(h / w - 594 / 420) < 0.01, `PNG ratio ${h / w}`);
  assert.ok(w >= 2000, `PNG width ${w}`);
});

test('PDF page size is A2 and text stays real text with fonts embedded', { skip }, async () => {
  const r = await renderer.render(sqlPoster, paper);
  const text = r.pdf.toString('latin1');
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text)!;
  assert.ok(Math.abs(Number(box[1]) - 1190.55) < 2 && Math.abs(Number(box[2]) - 1683.78) < 2, `MediaBox ${box[1]} x ${box[2]}`);
  assert.match(text, /Inter/, 'Inter is embedded');
  assert.match(text, /JetBrains/, 'mono font is embedded for code blocks');
  assert.ok(r.pdf.length < 3_000_000, `PDF size ${r.pdf.length}`);
});

test('formulas render with KaTeX fonts embedded', { skip }, async () => {
  const r = await renderer.render(orgChemPoster, paper);
  assert.equal(r.pages, 1);
  assert.match(r.pdf.toString('latin1'), /KaTeX/);
});

test('different themes give different pictures with the same layout', { skip }, async () => {
  const a = await renderer.render(sqlPoster, paper);
  const b = await renderer.render(sqlPoster, getTheme('midnight')!);
  assert.notDeepEqual(a.png, b.png);
  assert.equal(a.fit.scale.toFixed(3), b.fit.scale.toFixed(3), 'a theme only changes colours, so the fit is the same');
  assert.equal(a.pages, 1);
  assert.equal(b.pages, 1);
});

test('very long content shrinks to fit, and impossible content is reported, never silently cut', { skip }, async () => {
  const long = genericPoster('long', null);
  for (const s of long.sections) {
    if (s.kind === 'points' || s.kind === 'steps') { while (s.items.length < 10) s.items.push('An extra line that makes this section longer than the others on the poster.'); }
  }
  const r = await fixed.render(long, paper);
  assert.ok(r.fit.fits ? r.pages === 1 : r.fit.overflow > 1);
  const small = await fixed.render(sqlPoster, paper);
  assert.ok(r.fit.scale <= small.fit.scale + 0.01, 'more text means smaller or equal text');

  const huge: PosterContent = { title: 'Huge', subtitle: 'Far too much', sections: Array.from({ length: 12 }, (_, i) => ({ kind: 'points' as const, heading: `Section ${i}`, items: Array.from({ length: 10 }, () => 'x'.repeat(170)) })) };
  const h = await fixed.render(huge, paper);
  assert.equal(h.fit.fits, false);
  assert.ok(h.fit.overflow > 1.2, `overflow ${h.fit.overflow}`);
  assert.ok(h.fit.scale <= 0.61, 'tried the smallest size first');
});

test('normal and fairly short content fills the page, very thin content is still valid and reports how empty it is', { skip }, async () => {
  const mk = (secs: number, items: number): PosterContent => ({
    title: 'Short', subtitle: 'Only a little text',
    sections: Array.from({ length: secs }, (_, i) => ({ kind: 'points' as const, heading: `Part ${i}`, items: Array.from({ length: items }, () => 'A normal bullet line with about this much text in it.') })),
  });
  const normal = await renderer.render(mk(8, 3), paper);
  assert.equal(normal.pages, 1);
  assert.ok(normal.fit.fits && normal.fit.fill > 0.9, `normal fill ${normal.fit.fill}`);
  const fewer = await renderer.render(mk(6, 3), paper);
  assert.ok(fewer.fit.fits && fewer.fit.fill > 0.7, `fairly short fill ${fewer.fit.fill}`);
  assert.ok(fewer.fit.gap > normal.fit.gap, 'gaps grow to take up the space');
  // Known limit: text size and gaps are capped, so very thin content leaves white space. It must say so.
  const thin = await renderer.render(mk(4, 2), paper);
  assert.equal(thin.pages, 1);
  assert.ok(thin.fit.fits);
  assert.ok(thin.fit.fill < 0.7, `thin fill ${thin.fit.fill}`);
});

test('wide tables never spill out of their card: text shrinks first, then long words may break', { skip }, async () => {
  // Regression: the four-column Spanish table used to run over the next column and still count as "fits".
  const { spanishPoster } = await import('../src/ai/fake-data.ts');
  const ok = await renderer.render(spanishPoster, paper);
  assert.ok(ok.fit.fits, 'the Spanish poster fits');
  assert.equal(ok.pages, 1);
  const wideTable: PosterContent = {
    title: 'Wide', subtitle: 'A table that cannot fit',
    sections: [
      { kind: 'table', heading: 'Wide', columns: ['A', 'B', 'C', 'D'], rows: [['x'.repeat(40), 'y'.repeat(40), 'z'.repeat(40), 'w'.repeat(40)]] },
      ...[1, 2, 3].map((i) => ({ kind: 'points' as const, heading: `P${i}`, items: ['one', 'two'] })),
    ],
  };
  const wrapped = await fixed.render(wideTable, paper);
  assert.equal(wrapped.fit.fits, true, 'the table fits once long words may break');
  assert.deepEqual(wrapped.fit.tableWrap, [true]);
  assert.equal(wrapped.pages, 1);
  assert.equal(ok.fit.tableWrap.some(Boolean), false, 'normal tables never break inside words');
});

const repaired = (raw: unknown): PosterContent => {
  const p = parsePoster(repairPoster(raw).value);
  if (!p.ok) throw new Error(p.error);
  return p.value;
};
const mediaBox = (pdf: Buffer) => {
  const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'))!;
  return { wMm: (Number(m[1]) / 72) * 25.4, hMm: (Number(m[2]) / 72) * 25.4 };
};

test('the shape that failed live (6 columns, 120 character cells) grows to a bigger sheet and fits on one page', { skip }, async () => {
  for (const over of [false, true]) {
    const r = await renderer.render(repaired(azureFailingShape({ over })), paper);
    assert.equal(r.fit.fits, true, `over=${over}`);
    assert.equal(r.pages, 1);
    assert.ok(r.sheet.widthMm > 420 || r.sheet.columns > 3, `grew from A2 3 columns, got ${r.sheet.id}`);
    const box = mediaBox(r.pdf);
    assert.ok(Math.abs(box.wMm - r.sheet.widthMm) < 1 && Math.abs(box.hMm - r.sheet.heightMm) < 1, `PDF is ${box.wMm} x ${box.hMm} mm`);
  }
});

test('a whole-field topic ends up on A0, one page, readable text, PNG kept to a sane size', { skip }, async () => {
  const r = await renderer.render(repaired(bigPoster('the whole Python standard library', null)), paper);
  assert.equal(r.fit.fits, true);
  assert.equal(r.pages, 1);
  assert.equal(r.sheet.label, 'A0');
  assert.ok(r.fit.scale >= r.sheet.minScale - 0.001, `scale ${r.fit.scale}`);
  const { w, h } = pngSize(r.png);
  assert.ok(w >= 2000 && w <= 2600, `PNG width ${w}`);
  assert.ok(Math.abs(h / w - 1189 / 841) < 0.01);
  // A theme switch redraws on the same sheet without searching again.
  const again = await renderer.render(repaired(bigPoster('the whole Python standard library', null)), getTheme('midnight')!, { sheet: r.sheet.id });
  assert.equal(again.sheet.id, r.sheet.id);
  assert.equal(again.pages, 1);
});

test('a normal poster stays on A2 with 3 columns', { skip }, async () => {
  const r = await renderer.render(sqlPoster, paper);
  assert.equal(r.sheet.id, '420x594c3');
  assert.equal(r.sheet.label, 'A2');
});

test('only content too big for the biggest sheet is reported as not fitting', { skip }, async () => {
  const huge: PosterContent = { title: 'Huge', subtitle: 'Far too much', sections: Array.from({ length: 24 }, (_, i) => ({ kind: 'points' as const, heading: `Section ${i}`, items: Array.from({ length: 60 }, () => 'word '.repeat(44).trim()) })) };
  const r = await renderer.render(huge, paper);
  assert.equal(r.fit.fits, false);
  assert.equal(r.sheet.id, renderer.ladder.at(-1)!.id, 'every sheet was tried');
  assert.ok(r.fit.overflow > 1);
});

test('hostile content cannot make the renderer call out', { skip }, async () => {
  let hits = 0;
  const canary = http.createServer((_req, res) => { hits++; res.end('x'); });
  await new Promise<void>((r) => canary.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(canary.address() as { port: number }).port}/leak`;
  try {
    const c = structuredClone(sqlPoster);
    c.title = `<img src="${url}/a">`;
    c.subtitle = `<link rel=stylesheet href="${url}/b">`;
    for (const s of c.sections) s.heading = `<script>fetch("${url}/c")</script><iframe src="${url}/d"></iframe>`;
    const before = renderer.blockedRequests;
    const r = await renderer.render(c, paper);
    assert.equal(r.pages, 1);
    assert.equal(hits, 0, 'nothing reached the canary server');
    assert.equal(renderer.blockedRequests - before, 0, 'the page did not even try, because the text was escaped');
    assert.ok(r.pdf.toString('latin1').length > 1000);
  } finally {
    canary.close();
  }
});

test('even if escaping failed, the locked browser context blocks every outside request', { skip }, async () => {
  let hits = 0;
  const canary = http.createServer((_req, res) => { hits++; res.end('x'); });
  await new Promise<void>((r) => canary.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(canary.address() as { port: number }).port}`;
  try {
    const html = `<!doctype html><html><body>
      <img src="${url}/img"><link rel=stylesheet href="${url}/css"><script src="${url}/js"></script>
      <script>fetch("${url}/fetch").catch(()=>{});var x=new XMLHttpRequest();x.open("GET","${url}/xhr");x.send();navigator.sendBeacon&&navigator.sendBeacon("${url}/beacon","x");</script>
      <iframe src="${url}/frame"></iframe></body></html>`;
    // The leak this guards against (sendBeacon) only showed up in some runs, so repeat.
    for (let i = 0; i < 6; i++) {
      const r = await renderer.probeLocked(html);
      assert.ok(r.blocked >= 4, `blocked ${r.blocked}`);
    }
    assert.equal(hits, 0, 'nothing reached the canary server in any run');
  } finally {
    canary.close();
  }
});

test('the final PDF render has scripts off', { skip }, async () => {
  const { buildPosterHtml } = await import('../src/render/template.ts');
  const html = buildPosterHtml(sqlPoster, { theme: paper, widthMm: 420, heightMm: 594, mode: 'final', scale: 1, gap: 1 });
  assert.equal(html.includes('<script'), false);
  assert.ok(fs.existsSync('src/render/chromium.ts'));
});

test('six renders at once all finish (concurrency gate works)', { skip }, async () => {
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => renderer.render(genericPoster('Topic ' + i, null), paper)));
  for (const r of results) assert.equal(r.pages, 1);
});
