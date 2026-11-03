import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { TextProvider } from './ai/provider.ts';
import type { Config } from './config.ts';
import { isPosterId, newPosterId, normalizeLevel, normalizeTopic, slugify } from './content.ts';
import { hasPosterFiles, posterFile, removePosterFiles, writePosterFiles } from './files.ts';
import { JobRunner } from './jobs.ts';
import { checkCanCreate, loadSecret, visitorHash } from './limits.ts';
import type { Logger } from './log.ts';
import { parsePoster } from './content.ts';
import type { PosterRenderer } from './render/renderer.ts';
import { getTheme, THEMES } from './render/themes.ts';
import { AI_NOTE } from './render/template.ts';
import type { PosterRow, Status, Store } from './store.ts';

export interface AppDeps {
  config: Config;
  store: Store;
  provider: TextProvider;
  renderer: PosterRenderer;
  log: Logger;
  now?: () => Date;
  secret?: string;
}

const STEPS: Partial<Record<Status, { index: number; label: string }>> = {
  queued: { index: 1, label: 'In line' },
  checking: { index: 2, label: 'Checking the topic' },
  writing: { index: 3, label: 'Writing the poster' },
  reviewing: { index: 4, label: 'Checking the facts' },
  rendering: { index: 5, label: 'Laying it out' },
};
const TOTAL_STEPS = 5;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/about': 'about.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
};

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface App {
  server: http.Server;
  runner: JobRunner;
  listen(): Promise<number>;
  cleanup(): { expired: number; purged: number };
  close(): Promise<void>;
}

