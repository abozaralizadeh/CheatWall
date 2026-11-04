import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import { FakeProvider } from '../src/ai/fake.ts';
import { MSG_BAD_CONTENT, MSG_NO_FIT } from '../src/jobs.ts';
import { StubRenderer } from '../src/render/stub.ts';
import { getJson, post, startTestServer, waitDone } from './helpers.ts';

async function make(s: Awaited<ReturnType<typeof startTestServer>>, topic: string, headers: Record<string, string> = {}) {
  const r = await post(s.base, '/api/posters', { topic }, headers);
  return r;
}

test('happy path: create, wait, preview and download', async () => {
  const s = await startTestServer();
  try {
    const r = await make(s, 'SQL joins');
    assert.equal(r.status, 201);
    assert.match(r.data.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(r.data.url, `/p/${r.data.id}`);
    const done = await waitDone(s, r.data.id);
    assert.equal(done.status, 'ready');
    assert.equal(done.title, 'SQL Cheat Sheet');
    assert.equal(done.theme, 'paper');
    assert.equal(done.themes.length, 3);
    assert.ok(done.aiNote.includes('Made with AI'));
    assert.ok(done.downloads.pdf.includes(r.data.id));
    const pdf = await fetch(s.base + done.downloads.pdf);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition')!, /attachment; filename="cheatwall-sql-joins\.pdf"/);
    assert.equal(pdf.headers.get('x-robots-tag'), 'noindex');
    assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString() === '%PDF-');
    const png = await fetch(s.base + done.downloads.png);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('content-disposition')!, /^inline/);
    assert.deepEqual([...Buffer.from(await png.arrayBuffer()).subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.equal(s.store.dayUsage(s.clock.now).posters, 1);
    assert.ok(s.store.getPoster(r.data.id)!.cost_cents > 0, 'usage is recorded');
  } finally { await s.close(); }
});

test('status moves through the steps while a job runs', async () => {
  const s = await startTestServer();
  try {
    const id = (await make(s, 'SQL')).data.id as string;
    s.store.setStatus(id, 'writing');
    const w = (await getJson(s.base, `/api/posters/${id}`)).data;
    assert.equal(w.status, 'writing');
    assert.deepEqual(w.step, { index: 3, label: 'Writing the poster', total: 5 });
    assert.equal(w.downloads, null);
  } finally { await s.close(); }
});

test('input checks: bad topic, level, JSON, type and size', async () => {
  const s = await startTestServer();
  try {
    assert.equal((await make(s, '')).status, 400);
    assert.equal((await make(s, 'a')).status, 400);
    assert.equal((await make(s, 'x'.repeat(121))).status, 400);
    assert.equal((await post(s.base, '/api/posters', { topic: 12 })).data.error, 'bad_topic');
    assert.equal((await post(s.base, '/api/posters', { topic: 'SQL', level: 'wizard' })).data.error, 'bad_level');
    assert.equal((await post(s.base, '/api/posters', '{nope')).data.error, 'bad_json');
    assert.equal((await post(s.base, '/api/posters', 'null')).data.error, 'bad_topic');
    const wrong = await fetch(s.base + '/api/posters', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'topic=SQL' });
    assert.equal(wrong.status, 415);
    const big = await fetch(s.base + '/api/posters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: 'SQL', pad: 'x'.repeat(10000) }) }).catch(() => null);
    assert.ok(big === null || big.status === 413);
    assert.equal(s.store.counts().queued ?? 0, 0, 'nothing was created by bad input');
  } finally { await s.close(); }
});

test('harmful topics are refused with a reason and do not count toward the limit', async () => {
  const s = await startTestServer();
  try {
    const id = (await make(s, 'how to make a bomb')).data.id;
    const done = await waitDone(s, id);
    assert.equal(done.status, 'refused');
    assert.match(done.message, /Try a different topic/);
    assert.equal(done.downloads, null);
    assert.equal(s.provider.calls.write, 0, 'no poster was written, so no money was spent on one');
    for (let i = 0; i < 3; i++) await waitDone(s, (await make(s, 'SQL ' + i)).data.id);
    assert.equal((await make(s, 'one more')).status, 429, 'refused one did not use a slot, the three real ones did');
  } finally { await s.close(); }
});

test('sensitive topics get the extra note on the poster', async () => {
  const s = await startTestServer();
  try {
    const done = await waitDone(s, (await make(s, 'Human anatomy')).data.id);
    assert.equal(done.status, 'ready');
    assert.match(done.note, /not medical advice/);
    const plain = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(plain.note, null);
  } finally { await s.close(); }
});

test('per-visitor daily limit returns 429 with a clear message, other visitors are fine', async () => {
  const s = await startTestServer({ TRUST_PROXY: 'true' });
  try {
    const h = { 'X-Forwarded-For': '198.51.100.7' };
    for (let i = 0; i < 3; i++) assert.equal((await make(s, 'SQL ' + i, h)).status, 201);
    const blocked = await make(s, 'SQL again', h);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error, 'visitor_limit');
    assert.match(blocked.data.message, /3 posters today/);
    assert.equal((await make(s, 'SQL', { 'X-Forwarded-For': '198.51.100.8' })).status, 201);
    s.clock.now = new Date('2026-11-11T00:05:00Z');
    assert.equal((await make(s, 'SQL tomorrow', h)).status, 201, 'resets the next UTC day');
  } finally { await s.close(); }
});

