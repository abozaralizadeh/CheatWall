import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bigPoster, sqlPoster } from '../src/ai/fake-data.ts';
import { clampText, LIMITS, parsePoster, repairPoster, type PosterContent } from '../src/content.ts';
import { azureFailingShape } from './fixtures/big-posters.ts';

function repaired(raw: unknown): PosterContent {
  const r = parsePoster(repairPoster(raw).value);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  return (r as { ok: true; value: PosterContent }).value;
}

test('the shape that failed on the live server (6 columns, 120 character cells) is now valid as it is', () => {
  const raw = azureFailingShape();
  assert.equal(parsePoster(raw).ok, true);
  assert.deepEqual(repairPoster(raw).fixes, [], 'nothing needs fixing');
});

test('a poster past every limit is repaired instead of thrown away', () => {
  const raw = azureFailingShape({ over: true });
  assert.equal(parsePoster(raw).ok, false, 'the raw answer is over the limits');
  const { fixes } = repairPoster(raw);
  assert.ok(fixes.some((f) => f.includes('columns split')), fixes.join('\n'));
  assert.ok(fixes.some((f) => f.includes('cut to 140')), fixes.join('\n'));
  const p = repaired(raw);
  for (const s of p.sections) {
    if (s.kind !== 'table') continue;
    assert.ok(s.columns.length <= LIMITS.columns.max);
    for (const row of s.rows) {
      assert.equal(row.length, s.columns.length);
      for (const c of row) assert.ok([...c].length <= LIMITS.cell, `cell of ${c.length}`);
    }
  }
});

test('a wide table is split into two tables that both keep the first column, so no column is lost', () => {
  const p = repaired(azureFailingShape({ over: true }));
  const parts = p.sections.filter((s) => s.kind === 'table' && s.heading.startsWith('Modules at a glance'));
  assert.equal(parts.length, 2);
  const cols = parts.flatMap((s) => (s.kind === 'table' ? s.columns : []));
  assert.deepEqual(cols.filter((c) => c === 'Module').length, 2, 'the key column is in both parts');
  for (const name of ['Area', 'Main use', 'Key call', 'Returns', 'Since', 'Notes', 'See also']) assert.ok(cols.includes(name), name);
  assert.equal(parts[1]!.heading, 'Modules at a glance (2)');
});

test('long lists continue in a second section, too many sections are capped', () => {
  const p = repaired(azureFailingShape({ over: true }));
  const first = p.sections.filter((s) => s.heading.startsWith('How to read this poster'));
  assert.equal(first.length, 2);
  assert.equal(first.reduce((n, s) => n + (s.kind === 'points' ? s.items.length : 0), 0), 20, 'every bullet kept');
  const big = repaired(bigPoster('the whole Python standard library', null));
  assert.equal(big.sections.length, LIMITS.sections.max);
});

test('long text is cut at a word with an ellipsis, never mid-word when a space is near', () => {
  const t = clampText('alpha beta gamma delta epsilon zeta eta theta', 20);
  assert.ok([...t].length <= 20, t);
  assert.ok(t.endsWith('…'));
  assert.match(t, /^alpha beta gamma…$/);
  assert.equal(clampText('short', 20), 'short');
  assert.equal([...clampText('x'.repeat(300), 140)].length, 140);
});

test('rows are padded or trimmed to the columns, empty rows and broken sections are dropped', () => {
  const raw = structuredClone(sqlPoster) as any;
  raw.sections.push({ kind: 'table', heading: 'Ragged', columns: ['A', 'B', 'C'], rows: [['1'], ['1', '2', '3', '4'], ['', ''], 'junk'] });
  raw.sections.push({ kind: 'mystery', heading: 'What is this' }, 'not a section', { kind: 'points', items: ['no heading'] });
  const p = repaired(raw);
  const t = p.sections.find((s) => s.heading === 'Ragged');
  assert.ok(t && t.kind === 'table');
  assert.equal(t.columns.length, 4, 'the widest row decides the columns');
  assert.deepEqual(t.rows, [['1', '', '', ''], ['1', '2', '3', '4']]);
  assert.ok(!p.sections.some((s) => s.heading === 'What is this'));
});

test('code over the line limit is cut by whole lines, a formula that is too long is dropped, not cut', () => {
  const raw = structuredClone(sqlPoster) as any;
  raw.sections.push({ kind: 'code', heading: 'Long code', language: 'sql', code: Array.from({ length: 40 }, (_, i) => `SELECT ${i};`).join('\n') });
  raw.sections.push({ kind: 'formulas', heading: 'Maths', items: [{ latex: 'x^2', caption: 'Square' }, { latex: 'x+'.repeat(100), caption: 'Too long' }] });
  const p = repaired(raw);
  const c = p.sections.find((s) => s.heading === 'Long code');
  assert.ok(c && c.kind === 'code');
  assert.equal(c.code.split('\n').length, LIMITS.codeLines);
  assert.equal(c.code.split('\n').at(-1), `SELECT ${LIMITS.codeLines - 1};`);
  const f = p.sections.find((s) => s.heading === 'Maths');
  assert.ok(f && f.kind === 'formulas');
  assert.deepEqual(f.items.map((i) => i.caption), ['Square']);
});

test('what cannot be repaired stays invalid, so the pipeline retries: no title, too few sections, not an object', () => {
  assert.equal(parsePoster(repairPoster({ subtitle: 'x', sections: sqlPoster.sections }).value).ok, false);
  assert.equal(parsePoster(repairPoster({ title: 'x', subtitle: 'y', sections: sqlPoster.sections.slice(0, 2) }).value).ok, false);
  assert.equal(parsePoster(repairPoster('nope').value).ok, false);
  assert.equal(parsePoster(repairPoster(null).value).ok, false);
});

test('repair leaves a valid poster exactly as it was', () => {
  const r = repairPoster(structuredClone(sqlPoster));
  assert.deepEqual(r.fixes, []);
  assert.deepEqual(parsePoster(r.value), parsePoster(sqlPoster));
});
