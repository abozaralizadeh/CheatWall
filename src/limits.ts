import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import { dayOf, type Store } from './store.ts';

// Random secret, made once and kept in the data folder. It is never in the repo.
export function loadSecret(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret + '\n', { mode: 0o600 });
    return secret;
  }
}

// A visitor is a salted hash of the IP address plus the day. The hash changes every day, so nothing links days together.
export function visitorHash(secret: string, ip: string, now: Date): string {
  return crypto.createHmac('sha256', `${secret}:${dayOf(now)}`).update(ip).digest('hex').slice(0, 32);
}

export const MSG_FULL = 'CheatWall is full for today. Come back tomorrow, it resets at midnight UTC.';

// True when any site-wide daily cap is used up: money, tokens or AI requests. Checked before every AI call.
export function dailyCapReached(store: Store, config: Config, now: Date): boolean {
  const u = store.dayUsage(now);
  return u.costCents >= config.dailyCapCents || u.tokens >= config.dailyTokenBudget || u.requests >= config.dailyRequestCap;
}

export type CreateCheck =
  | { ok: true }
  | { ok: false; code: 'visitor_limit' | 'attempt_limit' | 'daily_cap'; message: string };

export function checkCanCreate(store: Store, config: Config, visitor: string, now: Date): CreateCheck {
  if (dailyCapReached(store, config, now)) {
    return { ok: false, code: 'daily_cap', message: MSG_FULL };
  }
  const v = store.visitorToday(visitor, now);
  if (v.counted >= config.postersPerVisitorPerDay) {
    return { ok: false, code: 'visitor_limit', message: `You have made ${config.postersPerVisitorPerDay} posters today. Come back tomorrow, it resets at midnight UTC.` };
  }
  if (v.attempts >= config.attemptsPerVisitorPerDay) {
    return { ok: false, code: 'attempt_limit', message: 'That is a lot of tries for one day. Please come back tomorrow.' };
  }
  return { ok: true };
}
