import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { checkCanCreate, loadSecret, visitorHash } from '../src/limits.ts';
import { Store } from '../src/store.ts';
import { newPosterId } from '../src/content.ts';
import { tempDir, testConfig } from './helpers.ts';

const T0 = new Date('2026-11-10T10:00:00Z');

function add(store: Store, visitor: string, now = T0, status?: string): string {
  const id = newPosterId();
  store.createPoster({ id, topic: 'SQL', level: null, theme: 'paper', visitorHash: visitor, now, retentionDays: 30 });
  if (status) store.setStatus(id, status as any);
  return id;
}

test('migrations run once and the schema works', () => {
  const dir = tempDir();
  const file = `${dir}/a.db`;
  new Store(file).close();
  const again = new Store(file);
  assert.equal((again.db.prepare('PRAGMA user_version').get() as any).user_version, 2);
  again.close();
});

test('visitor limit counts real posters, not failed or refused ones', () => {
  const store = new Store(':memory:');
  const cfg = testConfig(tempDir());
  add(store, 'v1', T0, 'ready');
  add(store, 'v1', T0, 'failed');
  add(store, 'v1', T0, 'refused');
  add(store, 'v1', T0, 'queued');
  assert.deepEqual(store.visitorToday('v1', T0), { counted: 2, attempts: 4 });
  assert.equal(checkCanCreate(store, cfg, 'v1', T0).ok, true);
  add(store, 'v1', T0, 'ready');
  const blocked = checkCanCreate(store, cfg, 'v1', T0);
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.code, 'visitor_limit');
  assert.equal(checkCanCreate(store, cfg, 'someone-else', T0).ok, true);
});

test('limit resets at midnight UTC', () => {
  const store = new Store(':memory:');
  const cfg = testConfig(tempDir());
  for (let i = 0; i < 3; i++) add(store, 'v1', new Date('2026-11-10T23:59:00Z'), 'ready');
  assert.equal(checkCanCreate(store, cfg, 'v1', new Date('2026-11-10T23:59:30Z')).ok, false);
  assert.equal(checkCanCreate(store, cfg, 'v1', new Date('2026-11-11T00:00:01Z')).ok, true);
});

test('attempt limit stops endless refused or failed tries', () => {
  const store = new Store(':memory:');
  const cfg = testConfig(tempDir(), { ATTEMPTS_PER_VISITOR_PER_DAY: '5' });
  for (let i = 0; i < 5; i++) add(store, 'v1', T0, 'refused');
  const r = checkCanCreate(store, cfg, 'v1', T0);
  assert.equal(!r.ok && r.code, 'attempt_limit');
});

test('daily spend cap blocks everyone once reached', () => {
  const store = new Store(':memory:');
  const cfg = testConfig(tempDir(), { DAILY_CAP_CENTS: '10' });
  const id = add(store, 'v1', T0, 'ready');
  store.addUsage(id, 1000, 1000, 9.9, T0);
  assert.equal(checkCanCreate(store, cfg, 'v2', T0).ok, true);
  store.addUsage(id, 10, 10, 0.2, T0);
  const r = checkCanCreate(store, cfg, 'v2', T0);
  assert.equal(!r.ok && r.code, 'daily_cap');
  assert.equal(checkCanCreate(store, cfg, 'v2', new Date('2026-11-11T00:00:01Z')).ok, true, 'new day, new budget');
  const row = store.getPoster(id)!;
  assert.equal(row.input_tokens, 1010);
});

test('claimNext hands each queued poster to exactly one caller, oldest first', () => {
  const store = new Store(':memory:');
  const a = add(store, 'v', new Date('2026-11-10T10:00:00Z'));
  const b = add(store, 'v', new Date('2026-11-10T10:00:01Z'));
  assert.equal(store.claimNext()!.id, a);
  assert.equal(store.claimNext()!.id, b);
  assert.equal(store.claimNext(), undefined);
  assert.equal(store.getPoster(a)!.status, 'checking');
});

test('unfinished jobs are requeued after a restart', () => {
  const store = new Store(':memory:');
  const ids = ['writing', 'rendering', 'ready', 'failed'].map((s) => add(store, 'v', T0, s));
  assert.equal(store.requeueUnfinished(), 2);
  assert.deepEqual(ids.map((i) => store.getPoster(i)!.status), ['queued', 'queued', 'ready', 'failed']);
});

test('expiry clears content, and old expired rows are purged', () => {
  const store = new Store(':memory:');
  const id = add(store, 'v', T0, 'ready');
  store.setReady(id, { title: 'x' }, 'note', 'm');
  assert.deepEqual(store.expireDue(new Date('2026-11-20T00:00:00Z')), [], 'not due yet');
  assert.deepEqual(store.expireDue(new Date('2026-12-11T00:00:00Z')), [id]);
  const row = store.getPoster(id)!;
  assert.equal(row.status, 'expired');
  assert.equal(row.content, null);
  assert.equal(row.note, null);
  assert.equal(row.topic, 'SQL', 'topic kept for make-it-again until the purge');
  assert.equal(store.purgeOld(new Date('2026-12-20T00:00:00Z'), 60), 0);
  assert.equal(store.purgeOld(new Date('2027-02-20T00:00:00Z'), 60), 1);
  assert.equal(store.getPoster(id), undefined);
});

test('visitor hash: stable in a day, different across days and IPs, never the raw IP', () => {
  const a = visitorHash('s', '203.0.113.9', new Date('2026-11-10T01:00:00Z'));
  assert.equal(a, visitorHash('s', '203.0.113.9', new Date('2026-11-10T23:00:00Z')));
  assert.notEqual(a, visitorHash('s', '203.0.113.9', new Date('2026-11-11T01:00:00Z')));
  assert.notEqual(a, visitorHash('s', '203.0.113.10', new Date('2026-11-10T01:00:00Z')));
  assert.notEqual(a, visitorHash('other', '203.0.113.9', new Date('2026-11-10T01:00:00Z')));
  assert.ok(!a.includes('203'));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('secret file is created once with owner-only permissions and reused', () => {
  const file = `${tempDir()}/sub/.secret`;
  const s1 = loadSecret(file);
  assert.equal(s1.length, 64);
  assert.equal(loadSecret(file), s1);
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'no group or world access');
});
