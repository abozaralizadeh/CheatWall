import { costCents, type Config } from './config.ts';
import { parsePoster, repairPoster, type Level, type PosterContent } from './content.ts';
import { OutputCutOff, ProviderRefusal, type Result, type TextProvider, type Usage } from './ai/provider.ts';
import { writePosterFiles } from './files.ts';
import { dailyCapReached, MSG_FULL } from './limits.ts';
import type { Logger } from './log.ts';
import type { PosterRenderer } from './render/renderer.ts';
import { getTheme } from './render/themes.ts';
import { dayOf, type PosterRow, type Store } from './store.ts';

export const SENSITIVE_NOTES = {
  health: 'Health topic. This is study material, not medical advice. Ask a qualified professional about real situations.',
  legal: 'Legal topic. This is study material, not legal advice. Laws differ by place and change over time.',
  finance: 'Money topic. This is study material, not financial advice. Check current rules and talk to a professional.',
} as const;

export const MSG_FAILED = 'Something went wrong on our side. Try again. This one does not count toward your daily limit.';
export { MSG_FULL };
export const MSG_BAD_CONTENT = 'The AI gave us something we could not turn into a poster. Try again. This one does not count toward your daily limit.';
export const MSG_NO_FIT = 'This topic is too big even for our biggest poster. Try a narrower topic. This one does not count toward your daily limit.';

export interface JobDeps {
  config: Config;
  store: Store;
  provider: TextProvider;
  renderer: PosterRenderer;
  log: Logger;
  now?: () => Date;
}

class BadContent extends Error {}
class CapReached extends Error {}

