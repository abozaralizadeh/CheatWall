import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orgChemPoster, spanishPoster, sqlPoster, genericPoster } from '../src/ai/fake-data.ts';
import { isPosterId, newPosterId, normalizeLevel, normalizeTopic, parsePoster, slugify } from '../src/content.ts';

test('sample posters pass the content schema', () => {
  for (const p of [sqlPoster, spanishPoster, orgChemPoster, genericPoster('Anything at all', 'student')]) {
    const r = parsePoster(p);
    assert.equal(r.ok, true, r.ok ? '' : r.error);
  }
});

test('schema rejects a table row with the wrong number of cells', () => {
  const bad = structuredClone(sqlPoster);
  const t = bad.sections.find((s) => s.kind === 'table')!;
  if (t.kind === 'table') t.rows[0] = ['only one'];
  assert.equal(parsePoster(bad).ok, false);
});

test('schema rejects too few sections, empty text and long code', () => {
  assert.equal(parsePoster({ title: 'x', subtitle: 'y', sections: [] }).ok, false);
  assert.equal(parsePoster({ ...sqlPoster, title: '   ' }).ok, false);
  const long = structuredClone(sqlPoster);
  const c = long.sections.find((s) => s.kind === 'code')!;
  if (c.kind === 'code') c.code = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
  assert.equal(parsePoster(long).ok, false);
  assert.equal(parsePoster('not an object').ok, false);
  assert.equal(parsePoster(null).ok, false);
});

test('topic: trims, collapses spaces, keeps other languages', () => {
  assert.deepEqual(normalizeTopic('  SQL   joins  '), { ok: true, value: 'SQL joins' });
  assert.deepEqual(normalizeTopic('日本語の動詞'), { ok: true, value: '日本語の動詞' });
  assert.deepEqual(normalizeTopic('Español: verbos'), { ok: true, value: 'Español: verbos' });
});

test('topic: rejects empty, short, long, non-string and hidden characters', () => {
  assert.equal(normalizeTopic('').ok, false);
  assert.equal(normalizeTopic('a').ok, false);
  assert.equal(normalizeTopic('x'.repeat(121)).ok, false);
  assert.equal(normalizeTopic('x'.repeat(120)).ok, true);
  assert.equal(normalizeTopic(42).ok, false);
  assert.equal(normalizeTopic(null).ok, false);
  assert.equal(normalizeTopic('sql\u0000drop').ok, false);
  assert.equal(normalizeTopic('sql\u202ejoin').ok, false);
  assert.equal(normalizeTopic('sql\u200bjoin').ok, false);
});

test('level: accepts the three levels and empty, rejects the rest', () => {
  assert.deepEqual(normalizeLevel('student'), { ok: true, value: 'student' });
  assert.deepEqual(normalizeLevel(''), { ok: true, value: null });
  assert.deepEqual(normalizeLevel(undefined), { ok: true, value: null });
  assert.equal(normalizeLevel('expert').ok, false);
  assert.equal(normalizeLevel(5).ok, false);
});

test('poster ids are 22 url-safe characters and unique', () => {
  const ids = new Set(Array.from({ length: 500 }, newPosterId));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.equal(isPosterId(id), true);
  assert.equal(isPosterId('short'), false);
  assert.equal(isPosterId('../../etc/passwd/aaaaaaa'), false);
  assert.equal(isPosterId(undefined), false);
});

test('slugify makes safe file names', () => {
  assert.equal(slugify('Español: verbos!'), 'espanol-verbos');
  assert.equal(slugify('../../etc'), 'etc');
  assert.equal(slugify('???'), 'poster');
  assert.ok(slugify('x'.repeat(200)).length <= 40);
});
