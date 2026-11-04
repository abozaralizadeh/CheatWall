import crypto from 'node:crypto';
import { z } from 'zod';

export const LEVELS = ['beginner', 'student', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

// Limits for one poster. They are generous on purpose: a big topic makes a dense poster, and the renderer
// grows the sheet when it has to. Anything over a limit is repaired in code (see repairPoster) before it is checked.
export const LIMITS = {
  title: 80,
  subtitle: 160,
  heading: 60,
  note: 200,
  sections: { min: 4, max: 24 },
  point: 220,
  points: 16,
  step: 200,
  steps: 12,
  columns: { min: 2, max: 6 },
  column: 40,
  cell: 140,
  rows: 18,
  term: 50,
  meaning: 200,
  definitions: 14,
  latex: 160,
  caption: 100,
  formulas: 10,
  language: 20,
  code: 1200,
  codeLines: 24,
} as const;

const L = LIMITS;
const line = (max: number) => z.string().trim().min(1).max(max);

const points = z.object({ kind: z.literal('points'), heading: line(L.heading), items: z.array(line(L.point)).min(1).max(L.points) });
const steps = z.object({ kind: z.literal('steps'), heading: line(L.heading), items: z.array(line(L.step)).min(1).max(L.steps) });
const table = z.object({
  kind: z.literal('table'),
  heading: line(L.heading),
  columns: z.array(line(L.column)).min(L.columns.min).max(L.columns.max),
  // A cell may be empty, so a short row can be padded instead of thrown away.
  rows: z.array(z.array(z.string().trim().max(L.cell)).min(L.columns.min).max(L.columns.max)).min(1).max(L.rows),
});
const definitions = z.object({
  kind: z.literal('definitions'),
  heading: line(L.heading),
  items: z.array(z.object({ term: line(L.term), meaning: line(L.meaning) })).min(1).max(L.definitions),
});
const formulas = z.object({
  kind: z.literal('formulas'),
  heading: line(L.heading),
  items: z.array(z.object({ latex: line(L.latex), caption: line(L.caption) })).min(1).max(L.formulas),
});
const code = z.object({
  kind: z.literal('code'),
  heading: line(L.heading),
  language: line(L.language),
  code: z.string().trim().min(1).max(L.code),
});

export const sectionSchema = z.discriminatedUnion('kind', [points, steps, table, definitions, formulas, code]);

export const posterSchema = z
  .object({
    title: line(L.title),
    subtitle: line(L.subtitle),
    sections: z.array(sectionSchema).min(L.sections.min).max(L.sections.max),
    note: z.string().trim().max(L.note).optional(),
  })
  .superRefine((poster, ctx) => {
    poster.sections.forEach((s, i) => {
      if (s.kind !== 'table') return;
      s.rows.forEach((row, r) => {
        if (row.length !== s.columns.length) {
          ctx.addIssue({ code: 'custom', message: `row ${r} has ${row.length} cells, expected ${s.columns.length}`, path: ['sections', i, 'rows', r] });
        }
      });
    });
    poster.sections.forEach((s, i) => {
      if (s.kind === 'code' && s.code.split('\n').length > L.codeLines) {
        ctx.addIssue({ code: 'custom', message: `code block longer than ${L.codeLines} lines`, path: ['sections', i, 'code'] });
      }
    });
  });

export type Section = z.infer<typeof sectionSchema>;
export type PosterContent = z.infer<typeof posterSchema>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsePoster(raw: unknown): Parsed<PosterContent> {
  const r = posterSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

// ---- Repair ----
// The AI often goes a little over a limit: one long cell, a seventh column, a 17th bullet. Throwing the whole poster
// away for that wastes a full AI call, so we fix what we safely can here. Long text is cut at a word boundary with an
// ellipsis, wide tables are split into two tables that share the first column, long lists and tables continue in a
// second section, and broken pieces are dropped. Only a poster with no title or too few usable sections stays invalid.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function asText(v: unknown): string | null {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t || null;
}

// Cuts at the last space before the limit when there is one in the last 40 percent, and adds an ellipsis.
export function clampText(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  if (space > cut.length * 0.6) cut = cut.slice(0, space);
  return cut.replace(/[\s.,;:!?-]+$/, '') + '\u2026';
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const cont = (heading: string, n: number) => (n === 0 ? heading : clampText(`${heading} (${n + 1})`, L.heading));

export interface Repaired {
  value: unknown;
  // What was changed, for the log. Empty when nothing needed fixing.
  fixes: string[];
}

export function repairPoster(raw: unknown): Repaired {
  if (!isObj(raw)) return { value: raw, fixes: [] };
  const fixes: string[] = [];
  const text = (v: unknown, max: number, where: string): string | null => {
    const t = asText(v);
    if (t === null) return null;
    if ([...t].length > max) { fixes.push(`${where}: cut to ${max} characters`); return clampText(t, max); }
    return t;
  };
  const list = <T>(v: unknown, fn: (item: unknown, i: number) => T | null): T[] => (Array.isArray(v) ? v.map(fn).filter((x): x is T => x !== null) : []);

  const out: Obj = { ...raw };
  const title = text(raw.title, L.title, 'title');
  if (title) out.title = title;
  const subtitle = text(raw.subtitle, L.subtitle, 'subtitle');
  out.subtitle = subtitle ?? (title ? 'Cheat sheet' : raw.subtitle);
  if (raw.note === undefined || raw.note === null) delete out.note;
  else {
    const note = text(raw.note, L.note, 'note');
    if (note) out.note = note;
    else delete out.note;
  }

  const sections: Obj[] = [];
  (Array.isArray(raw.sections) ? raw.sections : []).forEach((s, i) => {
    const where = `sections.${i}`;
    if (!isObj(s)) { fixes.push(`${where}: dropped, not a section`); return; }
    const heading = text(s.heading, L.heading, `${where}.heading`);
    if (!heading) { fixes.push(`${where}: dropped, no heading`); return; }
    const before = sections.length;
    switch (s.kind) {
      case 'points':
      case 'steps': {
        const max = s.kind === 'points' ? L.point : L.step;
        const per = s.kind === 'points' ? L.points : L.steps;
        const items = list(s.items, (v, j) => text(v, max, `${where}.items.${j}`));
        if (items.length > per) fixes.push(`${where}: ${items.length} items split into ${Math.ceil(items.length / per)} sections`);
        chunk(items, per).forEach((part, n) => sections.push({ kind: s.kind, heading: cont(heading, n), items: part }));
        break;
      }
      case 'definitions': {
        const items = list(s.items, (v, j) => {
          if (!isObj(v)) return null;
          const term = text(v.term, L.term, `${where}.items.${j}.term`);
          const meaning = text(v.meaning, L.meaning, `${where}.items.${j}.meaning`);
          return term && meaning ? { term, meaning } : null;
        });
        if (items.length > L.definitions) fixes.push(`${where}: ${items.length} items split`);
        chunk(items, L.definitions).forEach((part, n) => sections.push({ kind: 'definitions', heading: cont(heading, n), items: part }));
        break;
      }
      case 'formulas': {
        const items = list(s.items, (v, j) => {
          if (!isObj(v)) return null;
          const latex = asText(v.latex);
          // A cut formula would be wrong, so a formula that is too long is dropped instead.
          if (!latex || [...latex].length > L.latex) { fixes.push(`${where}.items.${j}: formula dropped`); return null; }
          const caption = text(v.caption, L.caption, `${where}.items.${j}.caption`) ?? '';
          return caption ? { latex, caption } : null;
        });
        chunk(items, L.formulas).forEach((part, n) => sections.push({ kind: 'formulas', heading: cont(heading, n), items: part }));
        break;
      }
      case 'code': {
        if (typeof s.code !== 'string' || !s.code.trim()) break;
        const lines = s.code.replace(/\s+$/, '').split('\n');
        let kept: string[] = [];
        let size = 0;
        for (const l of lines) {
          if (kept.length >= L.codeLines || size + l.length + 1 > L.code) break;
          kept.push(l);
          size += l.length + 1;
        }
        if (kept.length < lines.length) fixes.push(`${where}: code cut to ${kept.length} lines`);
        if (!kept.join('').trim()) kept = [clampText(lines[0]!.trim(), L.code)];
        sections.push({ kind: 'code', heading, language: text(s.language, L.language, `${where}.language`) ?? 'text', code: kept.join('\n') });
        break;
      }
      case 'table': {
        let columns = list(s.columns, (v, j) => text(v, L.column, `${where}.columns.${j}`) ?? `Column ${j + 1}`);
        let rows = list(s.rows, (r, j) => (Array.isArray(r) ? r.map((c, k) => text(c, L.cell, `${where}.rows.${j}.${k}`) ?? '') : null)).filter((r) => r.some(Boolean));
        if (!rows.length) break;
        const width = Math.max(columns.length, ...rows.map((r) => r.length));
        while (columns.length < width) columns.push(columns.length ? '' : 'Item');
        if (columns.length < L.columns.min) columns = [...columns, ''].slice(0, L.columns.min);
        columns = columns.map((c, j) => c || `Column ${j + 1}`);
        rows = rows.map((r) => Array.from({ length: columns.length }, (_, k) => r[k] ?? ''));
        // Too wide: keep the first column in every part, and spread the rest over parts of at most 6 columns.
        const rest = columns.slice(1).map((_, k) => k + 1);
        const groups = chunk(rest, L.columns.max - 1);
        if (groups.length > 1) fixes.push(`${where}: ${columns.length} columns split into ${groups.length} tables`);
        if (rows.length > L.rows) fixes.push(`${where}: ${rows.length} rows split`);
        let n = 0;
        groups.forEach((g, gi) => {
          const cols = [0, ...g];
          // In the extra parts, a row with nothing but its key is noise, so it is left out there.
          const partRows = rows.map((r) => cols.map((k) => r[k]!)).filter((r) => gi === 0 || r.slice(1).some(Boolean));
          for (const part of chunk(partRows, L.rows)) sections.push({ kind: 'table', heading: cont(heading, n++), columns: cols.map((k) => columns[k]!), rows: part });
        });
        break;
      }
    }
    if (sections.length === before) fixes.push(`${where}: dropped, nothing usable in it`);
  });
  if (sections.length > L.sections.max) {
    fixes.push(`${sections.length} sections, kept the first ${L.sections.max}`);
    sections.length = L.sections.max;
  }
  out.sections = sections;
  return { value: out, fixes };
}

export const TOPIC_MIN = 2;
export const TOPIC_MAX = 120;

// Control characters, zero-width and bidirectional override characters. Normal letters in any language are fine.
function isForbiddenChar(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
}

export function normalizeTopic(input: unknown): Parsed<string> {
  if (typeof input !== 'string') return { ok: false, error: 'Type the topic you want to study.' };
  const topic = input.normalize('NFC').replace(/\s+/g, ' ').trim();
  if ([...topic].some(isForbiddenChar)) {
    return { ok: false, error: 'The topic has characters we cannot use.' };
  }
  if ([...topic].length < TOPIC_MIN) return { ok: false, error: 'Give the topic a few more letters.' };
  if ([...topic].length > TOPIC_MAX) return { ok: false, error: `Keep the topic under ${TOPIC_MAX} characters.` };
  return { ok: true, value: topic };
}

export function normalizeLevel(input: unknown): Parsed<Level | null> {
  if (input === undefined || input === null || input === '') return { ok: true, value: null };
  if (typeof input === 'string' && (LEVELS as readonly string[]).includes(input)) return { ok: true, value: input as Level };
  return { ok: false, error: 'Pick beginner, student or advanced, or leave the level empty.' };
}

// 16 random bytes: 128 bits, enough that a private link cannot be guessed.
export function newPosterId(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function isPosterId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'poster';
}