export class JobRunner {
  private d: JobDeps;
  private inFlight = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(deps: JobDeps) {
    this.d = deps;
  }

  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }

  start(): void {
    const n = this.d.store.requeueUnfinished();
    if (n > 0) this.d.log.info('requeued unfinished posters after restart', { count: n });
    this.timer = setInterval(() => this.pump(), 500);
    this.timer.unref();
    this.pump();
  }

  // Take queued posters until the concurrency limit is reached.
  pump(): void {
    if (this.stopped) return;
    while (this.inFlight.size < this.d.config.jobConcurrency) {
      const row = this.d.store.claimNext();
      if (!row) return;
      const p: Promise<void> = this.process(row)
        .catch((err) => this.d.log.error('job crashed', { id: row.id, error: String(err) }))
        .finally(() => {
          this.inFlight.delete(p);
          this.pump();
        });
      this.inFlight.add(p);
    }
  }

  // Wait until nothing is queued or running. Used by tests.
  async idle(): Promise<void> {
    for (;;) {
      this.pump();
      if (this.inFlight.size === 0) {
        const c = this.d.store.counts();
        if (!c.queued) return;
      }
      await Promise.race([...this.inFlight, new Promise((r) => setTimeout(r, 20))]);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.inFlight]);
  }

  // Called right before every AI call, so a job that is already running stops as soon as a daily cap is spent.
  private guard(): void {
    if (dailyCapReached(this.d.store, this.d.config, this.now())) throw new CapReached();
  }

  private spend(id: string, u: Usage): void {
    const { config, store } = this.d;
    store.addUsage(id, u.inputTokens, u.outputTokens, costCents(config, u.inputTokens, u.outputTokens), this.now());
  }

  // Every AI call goes through here: the caps are checked first and the tokens are counted even when the answer
  // was cut off.
  private async ask<T>(id: string, call: () => Promise<Result<T>>): Promise<Result<T>> {
    this.guard();
    try {
      const r = await call();
      this.spend(id, r.usage);
      return r;
    } catch (err) {
      if (err instanceof OutputCutOff) this.spend(id, err.usage);
      throw err;
    }
  }

  // Repairs what can be repaired in code, then checks the result. Throws BadContent with the exact problems left.
  private accept(id: string, raw: unknown, step: string): PosterContent {
    const fixed = repairPoster(raw);
    if (fixed.fixes.length) this.d.log.info('repaired poster content', { id, step, fixes: fixed.fixes.length, sample: fixed.fixes.slice(0, 5) });
    const parsed = parsePoster(fixed.value);
    if (!parsed.ok) throw new BadContent(parsed.error);
    return parsed.value;
  }

  private async process(row: PosterRow): Promise<void> {
    const { config, store, provider, renderer, log } = this.d;
    const id = row.id;
    const level = row.level as Level | null;
    const started = Date.now();
    try {
      store.setStatus(id, 'checking');
      const check = await this.ask(id, () => provider.checkTopic(row.topic, level));
      if (!check.value.allowed) {
        store.setStatus(id, 'refused', check.value.reason ?? 'We do not make posters for this topic.');
        log.info('topic refused', { id });
        return;
      }

      // One write, and at most one retry that is told exactly what was wrong.
      store.setStatus(id, 'writing');
      let content: PosterContent | null = null;
      let problems: string | undefined;
      for (let attempt = 0; attempt < 2 && !content; attempt++) {
        try {
          const w = await this.ask(id, () => provider.writePoster(row.topic, level, problems));
          content = this.accept(id, w.value, 'write');
        } catch (err) {
          if (err instanceof BadContent) problems = err.message;
          else if (err instanceof OutputCutOff) problems = 'The answer was cut off because it was too long. Write less: shorter lines, fewer rows, and no more than 16 sections.';
          else throw err;
          log.warn('written poster was invalid', { id, attempt, error: problems });
        }
      }
      if (!content) {
        store.setStatus(id, 'failed', MSG_BAD_CONTENT);
        return;
      }

      store.setStatus(id, 'reviewing');
      try {
        const r = await this.ask(id, () => provider.reviewPoster(row.topic, level, content));
        content = this.accept(id, r.value, 'review');
      } catch (err) {
        if (err instanceof ProviderRefusal || err instanceof CapReached) throw err;
        // A bad review must not lose a good poster. Keep the written version.
        log.warn('review result unusable, keeping the written poster', { id, error: String(err) });
      }

      const note = check.value.sensitive ? SENSITIVE_NOTES[check.value.sensitive] : null;
      content = { ...content, note: note ?? undefined };

      // The renderer grows the sheet (more columns, then A1, then A0) before it gives up. Only when even the
      // biggest sheet is too small do we ask the AI to cut, once.
      store.setStatus(id, 'rendering');
      const theme = getTheme(row.theme) ?? getTheme(config.defaultTheme)!;
      let result = await renderer.render(content, theme);
      if (!result.fit.fits) {
        try {
          const s = await this.ask(id, () => provider.shortenPoster(row.topic, content, result.fit.overflow));
          const shorter = { ...this.accept(id, s.value, 'shorten'), note: note ?? undefined };
          const again = await renderer.render(shorter, theme);
          if (again.fit.fits) { content = shorter; result = again; }
        } catch (err) {
          if (!(err instanceof BadContent || err instanceof OutputCutOff)) throw err;
          log.warn('shortened poster was unusable', { id, error: String(err) });
        }
      }
      if (!result.fit.fits) {
        store.setStatus(id, 'failed', MSG_NO_FIT);
        log.warn('poster would not fit even on the biggest sheet', { id, sheet: result.sheet.id, overflow: Number(result.fit.overflow.toFixed(2)) });
        return;
      }

      writePosterFiles(config.posterDir, id, theme.id, result);
      store.setReady(id, content, note, provider.name, result.sheet.id);
      store.countPosterMade(this.now());
      log.info('poster ready', { id, ms: Date.now() - started, sheet: result.sheet.id, sections: content.sections.length, scale: Number(result.fit.scale.toFixed(2)), fill: Number(result.fit.fill.toFixed(2)), day: dayOf(this.now()) });
    } catch (err) {
      if (err instanceof CapReached) {
        store.setStatus(id, 'failed', MSG_FULL);
        log.warn('daily cap reached, job stopped', { id });
        return;
      }
      if (err instanceof ProviderRefusal) {
        store.setStatus(id, 'refused', err.message);
        log.info('provider declined', { id });
        return;
      }
      log.error('poster failed', { id, error: String(err) });
      store.setStatus(id, 'failed', MSG_FAILED);
    }
  }
}
