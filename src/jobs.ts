import { costCents, type Config } from './config.ts';
import { parsePoster, type Level, type PosterContent } from './content.ts';
import { ProviderRefusal, type TextProvider, type Usage } from './ai/provider.ts';
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
export const MSG_NO_FIT = 'We could not fit this topic on one poster. Try a narrower topic. This one does not count toward your daily limit.';

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

  private validate(raw: unknown): PosterContent {
    const parsed = parsePoster(raw);
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
      this.guard();
      const check = await provider.checkTopic(row.topic, level);
      this.spend(id, check.usage);
      if (!check.value.allowed) {
        store.setStatus(id, 'refused', check.value.reason ?? 'We do not make posters for this topic.');
        log.info('topic refused', { id });
        return;
      }

      store.setStatus(id, 'writing');
      let content: PosterContent | null = null;
      for (let attempt = 0; attempt < 2 && !content; attempt++) {
        this.guard();
        const w = await provider.writePoster(row.topic, level);
        this.spend(id, w.usage);
        try {
          content = this.validate(w.value);
        } catch (err) {
          log.warn('written poster was invalid', { id, attempt, error: String(err) });
        }
      }
      if (!content) {
        store.setStatus(id, 'failed', MSG_BAD_CONTENT);
        return;
      }

      store.setStatus(id, 'reviewing');
      this.guard();
      try {
        const r = await provider.reviewPoster(row.topic, level, content);
        this.spend(id, r.usage);
        content = this.validate(r.value);
      } catch (err) {
        if (err instanceof ProviderRefusal) throw err;
        // A bad review must not lose a good poster. Keep the written version.
        log.warn('review result unusable, keeping the written poster', { id, error: String(err) });
      }

      const note = check.value.sensitive ? SENSITIVE_NOTES[check.value.sensitive] : null;
      content = { ...content, note: note ?? undefined };

      store.setStatus(id, 'rendering');
      const theme = getTheme(row.theme) ?? getTheme(config.defaultTheme)!;
      let result = await renderer.render(content, theme);
      for (let i = 0; i < 2 && !result.fit.fits; i++) {
        this.guard();
        const s = await provider.shortenPoster(row.topic, content, result.fit.overflow);
        this.spend(id, s.usage);
        content = { ...this.validate(s.value), note: note ?? undefined };
        result = await renderer.render(content, theme);
      }
      if (!result.fit.fits) {
        store.setStatus(id, 'failed', MSG_NO_FIT);
        log.warn('poster would not fit', { id });
        return;
      }

      writePosterFiles(config.posterDir, id, theme.id, result);
      store.setReady(id, content, note, provider.name);
      store.countPosterMade(this.now());
      log.info('poster ready', { id, ms: Date.now() - started, scale: Number(result.fit.scale.toFixed(2)), fill: Number(result.fit.fill.toFixed(2)), day: dayOf(this.now()) });
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
