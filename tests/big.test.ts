import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeProvider } from '../src/ai/fake.ts';
import { OutputCutOff } from '../src/ai/provider.ts';
import { MSG_BAD_CONTENT } from '../src/jobs.ts';
import { StubRenderer } from '../src/render/stub.ts';
import { azureFailingShape } from './fixtures/big-posters.ts';
import { getJson, post, startTestServer, waitDone } from './helpers.ts';

// Big topics, with the fake provider and the stub renderer. The real layout of big posters is covered in
// render.e2e.test.ts with a real Chrome.

const make = (s: Awaited<ReturnType<typeof startTestServer>>, topic: string) => post(s.base, '/api/posters', { topic });

for (const topic of ['the whole Python standard library', 'all of organic chemistry']) {
  test(`big topic "${topic}": an over-limit answer is repaired and becomes a poster on the first try`, async () => {
    const s = await startTestServer();
    try {
      const d = await waitDone(s, (await make(s, topic)).data.id);
      assert.equal(d.status, 'ready', d.message);
      assert.equal(s.provider.calls.write, 1, 'no retry was needed');
      assert.equal(s.provider.calls.shorten, 0);
      assert.ok(s.lines.some((l) => l.includes('repaired poster content')), 'the repair was logged');
      assert.ok(!s.lines.some((l) => l.includes('written poster was invalid')));
      assert.ok(!s.lines.some((l) => l.includes('review result unusable')), 'the review output is repaired too');
      const stored = JSON.parse(s.store.getPoster(d.id)!.content!);
      assert.equal(stored.sections.length, 24);
    } finally { await s.close(); }
  });
}

test('the failing live shape, sent by the AI as it was, makes a poster without a retry', async () => {
  for (const over of [false, true]) {
    const p = new FakeProvider();
    p.writePoster = async () => ({ value: azureFailingShape({ over }), usage: { inputTokens: 900, outputTokens: 6000 } });
    const s = await startTestServer({}, { provider: p });
    try {
      const d = await waitDone(s, (await make(s, 'Python standard library')).data.id);
      assert.equal(d.status, 'ready', `over=${over}: ${d.message}`);
    } finally { await s.close(); }
  }
});

test('one retry at most, and it is told the exact problems', async () => {
  const p = new FakeProvider();
  p.invalidFirst = 1;
  const s = await startTestServer({}, { provider: p });
  try {
    const d = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(d.status, 'ready');
    assert.equal(p.calls.write, 2);
    assert.match(p.lastProblems ?? '', /subtitle|sections/, 'the retry got the validation errors');
    p.invalidFirst = 5;
    const bad = await waitDone(s, (await make(s, 'SQL again')).data.id);
    assert.equal(bad.status, 'failed');
    assert.equal(bad.message, MSG_BAD_CONTENT);
    assert.equal(p.calls.write, 4, 'two calls for the second poster, never more');
  } finally { await s.close(); }
});

test('an answer cut off at the output limit is retried once and its tokens still count', async () => {
  const p = new FakeProvider();
  const real = p.writePoster.bind(p);
  let first = true;
  p.writePoster = async (topic, level, problems) => {
    if (first) { first = false; throw new OutputCutOff({ inputTokens: 1000, outputTokens: 32000 }); }
    return real(topic, level, problems);
  };
  const s = await startTestServer({}, { provider: p });
  try {
    const d = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(d.status, 'ready');
    assert.match(p.lastProblems ?? '', /cut off/);
    const row = s.store.getPoster(d.id)!;
    assert.ok(row.output_tokens >= 32000, `output tokens ${row.output_tokens}`);
    assert.ok(s.store.dayUsage(s.clock.now).tokens >= 33000);
  } finally { await s.close(); }
});

test('a poster that grew to a bigger sheet says so, and a theme switch redraws it on the same sheet', async () => {
  const r = new StubRenderer();
  r.sheetIndex = 2;
  const s = await startTestServer({}, { renderer: r });
  try {
    const d = await waitDone(s, (await make(s, 'the whole Python standard library')).data.id);
    assert.equal(d.status, 'ready');
    assert.equal(d.size, 'A1');
    assert.equal(s.store.getPoster(d.id)!.sheet, '594x841c4');
    const sw = await post(s.base, `/api/posters/${d.id}/theme`, { theme: 'midnight' });
    assert.equal(sw.status, 200);
    assert.equal(r.lastOptions?.sheet, '594x841c4');
    assert.equal((await getJson(s.base, `/api/posters/${d.id}`)).data.size, 'A1');
  } finally { await s.close(); }
});

test('a normal poster stays on A2', async () => {
  const s = await startTestServer();
  try {
    const d = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(d.size, 'A2');
  } finally { await s.close(); }
});
