import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createLogger } from '../src/log.ts';
import { tempDir } from './helpers.ts';

test('log file rotates at the size limit and keeps only the newest files', () => {
  const dir = tempDir();
  const log = createLogger({ dir, maxBytes: 1000, keep: 3, stdout: false });
  for (let i = 0; i < 200; i++) log.info('line number ' + i, { n: i });
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['cheatwall.log', 'cheatwall.log.1', 'cheatwall.log.2']);
  for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= 1100, f);
  const newest = fs.readFileSync(path.join(dir, 'cheatwall.log'), 'utf8');
  assert.ok(newest.includes('line number 199'));
  const total = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total <= 3300, 'total size stays bounded');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('logging never throws, even when the folder disappears', () => {
  const dir = tempDir();
  const log = createLogger({ dir, maxBytes: 1000, keep: 2, stdout: false });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.doesNotThrow(() => log.error('still fine'));
});

test('log lines have time, level, message and fields', () => {
  const dir = tempDir();
  const log = createLogger({ dir, maxBytes: 10000, keep: 2, stdout: false });
  log.warn('hello', { id: 'abc' });
  const text = fs.readFileSync(path.join(dir, 'cheatwall.log'), 'utf8');
  assert.match(text, /^\d{4}-\d\d-\d\dT[\d:.]+Z WARN hello \{"id":"abc"\}\n$/);
  fs.rmSync(dir, { recursive: true, force: true });
});
