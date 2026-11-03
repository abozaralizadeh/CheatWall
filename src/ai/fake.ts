import type { Level, PosterContent } from '../content.ts';
import { genericPoster, sampleFor } from './fake-data.ts';
import { ProviderRefusal, type Result, type TextProvider, type TopicCheck, type Usage } from './provider.ts';

// Local stand-in for the AI. It makes no network calls and costs nothing.
// Posters are handwritten samples or a labelled placeholder, so poster quality and AI cost are NOT measured by it.
// Token counts are synthetic (about 4 characters per token) so the spend cap logic can be exercised.

const BLOCKED = [
  /\b(make|build|synthesi[sz]e|cook)\b.*\b(bomb|explosive|nerve agent|meth|methamphetamine)\b/i,
  /\b(ransomware|keylogger|malware)\b.*\b(write|build|make|create)\b/i,
  /\b(write|build|make|create)\b.*\b(ransomware|keylogger|malware)\b/i,
  /\bhow to (kill|poison|hurt) (a |an |my )?(person|someone|wife|husband|neighbou?r)\b/i,
  /\b(self[- ]harm|suicide method)/i,
];

const SENSITIVE: Array<[RegExp, NonNullable<TopicCheck['sensitive']>]> = [
  [/\b(medic\w*|disease|symptom\w*|pharmac\w*|dosage|nurs\w*|anatomy|diagnos\w*)\b/i, 'health'],
  [/\b(law|legal|contract|court|tenant|copyright)\b/i, 'legal'],
  [/\b(tax\w*|invest\w*|stocks?|loan|mortgage|crypto\w*|trading)\b/i, 'finance'],
];

function tokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

export class FakeProvider implements TextProvider {
  readonly name = 'fake-local';
  // Set to make writePoster return junk this many times first, to test the retry.
  invalidFirst = 0;
  calls = { check: 0, write: 0, review: 0, shorten: 0 };

  async checkTopic(topic: string, _level: Level | null): Promise<Result<TopicCheck>> {
    this.calls.check++;
    const usage: Usage = { inputTokens: 150 + tokens(topic), outputTokens: 40 };
    if (BLOCKED.some((re) => re.test(topic))) {
      return { value: { allowed: false, reason: 'We do not make posters for topics that could help someone get hurt. Try a different topic.' }, usage };
    }
    const hit = SENSITIVE.find(([re]) => re.test(topic));
    return { value: { allowed: true, sensitive: hit ? hit[1] : null }, usage };
  }

  async writePoster(topic: string, level: Level | null): Promise<Result<unknown>> {
    this.calls.write++;
    if (this.invalidFirst > 0) {
      this.invalidFirst--;
      return { value: { title: topic }, usage: { inputTokens: 600, outputTokens: 20 } };
    }
    const content: PosterContent = structuredClone(sampleFor(topic) ?? genericPoster(topic, level));
    return { value: content, usage: { inputTokens: 600 + tokens(topic), outputTokens: tokens(content) } };
  }

  async reviewPoster(_topic: string, _level: Level | null, content: unknown): Promise<Result<unknown>> {
    this.calls.review++;
    return { value: structuredClone(content), usage: { inputTokens: 400 + tokens(content), outputTokens: tokens(content) } };
  }

  async shortenPoster(_topic: string, content: unknown, overflow: number): Promise<Result<unknown>> {
    this.calls.shorten++;
    const c = structuredClone(content) as PosterContent;
    if (!c || !Array.isArray(c.sections)) throw new ProviderRefusal('Nothing to shorten.');
    // Trim the longest section by about the overflow, or drop the last section if the poster is already small.
    const cut = Math.max(1, Math.ceil((overflow - 1) * 6));
    for (let i = 0; i < cut; i++) {
      let longest = -1;
      let longestLen = 2;
      c.sections.forEach((s, idx) => {
        const len = 'items' in s ? s.items.length : s.kind === 'table' ? s.rows.length : 0;
        if (len > longestLen) { longest = idx; longestLen = len; }
      });
      if (longest === -1) break;
      const s = c.sections[longest]!;
      if ('items' in s) s.items.pop();
      else if (s.kind === 'table') s.rows.pop();
    }
    if (c.sections.length > 4 && overflow > 1.5) c.sections.pop();
    return { value: c, usage: { inputTokens: 300 + tokens(c), outputTokens: tokens(c) } };
  }
}