export function createApp(deps: AppDeps): App {
  const { config, store, provider, renderer, log } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const secret = deps.secret ?? loadSecret(config.secretPath);
  const runner = new JobRunner({ config, store, provider, renderer, log, now: deps.now });
  const themeLocks = new Map<string, Promise<void>>();

  function clientIp(req: http.IncomingMessage): string {
    if (config.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const last = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
      if (last) return last;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      ...extra,
    });
    res.end(body);
  }

  const json = (res: http.ServerResponse, status: number, data: unknown) =>
    send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });

  function readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const type = req.headers['content-type'] ?? '';
      if (!type.startsWith('application/json')) return reject(new HttpError(415, 'bad_type', 'Send JSON.'));
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 4096) { reject(new HttpError(413, 'too_big', 'That request is too big.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'bad_json', 'That was not valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function isExpired(row: PosterRow): boolean {
    return row.status === 'expired' || row.expires_at <= now().toISOString();
  }

  function shape(row: PosterRow) {
    const expired = isExpired(row);
    const status: Status = expired ? 'expired' : row.status;
    const step = STEPS[status];
    const ready = status === 'ready';
    let title: string | null = null;
    if (ready && row.content) {
      try { title = (JSON.parse(row.content) as { title?: string }).title ?? null; } catch { /* ignore */ }
    }
    return {
      id: row.id,
      status,
      step: step ? { ...step, total: TOTAL_STEPS } : null,
      message: status === 'failed' || status === 'refused' ? row.message : null,
      topic: row.topic,
      level: row.level,
      theme: row.theme,
      themes: THEMES.map((t) => ({ id: t.id, name: t.name })),
      title,
      note: ready ? row.note : null,
      aiNote: AI_NOTE,
      expiresAt: row.expires_at,
      downloads: ready
        ? {
            pdf: `/api/posters/${row.id}/poster.pdf?theme=${row.theme}`,
            png: `/api/posters/${row.id}/poster.png?theme=${row.theme}`,
          }
        : null,
    };
  }

  function getRow(id: string): PosterRow {
    if (!isPosterId(id)) throw new HttpError(404, 'not_found', 'No such poster.');
    const row = store.getPoster(id);
    if (!row) throw new HttpError(404, 'not_found', 'No such poster.');
    return row;
  }

  async function createPoster(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = (await readBody(req)) as { topic?: unknown; level?: unknown } | null;
    const topic = normalizeTopic(body?.topic);
    if (!topic.ok) throw new HttpError(400, 'bad_topic', topic.error);
    const level = normalizeLevel(body?.level);
    if (!level.ok) throw new HttpError(400, 'bad_level', level.error);
    const visitor = visitorHash(secret, clientIp(req), now());
    // No await between this check and the insert, so two quick requests cannot both slip under the limit.
    const check = checkCanCreate(store, config, visitor, now());
    if (!check.ok) throw new HttpError(429, check.code, check.message);
    const id = newPosterId();
    store.createPoster({ id, topic: topic.value, level: level.value, theme: config.defaultTheme, visitorHash: visitor, now: now(), retentionDays: config.retentionDays });
    log.info('poster queued', { id });
    runner.pump();
    json(res, 201, { id, url: `/p/${id}` });
  }

  async function switchTheme(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
    const row = getRow(id);
    if (isExpired(row) || row.status !== 'ready' || !row.content) throw new HttpError(409, 'not_ready', 'This poster is not ready.');
    const body = (await readBody(req)) as { theme?: unknown } | null;
    const theme = typeof body?.theme === 'string' ? getTheme(body.theme) : undefined;
    if (!theme) throw new HttpError(400, 'bad_theme', 'Unknown theme.');
    if (!hasPosterFiles(config.posterDir, id, theme.id)) {
      const pending = themeLocks.get(`${id}:${theme.id}`);
      if (pending) await pending;
      else {
        const job = (async () => {
          const parsed = parsePoster(JSON.parse(row.content!));
          if (!parsed.ok) throw new Error('stored poster is invalid');
          const result = await renderer.render(parsed.value, theme);
          writePosterFiles(config.posterDir, id, theme.id, result);
        })();
        themeLocks.set(`${id}:${theme.id}`, job);
        try { await job; } finally { themeLocks.delete(`${id}:${theme.id}`); }
      }
    }
    store.setTheme(id, theme.id);
    json(res, 200, shape(store.getPoster(id)!));
  }

  function download(res: http.ServerResponse, url: URL, id: string, ext: 'pdf' | 'png'): void {
    const row = getRow(id);
    if (isExpired(row) || row.status !== 'ready') throw new HttpError(404, 'not_found', 'No such poster.');
    const themeId = url.searchParams.get('theme') ?? row.theme;
    const theme = getTheme(themeId);
    if (!theme || !hasPosterFiles(config.posterDir, id, theme.id)) throw new HttpError(404, 'not_found', 'No such poster file.');
    const data = fs.readFileSync(posterFile(config.posterDir, id, theme.id, ext));
    const name = `cheatwall-${slugify(row.topic)}.${ext}`;
    const attach = ext === 'pdf' || url.searchParams.get('download') === '1';
    send(res, 200, data, ext === 'pdf' ? 'application/pdf' : 'image/png', {
      'Content-Disposition': `${attach ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex',
    });
  }

  function serveFile(res: http.ServerResponse, rel: string, status = 200, extra: Record<string, string> = {}): void {
    const root = config.publicDir;
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw new HttpError(404, 'not_found', 'Not found.');
    let data: Buffer;
    try { data = fs.readFileSync(file); } catch { throw new HttpError(404, 'not_found', 'Not found.'); }
    send(res, status, data, MIME[path.extname(file)] ?? 'application/octet-stream', { 'Cache-Control': 'public, max-age=300', ...extra });
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<string> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && p in PAGES) { serveFile(res, PAGES[p]!); return p; }
    if (method === 'GET' && /^\/p\/[^/]+$/.test(p)) {
      if (!isPosterId(p.slice(3))) { serveFile(res, 'notfound.html', 404); return '/p/:bad'; }
      serveFile(res, 'poster.html', 200, { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' });
      return '/p/:id';
    }
    if (method === 'GET' && p.startsWith('/assets/')) { serveFile(res, p.slice(1)); return '/assets/*'; }
    if (method === 'GET' && p === '/robots.txt') {
      send(res, 200, 'User-agent: *\nDisallow: /p/\nDisallow: /api/\n', 'text/plain; charset=utf-8');
      return p;
    }
    if (method === 'GET' && p === '/api/health') {
      json(res, 200, { ok: true, provider: provider.name, posters: store.counts() });
      return p;
    }
    if (method === 'POST' && p === '/api/posters') { await createPoster(req, res); return p; }

    const m = /^\/api\/posters\/([^/]+)(?:\/(theme|poster\.pdf|poster\.png))?$/.exec(p);
    if (m) {
      const id = m[1]!;
      const what = m[2];
      if (!what && method === 'GET') { json(res, 200, shape(getRow(id))); return '/api/posters/:id'; }
      if (what === 'theme' && method === 'POST') { await switchTheme(req, res, id); return '/api/posters/:id/theme'; }
      if (what === 'poster.pdf' && method === 'GET') { download(res, url, id, 'pdf'); return '/api/posters/:id/poster.pdf'; }
      if (what === 'poster.png' && method === 'GET') { download(res, url, id, 'png'); return '/api/posters/:id/poster.png'; }
    }
    throw new HttpError(404, 'not_found', 'Not found.');
  }

  const server = http.createServer((req, res) => {
    const started = Date.now();
    let label = (req.url ?? '').split('?')[0]!.replace(/[A-Za-z0-9_-]{22}/g, ':id');
    route(req, res)
      .then((l) => { label = l; })
      .catch((err) => {
        if (err instanceof HttpError) {
          if (req.url?.startsWith('/api/') || req.method === 'POST') json(res, err.status, { error: err.code, message: err.message });
          else serveFile(res, 'notfound.html', err.status);
        } else {
          log.error('request failed', { path: label, error: String(err) });
          if (!res.headersSent) json(res, 500, { error: 'server_error', message: 'Something went wrong on our side.' });
        }
      })
      .finally(() => {
        // Poster ids are private links, so log the route pattern and never the real id.
        log.info('request', { method: req.method, path: label, status: res.statusCode, ms: Date.now() - started });
      });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;

  let cleanupTimer: NodeJS.Timeout | null = null;

  function cleanup() {
    const ids = store.expireDue(now());
    for (const id of ids) removePosterFiles(config.posterDir, id);
    const purged = store.purgeOld(now(), config.purgeAfterExpiryDays);
    if (ids.length || purged) log.info('cleanup done', { expired: ids.length, purged });
    return { expired: ids.length, purged };
  }

  return {
    server,
    runner,
    cleanup,
    listen() {
      return new Promise((resolve) => {
        runner.start();
        cleanup();
        cleanupTimer = setInterval(cleanup, 3_600_000);
        cleanupTimer.unref();
        server.listen(config.port, config.host, () => resolve((server.address() as { port: number }).port));
      });
    },
    async close() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      await runner.stop();
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
