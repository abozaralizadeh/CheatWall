import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sqlPoster, orgChemPoster } from '../src/ai/fake-data.ts';
import type { PosterContent } from '../src/content.ts';
import { getTheme } from '../src/render/themes.ts';
import { AI_NOTE, buildPosterHtml } from '../src/render/template.ts';

const theme = getTheme('paper')!;
const opts = { theme, widthMm: 420, heightMm: 594 };

const HOSTILE = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE posters; --",
  '<style>body{display:none}</style>',
  '</section><script>fetch("http://evil.test")</script>',
  '<iframe src="http://evil.test"></iframe>',
];

function hostile(): PosterContent {
  const c = structuredClone(sqlPoster);
  c.title = HOSTILE[0]!;
  c.subtitle = HOSTILE[1]!;
  c.note = HOSTILE[2];
  for (const [i, s] of c.sections.entries()) {
    s.heading = HOSTILE[i % HOSTILE.length]!;
    if (s.kind === 'points' || s.kind === 'steps') s.items = s.items.map((_, j) => HOSTILE[(i + j) % HOSTILE.length]!);
    if (s.kind === 'definitions') s.items = s.items.map((_, j) => ({ term: HOSTILE[j % HOSTILE.length]!, meaning: HOSTILE[(j + 1) % HOSTILE.length]! }));
    if (s.kind === 'table') { s.columns = s.columns.map((_, j) => HOSTILE[j]!); s.rows = s.rows.map((r) => r.map((_, j) => HOSTILE[j + 2]!)); }
    if (s.kind === 'code') { s.code = HOSTILE[4]!; s.language = HOSTILE[1]!; }
  }
  return c;
}

test('hostile text from the AI is escaped everywhere', () => {
  const html = buildPosterHtml(hostile(), { ...opts, mode: 'final', scale: 1, gap: 1 });
  assert.ok(!html.includes('<script'), 'final render must contain no script tag at all');
  assert.ok(!/<img/i.test(html), 'no img tags');
  assert.ok(!/<iframe/i.test(html));
  assert.ok(html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'attribute payload shows up only as inert text');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<style>body{display:none}'));
});

test('measure mode has exactly one script, ours, and never one from content', () => {
  const html = buildPosterHtml(hostile(), { ...opts, mode: 'measure' });
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.ok(!html.includes('alert(1)</script>'));
});

test('every page carries a CSP that allows no network', () => {
  for (const mode of ['measure', 'final'] as const) {
    const html = buildPosterHtml(sqlPoster, { ...opts, mode });
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    assert.ok(csp.includes("default-src 'none'"));
    assert.ok(!/https?:/.test(csp));
    assert.equal(csp.includes('script-src'), mode === 'measure');
  }
});

test('final mode bakes in the scale and gap', () => {
  const html = buildPosterHtml(sqlPoster, { ...opts, mode: 'final', scale: 1.234, gap: 2.5 });
  assert.ok(html.includes('--s:1.234'));
  assert.ok(html.includes('--gap:2.5em'));
});

test('the AI note is always on the poster and cannot be removed by content', () => {
  const c = structuredClone(sqlPoster);
  c.note = undefined;
  assert.ok(buildPosterHtml(c, { ...opts, mode: 'final' }).includes(AI_NOTE));
  assert.ok(buildPosterHtml({ ...c, note: 'Extra care note.' }, { ...opts, mode: 'final' }).includes('Extra care note.'));
});

test('formulas render through KaTeX, and bad LaTeX falls back to plain text', () => {
  const html = buildPosterHtml(orgChemPoster, { ...opts, mode: 'final' });
  assert.ok(html.includes('class="katex'));
  const c = structuredClone(orgChemPoster);
  const f = c.sections.find((s) => s.kind === 'formulas')!;
  if (f.kind === 'formulas') f.items = [{ latex: '\\href{http://evil.test}{x} \\badcommand{', caption: 'bad' }];
  const bad = buildPosterHtml(c, { ...opts, mode: 'final' });
  assert.ok(!bad.includes('href="http://evil.test"'), 'KaTeX must not make links');
});

test('inlined assets contain no external URLs the page could fetch', () => {
  const html = buildPosterHtml(orgChemPoster, { ...opts, mode: 'final' });
  assert.ok(!/url\(\s*['"]?https?:/i.test(html));
  assert.ok(!/@import/i.test(html));
  assert.ok(!/<link\b/i.test(html));
});
