import crypto from 'node:crypto';
import { z } from 'zod';

export const LEVELS = ['beginner', 'student', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

const line = (max: number) => z.string().trim().min(1).max(max);

const points = z.object({ kind: z.literal('points'), heading: line(50), items: z.array(line(180)).min(2).max(10) });
const steps = z.object({ kind: z.literal('steps'), heading: line(50), items: z.array(line(160)).min(2).max(8) });
const table = z.object({
  kind: z.literal('table'),
  heading: line(50),
  columns: z.array(line(30)).min(2).max(4),
  rows: z.array(z.array(line(80)).min(2).max(4)).min(1).max(10),
});
const definitions = z.object({
  kind: z.literal('definitions'),
  heading: line(50),
  items: z.array(z.object({ term: line(40), meaning: line(160) })).min(2).max(8),
});
const formulas = z.object({
  kind: z.literal('formulas'),
  heading: line(50),
  items: z.array(z.object({ latex: line(120), caption: line(80) })).min(1).max(6),
});
const code = z.object({
  kind: z.literal('code'),
  heading: line(50),
  language: line(20),
  code: z.string().trim().min(1).max(600),
});

export const sectionSchema = z.discriminatedUnion('kind', [points, steps, table, definitions, formulas, code]);

export const posterSchema = z
  .object({
    title: line(60),
    subtitle: line(100),
    sections: z.array(sectionSchema).min(4).max(12),
    note: z.string().trim().max(200).optional(),
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
      if (s.kind === 'code' && s.code.split('\n').length > 14) {
        ctx.addIssue({ code: 'custom', message: 'code block longer than 14 lines', path: ['sections', i, 'code'] });
      }
    });
  });

export type Section = z.infer<typeof sectionSchema>;
export type PosterContent = z.infer<typeof posterSchema>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsePoster(raw: unknown): Parsed<PosterContent> {
  const r = posterSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
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
