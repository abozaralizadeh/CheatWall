import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Status = 'queued' | 'checking' | 'writing' | 'reviewing' | 'rendering' | 'ready' | 'refused' | 'failed' | 'expired';
export const WORKING: Status[] = ['queued', 'checking', 'writing', 'reviewing', 'rendering'];

export interface PosterRow {
  id: string;
  topic: string;
  level: string | null;
  theme: string;
  status: Status;
  content: string | null;
  note: string | null;
  message: string | null;
  visitor_hash: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  created_at: string;
  expires_at: string;
}

// Days are UTC dates (YYYY-MM-DD). The daily cap and the per-visitor limit both reset at midnight UTC.
export function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const MIGRATIONS = [
  `CREATE TABLE posters (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    level TEXT,
    theme TEXT NOT NULL,
    status TEXT NOT NULL,
    content TEXT,
    note TEXT,
    message TEXT,
    visitor_hash TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX posters_visitor ON posters (visitor_hash, created_at);
  CREATE INDEX posters_status ON posters (status);
  CREATE TABLE daily_usage (
    day TEXT PRIMARY KEY,
    posters INTEGER NOT NULL DEFAULT 0,
    cost_cents REAL NOT NULL DEFAULT 0
  );`,
  // Daily token and AI call counts, for DAILY_TOKEN_BUDGET and DAILY_REQUEST_CAP.
  `ALTER TABLE daily_usage ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE daily_usage ADD COLUMN requests INTEGER NOT NULL DEFAULT 0;`,
];

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  createPoster(p: { id: string; topic: string; level: string | null; theme: string; visitorHash: string; now: Date; retentionDays: number }): void {
    const expires = new Date(p.now.getTime() + p.retentionDays * 86_400_000);
    this.db
      .prepare('INSERT INTO posters (id, topic, level, theme, status, visitor_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.topic, p.level, p.theme, 'queued', p.visitorHash, p.now.toISOString(), expires.toISOString());
  }

  getPoster(id: string): PosterRow | undefined {
    return this.db.prepare('SELECT * FROM posters WHERE id = ?').get(id) as PosterRow | undefined;
  }

  setStatus(id: string, status: Status, message: string | null = null): void {
    this.db.prepare('UPDATE posters SET status = ?, message = ? WHERE id = ?').run(status, message, id);
  }

  setReady(id: string, content: unknown, note: string | null, model: string): void {
    this.db.prepare("UPDATE posters SET status = 'ready', content = ?, note = ?, message = NULL, model = ? WHERE id = ?").run(JSON.stringify(content), note, model, id);
  }

  setTheme(id: string, theme: string): void {
    this.db.prepare('UPDATE posters SET theme = ? WHERE id = ?').run(theme, id);
  }

  // One call per AI request, so the daily request count goes up by one each time.
  addUsage(id: string, inputTokens: number, outputTokens: number, cents: number, now: Date): void {
    this.db.prepare('UPDATE posters SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_cents = cost_cents + ? WHERE id = ?').run(inputTokens, outputTokens, cents, id);
    this.db
      .prepare(
        `INSERT INTO daily_usage (day, posters, cost_cents, tokens, requests) VALUES (?, 0, ?, ?, 1)
         ON CONFLICT(day) DO UPDATE SET cost_cents = cost_cents + excluded.cost_cents, tokens = tokens + excluded.tokens, requests = requests + 1`,
      )
      .run(dayOf(now), cents, inputTokens + outputTokens);
  }

  countPosterMade(now: Date): void {
    this.db.prepare('INSERT INTO daily_usage (day, posters, cost_cents) VALUES (?, 1, 0) ON CONFLICT(day) DO UPDATE SET posters = posters + 1').run(dayOf(now));
  }

  dayUsage(now: Date): { posters: number; costCents: number; tokens: number; requests: number } {
    const r = this.db.prepare('SELECT posters, cost_cents, tokens, requests FROM daily_usage WHERE day = ?').get(dayOf(now)) as
      | { posters: number; cost_cents: number; tokens: number; requests: number }
      | undefined;
    return { posters: r?.posters ?? 0, costCents: r?.cost_cents ?? 0, tokens: r?.tokens ?? 0, requests: r?.requests ?? 0 };
  }

  // Posters that count toward a visitor's limit (failed and refused ones do not), and all attempts.
  visitorToday(visitorHash: string, now: Date): { counted: number; attempts: number } {
    const start = `${dayOf(now)}T00:00:00.000Z`;
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS attempts, COALESCE(SUM(CASE WHEN status NOT IN ('failed','refused') THEN 1 ELSE 0 END), 0) AS counted
         FROM posters WHERE visitor_hash = ? AND created_at >= ?`,
      )
      .get(visitorHash, start) as { attempts: number; counted: number };
    return { counted: r.counted, attempts: r.attempts };
  }

  // Takes the oldest queued poster and marks it as being worked on, so two workers never take the same one.
  claimNext(): PosterRow | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare("SELECT * FROM posters WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as PosterRow | undefined;
      if (row) this.db.prepare("UPDATE posters SET status = 'checking' WHERE id = ?").run(row.id);
      this.db.exec('COMMIT');
      return row;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // After a restart, anything that was mid-job starts again from the beginning.
  requeueUnfinished(): number {
    const r = this.db.prepare("UPDATE posters SET status = 'queued' WHERE status IN ('checking','writing','reviewing','rendering')").run();
    return Number(r.changes);
  }

  expireDue(now: Date): string[] {
    const rows = this.db.prepare("SELECT id FROM posters WHERE expires_at <= ? AND status != 'expired'").all(now.toISOString()) as Array<{ id: string }>;
    const upd = this.db.prepare("UPDATE posters SET status = 'expired', content = NULL, note = NULL, message = NULL WHERE id = ?");
    for (const r of rows) upd.run(r.id);
    return rows.map((r) => r.id);
  }

  purgeOld(now: Date, afterDays: number): number {
    const cutoff = new Date(now.getTime() - afterDays * 86_400_000).toISOString();
    const r = this.db.prepare("DELETE FROM posters WHERE status = 'expired' AND expires_at <= ?").run(cutoff);
    return Number(r.changes);
  }

  counts(): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM posters GROUP BY status').all() as Array<{ status: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}