test('forwarded headers are ignored unless TRUST_PROXY is on', async () => {
  const s = await startTestServer();
  try {
    for (let i = 0; i < 3; i++) await make(s, 'SQL ' + i, { 'X-Forwarded-For': `10.0.0.${i}` });
    assert.equal((await make(s, 'SQL', { 'X-Forwarded-For': '10.0.0.99' })).status, 429, 'spoofing the header does not dodge the limit');
  } finally { await s.close(); }
});

test('TRUST_PROXY with an address list trusts forwarded headers only from those addresses', async () => {
  const local = await startTestServer({ TRUST_PROXY: '127.0.0.1' });
  try {
    for (let i = 0; i < 3; i++) await make(local, 'SQL ' + i, { 'X-Forwarded-For': '10.0.0.1' });
    assert.equal((await make(local, 'SQL', { 'X-Forwarded-For': '10.0.0.2' })).status, 201, 'a local proxy passes the real visitor address on');
  } finally { await local.close(); }
  const other = await startTestServer({ TRUST_PROXY: '10.9.9.9' });
  try {
    for (let i = 0; i < 3; i++) await make(other, 'SQL ' + i, { 'X-Forwarded-For': `10.0.0.${i}` });
    assert.equal((await make(other, 'SQL', { 'X-Forwarded-For': '10.0.0.99' })).status, 429, 'a request that is not from the listed proxy cannot set its own address');
  } finally { await other.close(); }
});

test('daily token budget and request cap turn new posters away with the polite message', async () => {
  for (const env of [{ DAILY_TOKEN_BUDGET: '2000' }, { DAILY_REQUEST_CAP: '3' }] as Array<Record<string, string>>) {
    const s = await startTestServer(env);
    try {
      assert.equal((await waitDone(s, (await make(s, 'SQL')).data.id)).status, 'ready');
      const r = await make(s, 'SQL again');
      assert.equal(r.status, 429, JSON.stringify(env));
      assert.equal(r.data.error, 'daily_cap');
      assert.match(r.data.message, /full for today/);
    } finally { await s.close(); }
  }
});

test('a running job stops at the next AI call once a cap is spent, and never makes that call', async () => {
  // Check and write are 2 calls. The review would be the 3rd, so a cap of 2 stops the job right before it.
  const s = await startTestServer({ DAILY_REQUEST_CAP: '2' });
  try {
    const d = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(d.status, 'failed');
    assert.match(d.message, /full for today/);
    assert.equal(s.provider.calls.review, 0, 'the review call was never made');
    assert.equal(s.store.dayUsage(s.clock.now).requests, 2);
  } finally { await s.close(); }
});

