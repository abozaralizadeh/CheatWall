import path from 'node:path';

// Every default lives here, so changing one is a single env var.
export interface Config {
  port: number;
  host: string;
  trustProxy: boolean;
  dataDir: string;
  logDir: string;
  dbPath: string;
  posterDir: string;
  secretPath: string;
  publicDir: string;
  provider: 'fake' | 'anthropic';
  anthropicApiKey: string;
  model: string;
  priceInputCentsPerMTok: number;
  priceOutputCentsPerMTok: number;
  dailyCapCents: number;
  postersPerVisitorPerDay: number;
  attemptsPerVisitorPerDay: number;
  retentionDays: number;
  purgeAfterExpiryDays: number;
  jobConcurrency: number;
  renderConcurrency: number;
  defaultTheme: string;
  posterWidthMm: number;
  posterHeightMm: number;
  chromePath: string;
  logMaxBytes: number;
  logKeep: number;
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): Config {
  const dataDir = path.resolve(root, env.DATA_DIR || './data');
  const provider = env.PROVIDER || 'fake';
  if (provider !== 'fake' && provider !== 'anthropic') {
    throw new Error(`PROVIDER must be "fake" or "anthropic", got "${provider}"`);
  }
  return {
    port: num(env, 'PORT', 3000),
    host: env.HOST || '127.0.0.1',
    trustProxy: env.TRUST_PROXY === 'true',
    dataDir,
    logDir: path.resolve(root, env.LOG_DIR || './logs'),
    dbPath: path.join(dataDir, 'cheatwall.db'),
    posterDir: path.join(dataDir, 'posters'),
    secretPath: path.join(dataDir, '.secret'),
    publicDir: path.resolve(root, 'public'),
    provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-opus-5-5',
    priceInputCentsPerMTok: num(env, 'PRICE_INPUT_CENTS_PER_MTOK', 400),
    priceOutputCentsPerMTok: num(env, 'PRICE_OUTPUT_CENTS_PER_MTOK', 2000),
    dailyCapCents: num(env, 'DAILY_CAP_CENTS', 500),
    postersPerVisitorPerDay: num(env, 'POSTERS_PER_VISITOR_PER_DAY', 3),
    attemptsPerVisitorPerDay: num(env, 'ATTEMPTS_PER_VISITOR_PER_DAY', 15),
    retentionDays: num(env, 'RETENTION_DAYS', 30),
    purgeAfterExpiryDays: 60,
    jobConcurrency: num(env, 'JOB_CONCURRENCY', 2),
    renderConcurrency: num(env, 'RENDER_CONCURRENCY', 2),
    defaultTheme: env.DEFAULT_THEME || 'paper',
    posterWidthMm: num(env, 'POSTER_WIDTH_MM', 420),
    posterHeightMm: num(env, 'POSTER_HEIGHT_MM', 594),
    chromePath: env.CHROME_PATH || '',
    logMaxBytes: num(env, 'LOG_MAX_BYTES', 10 * 1024 * 1024),
    logKeep: num(env, 'LOG_KEEP', 5),
  };
}

export function costCents(config: Pick<Config, 'priceInputCentsPerMTok' | 'priceOutputCentsPerMTok'>, inputTokens: number, outputTokens: number): number {
  return (inputTokens * config.priceInputCentsPerMTok + outputTokens * config.priceOutputCentsPerMTok) / 1_000_000;
}
