import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, getTheme, THEMES } from '../src/render/themes.ts';

// WCAG AA: 4.5 for normal text.
test('every theme has readable text on every background it is used on', () => {
  for (const t of THEMES) {
    const v = t.vars;
    const pairs: Array<[string, string, string]> = [
      ['ink on page', v.ink, v.bg], ['ink on card', v.ink, v.card], ['ink on stripe', v.ink, v.stripe],
      ['muted on page', v.muted, v.bg], ['muted on card', v.muted, v.card],
      ['header text on header', v.headInk, v.headBg], ['code text on code block', v.codeInk, v.codeBg],
      ['step number on c0', v.onAccent, v.c0], ['step number on c1', v.onAccent, v.c1], ['step number on c2', v.onAccent, v.c2], ['step number on c3', v.onAccent, v.c3],
    ];
    for (const [name, fg, bg] of pairs) {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= 4.5, `${t.id}: ${name} is ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  }
});

test('contrast helper matches known values', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrast('#777777', '#777777') - 1) < 0.01);
});

test('theme ids are unique and safe for file names', () => {
  const ids = THEMES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  assert.equal(getTheme('nope'), undefined);
});
