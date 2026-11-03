import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeProvider } from '../src/ai/fake.ts';
import { createApp, type App } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import type { Logger } from '../src/log.ts';
import { StubRenderer } from '../src/render/stub.ts';
import { Store } from '../src/store.ts';

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cheatwall-test-'));
}

export function testConfig(dir: string, env: Record<string, string> = {}): Config {
  return loadConfig({ DATA_DIR: path.join(dir, 'data'), LOG_DIR: path.join(dir, 'logs'), PORT: '0', ...env }, process.cwd());
}

export interface TestServer {
  app: App;
  store: Store;
  provider: FakeProvider;
  renderer: StubRenderer;
  config: Config;
  lines: string[];
  clock: { now: Date };
  base: string;
  close(): Promise<void>;
}

export async function startTestServer(env: Record<string, string> = {}, opts: { provider?: FakeProvider; renderer?: StubRenderer } = {}): Promise<TestServer> {
  const dir = tempDir();
  const config = testConfig(dir, env);
  const store = new Store(config.dbPath);
  const provider = opts.provider ?? new FakeProvider();
  const renderer = opts.renderer ?? new StubRenderer();
  const lines: string[] = [];
  const push = (level: string) => (msg: string, f?: Record<string, unknown>) => { lines.push(`${level} ${msg} ${f ? JSON.stringify(f) : ''}`); };
  const log: Logger = { info: push('INFO'), warn: push('WARN'), error: push('ERROR') };
  const clock = { now: new Date('2026-11-10T12:00:00Z') };
  const app = createApp({ config, store, provider, renderer, log, now: () => clock.now, secret: 'test-secret' });
  const port = await app.listen();
  return {
    app, store, provider, renderer, config, lines, clock,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function post(base: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function getJson(base: string, url: string): Promise<{ status: number; data: any }> {
  const res = await fetch(base + url);
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function waitDone(s: TestServer, id: string): Promise<any> {
  await s.app.runner.idle();
  return (await getJson(s.base, `/api/posters/${id}`)).data;
}