test('BASE_PATH: pages, links, API answers and the slash redirect all work under a prefix', async () => {
  const s = await startTestServer({ BASE_PATH: '/cheatwall/' });
  try {
    const html = await (await fetch(s.base + '/cheatwall/')).text();
    assert.match(html, /<meta name="cw-base" content="\/cheatwall\/">/);
    assert.ok(!/\b(href|src)="\/(?!cheatwall\/)/.test(html), 'every root link carries the prefix');
    assert.match(html, /src="\/cheatwall\/assets\/home\.js"/);
    // The proxy may strip the prefix, so plain paths work too.
    assert.equal((await fetch(s.base + '/about')).status, 200);
    assert.equal((await fetch(s.base + '/cheatwall/assets/site.css')).status, 200);
    const redirect = await fetch(s.base + '/cheatwall', { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/cheatwall/');
    const made = await post(s.base, '/cheatwall/api/posters', { topic: 'SQL' });
    assert.equal(made.status, 201);
    assert.equal(made.data.url, `/cheatwall/p/${made.data.id}`);
    await s.app.runner.idle();
    const p = (await getJson(s.base, `/cheatwall/api/posters/${made.data.id}`)).data;
    assert.equal(p.status, 'ready');
    assert.ok(p.downloads.pdf.startsWith(`/cheatwall/api/posters/${made.data.id}/poster.pdf`));
    assert.equal((await fetch(s.base + p.downloads.png)).status, 200);
    assert.equal((await getJson(s.base, '/cheatwall/api/posters/not-an-id')).status, 404);
    assert.equal((await getJson(s.base, '/cheatwall/api/posters/not-an-id')).data.error, 'not_found', 'API errors stay JSON under the prefix');
  } finally { await s.close(); }
});

test('daily spend cap: once reached, new posters are turned away', async () => {
  const s = await startTestServer({ DAILY_CAP_CENTS: '2', TRUST_PROXY: 'true' });
  try {
    const first = await waitDone(s, (await make(s, 'SQL', { 'X-Forwarded-For': '1.1.1.1' })).data.id);
    assert.equal(first.status, 'ready');
    assert.ok(s.store.dayUsage(s.clock.now).costCents >= 2, 'fake usage is big enough to hit a 2 cent cap');
    const r = await make(s, 'SQL', { 'X-Forwarded-For': '2.2.2.2' });
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'daily_cap');
    assert.match(r.data.message, /full for today/);
    assert.equal((await getJson(s.base, '/api/health')).status, 200, 'site stays up');
  } finally { await s.close(); }
});

test('a job queued before the cap was hit stops before spending anything', async () => {
  const s = await startTestServer({ DAILY_CAP_CENTS: '2' });
  try {
    await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.ok(s.store.dayUsage(s.clock.now).costCents >= 2, 'cap is now used up');
    // Put a job in the queue directly, as if it had been created just before the cap was hit.
    const id2 = 'b'.repeat(22);
    s.store.createPoster({ id: id2, topic: 'SQL two', level: null, theme: 'paper', visitorHash: 'someone', now: s.clock.now, retentionDays: 30 });
    const writes = s.provider.calls.write;
    const d = await waitDone(s, id2);
    assert.equal(d.status, 'failed');
    assert.match(d.message, /full for today/);
    assert.equal(s.store.getPoster(id2)!.input_tokens, 0, 'nothing was spent on it');
    assert.equal(s.provider.calls.write, writes, 'the AI was not called');
  } finally { await s.close(); }
});

test('invalid AI output is retried once, then the poster fails and does not count', async () => {
  const p = new FakeProvider();
  p.invalidFirst = 1;
  const s = await startTestServer({}, { provider: p });
  try {
    const ok = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(ok.status, 'ready');
    assert.equal(p.calls.write, 2);
    p.invalidFirst = 2;
    const bad = await waitDone(s, (await make(s, 'SQL again')).data.id);
    assert.equal(bad.status, 'failed');
    assert.equal(bad.message, MSG_BAD_CONTENT);
    assert.equal(s.store.visitorToday(s.store.getPoster(bad.id)!.visitor_hash, s.clock.now).counted, 1, 'the failed one is not counted');
  } finally { await s.close(); }
});

test('review step that returns junk keeps the written poster', async () => {
  const p = new FakeProvider();
  p.reviewPoster = async () => ({ value: { nope: true }, usage: { inputTokens: 1, outputTokens: 1 } });
  const s = await startTestServer({}, { provider: p });
  try {
    const d = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(d.status, 'ready');
    assert.ok(s.lines.some((l) => l.includes('review result unusable')));
  } finally { await s.close(); }
});

test('shorten loop: too big gets shortened and re-fitted, hopeless gets a clear failure', async () => {
  const r = new StubRenderer();
  const s = await startTestServer({}, { renderer: r });
  try {
    r.misses = 1;
    const ok = await waitDone(s, (await make(s, 'Big topic')).data.id);
    assert.equal(ok.status, 'ready');
    assert.equal(s.provider.calls.shorten, 1);
    r.misses = 5;
    const no = await waitDone(s, (await make(s, 'Huge topic')).data.id);
    assert.equal(no.status, 'failed');
    assert.equal(no.message, MSG_NO_FIT);
    assert.equal(s.provider.calls.shorten, 2, 'the renderer already grew the sheet, so only one shortening is tried');
  } finally { await s.close(); }
});

test('renderer crash gives a friendly failure, not a stuck poster', async () => {
  const r = new StubRenderer();
  r.render = async () => { throw new Error('chrome died'); };
  const s = await startTestServer({}, { renderer: r });
  try {
    const d = await waitDone(s, (await make(s, 'SQL')).data.id);
    assert.equal(d.status, 'failed');
    assert.match(d.message, /Something went wrong on our side/);
    assert.ok(!JSON.stringify(d).includes('chrome died'), 'internal errors are not shown to people');
    assert.ok(s.lines.some((l) => l.startsWith('ERROR') && l.includes('chrome died')), 'but they are logged');
  } finally { await s.close(); }
});

test('theme switch re-renders once, updates the poster and rejects bad input', async () => {
  const s = await startTestServer();
  try {
    const id = (await make(s, 'SQL')).data.id as string;
    await waitDone(s, id);
    const before = s.renderer.renders;
    const r = await post(s.base, `/api/posters/${id}/theme`, { theme: 'midnight' });
    assert.equal(r.status, 200);
    assert.equal(r.data.theme, 'midnight');
    assert.equal(s.renderer.renders, before + 1);
    assert.equal(s.provider.calls.write, 1, 'no AI call for a theme change');
    await post(s.base, `/api/posters/${id}/theme`, { theme: 'paper' });
    assert.equal(s.renderer.renders, before + 1, 'switching back reuses the files');
    assert.equal((await post(s.base, `/api/posters/${id}/theme`, { theme: '../../x' })).status, 400);
    assert.equal((await post(s.base, `/api/posters/${id}/theme`, {})).status, 400);
    assert.equal((await post(s.base, `/api/posters/${'a'.repeat(22)}/theme`, { theme: 'paper' })).status, 404);
    const missing = await fetch(s.base + `/api/posters/${id}/poster.pdf?theme=sunrise`);
    assert.equal(missing.status, 404, 'a theme that was never made cannot be fetched or used to trigger a render');
    const pending = await make(s, 'Other');
    s.store.setStatus(pending.data.id, 'writing');
    assert.equal((await post(s.base, `/api/posters/${pending.data.id}/theme`, { theme: 'sunrise' })).status, 409);
  } finally { await s.close(); }
});

test('two simultaneous switches to the same new theme render only once', async () => {
  const s = await startTestServer();
  try {
    const id = (await make(s, 'SQL')).data.id as string;
    await waitDone(s, id);
    const before = s.renderer.renders;
    const [a, b] = await Promise.all([post(s.base, `/api/posters/${id}/theme`, { theme: 'sunrise' }), post(s.base, `/api/posters/${id}/theme`, { theme: 'sunrise' })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(s.renderer.renders, before + 1);
  } finally { await s.close(); }
});

test('expiry: after 30 days the poster is gone, files are deleted, the page says so', async () => {
  const s = await startTestServer();
  try {
    const id = (await make(s, 'SQL')).data.id as string;
    const ready = await waitDone(s, id);
    const dir = `${s.config.posterDir}/${id}`;
    assert.ok(fs.existsSync(dir));
    s.clock.now = new Date(s.clock.now.getTime() + 31 * 86_400_000);
    const lazy = (await getJson(s.base, `/api/posters/${id}`)).data;
    assert.equal(lazy.status, 'expired', 'expired even before the cleanup job runs');
    assert.equal((await fetch(s.base + ready.downloads.pdf)).status, 404, 'cannot download after expiry');
    assert.equal((await post(s.base, `/api/posters/${id}/theme`, { theme: 'midnight' })).status, 409);
    assert.deepEqual(s.app.cleanup(), { expired: 1, purged: 0 });
    assert.ok(!fs.existsSync(dir), 'files deleted');
    assert.equal((await getJson(s.base, `/api/posters/${id}`)).data.status, 'expired');
    assert.equal(lazy.topic, 'SQL', 'topic stays so the page can offer make it again');
  } finally { await s.close(); }
});

test('after a restart, unfinished posters are picked up and finished', async () => {
  const s = await startTestServer();
  try {
    const id = (await make(s, 'SQL')).data.id as string;
    await waitDone(s, id);
    s.store.setStatus(id, 'writing');
    await s.app.runner.stop();
    const { JobRunner } = await import('../src/jobs.ts');
    const again = new JobRunner({ config: s.config, store: s.store, provider: s.provider, renderer: s.renderer, log: { info() {}, warn() {}, error() {} }, now: () => s.clock.now });
    again.start();
    await again.idle();
    await again.stop();
    assert.equal(s.store.getPoster(id)!.status, 'ready');
  } finally { await s.close(); }
});

test('pages, headers and safe routing', async () => {
  const s = await startTestServer();
  try {
    const home = await fetch(s.base + '/');
    assert.equal(home.status, 200);
    const csp = home.headers.get('content-security-policy')!;
    assert.match(csp, /script-src 'self'/);
    assert.ok(!csp.includes('unsafe-inline'));
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    for (const p of ['/about', '/privacy', '/terms']) assert.equal((await fetch(s.base + p)).status, 200, p);
    const html = await (await fetch(s.base + '/')).text();
    assert.ok(!/<script(?![^>]*\bsrc=)/.test(html), 'no inline scripts on the home page');
    assert.ok(!/\sstyle=/.test(html), 'no inline styles on the home page');
    const id = 'a'.repeat(22);
    const page = await fetch(`${s.base}/p/${id}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${s.base}/p/short`)).status, 404);
    assert.equal((await fetch(`${s.base}/nope`)).status, 404);
    assert.equal((await fetch(`${s.base}/assets/site.css`)).status, 200);
    assert.equal((await fetch(`${s.base}/assets/js`)).status, 404);
    assert.match(await (await fetch(s.base + '/robots.txt')).text(), /Disallow: \/p\//);
    const health = await getJson(s.base, '/api/health');
    assert.equal(health.data.ok, true);
    assert.equal(health.data.provider, 'fake-local');
    assert.equal((await getJson(s.base, '/api/posters/not-an-id')).status, 404);
    assert.equal((await fetch(s.base + '/api/posters', { method: 'GET' })).status, 404);
  } finally { await s.close(); }
});

test('path traversal cannot read files outside public/', async () => {
  const s = await startTestServer();
  try {
    const port = new URL(s.base).port;
    const raw = (path: string) => new Promise<number>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.end();
    });
    for (const p of ['/assets/../../package.json', '/assets/..%2f..%2fpackage.json', '/assets/%2e%2e/%2e%2e/package.json', '/assets/../src/server.ts', '/assets/..\\..\\package.json']) {
      const code = await raw(p);
      assert.ok(code === 404 || code === 400, `${p} gave ${code}`);
    }
    const body = await (await fetch(s.base + '/assets/..%2f..%2fpackage.json')).text();
    assert.ok(!body.includes('"name": "cheatwall"'));
  } finally { await s.close(); }
});

test('logs hold no poster ids in request lines and no IP addresses or topics anywhere', async () => {
  const s = await startTestServer({ TRUST_PROXY: 'true' });
  try {
    const topic = 'my secret topic about neighbour Bob';
    const id = (await make(s, topic, { 'X-Forwarded-For': '203.0.113.77' })).data.id as string;
    await waitDone(s, id);
    await fetch(`${s.base}/api/posters/${id}`);
    const all = s.lines.join('\n');
    assert.ok(!all.includes('203.0.113.77'), 'no IP in logs');
    assert.ok(!all.includes('secret topic'), 'no topic in logs');
    const requests = s.lines.filter((l) => l.includes(' request '));
    assert.ok(requests.length >= 2);
    for (const l of requests) assert.ok(!l.includes(id), 'request lines do not hold the private link');
    const dbBytes = fs.readFileSync(s.config.dbPath).toString('latin1') + (fs.existsSync(s.config.dbPath + '-wal') ? fs.readFileSync(s.config.dbPath + '-wal').toString('latin1') : '');
    assert.ok(!dbBytes.includes('203.0.113.77'), 'no raw IP in the database');
  } finally { await s.close(); }
});

test('hostile topic text is stored and returned as plain data, never run', async () => {
  const s = await startTestServer();
  try {
    const topic = '<img src=x onerror=alert(1)> "quotes" & more';
    const id = (await make(s, topic)).data.id as string;
    const done = await waitDone(s, id);
    assert.equal(done.status, 'ready');
    assert.equal(done.topic, topic);
    const res = await fetch(`${s.base}/api/posters/${id}`);
    assert.match(res.headers.get('content-type')!, /^application\/json/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const js = fs.readFileSync('public/assets/poster.js', 'utf8') + fs.readFileSync('public/assets/home.js', 'utf8') + fs.readFileSync('public/assets/dom.js', 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js), 'front-end never parses server text as HTML');
  } finally { await s.close(); }
});
