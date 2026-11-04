import path from 'node:path';

// Every default lives here, so changing one is a single env var.
export interface Config {
  port: number;
  host: string;
  trustProxy: boolean;
  // When not empty, X-Forwarded-For is read only from these addresses (e.g. 127.0.0.1 for a local nginx).
  trustedProxies: string[];
  // Where the site lives in the browser, always with a slash at both ends: "/" or "/cheatwall/".
  basePath: string;
  dataDir: string;
  logDir: string;
  dbPath: string;
  posterDir: string;
  secretPath: string;
  publicDir: string;
  provider: 'fake' | 'anthropic' | 'azure';
  anthropicApiKey: string;
  model: string;
  azure: AzureTarget;
  azureFallback: AzureTarget;
  azureApiVersion: string;
  priceInputCentsPerMTok: number;
  priceOutputCentsPerMTok: number;
  dailyCapCents: number;
  dailyTokenBudget: number;
  dailyRequestCap: number;
  // Output limit for one poster call (write, review, shorten). The daily caps still apply on top.
  maxOutputTokens: number;
  postersPerVisitorPerDay: number;
  attemptsPerVisitorPerDay: number;
  retentionDays: number;
  purgeAfterExpiryDays: number;
  jobConcurrency: number;
  renderConcurrency: number;
  defaultTheme: string;
  posterWidthMm: number;
  posterHeightMm: number;
  // How many ISO sizes up a poster may grow when it does not fit: 2 lets an A2 become A1 or A0.
  posterGrowSteps: number;
  chromePath: string;
  logMaxBytes: number;
  logKeep: number;
}

export interface AzureTarget {
  endpoint: string;
  apiKey: string;
  deployment: string;
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
  if (provider !== 'fake' && provider !== 'anthropic' && provider !== 'azure') {
    throw new Error(`PROVIDER must be "fake", "anthropic" or "azure", got "${provider}"`);
  }
  const trust = (env.TRUST_PROXY || '').trim();
  const trustedProxies = trust && trust !== 'true' && trust !== 'false' ? trust.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return {
    port: num(env, 'PORT', 3000),
    host: env.HOST || '127.0.0.1',
    trustProxy: trust === 'true' || trustedProxies.length > 0,
    trustedProxies,
    basePath: normalizeBasePath(env.BASE_PATH),
    dataDir,
    logDir: path.resolve(root, env.LOG_DIR || './logs'),
    dbPath: path.join(dataDir, 'cheatwall.db'),
    posterDir: path.join(dataDir, 'posters'),
    secretPath: path.join(dataDir, '.secret'),
    publicDir: path.resolve(root, 'public'),
    provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-opus-5-5',
    azure: { endpoint: env.AZURE_OPENAI_ENDPOINT || '', apiKey: env.AZURE_OPENAI_API_KEY || '', deployment: env.AZURE_OPENAI_DEPLOYMENT || '' },
    azureFallback: { endpoint: env.FALLBACK_AZURE_OPENAI_ENDPOINT || '', apiKey: env.FALLBACK_AZURE_OPENAI_API_KEY || '', deployment: env.FALLBACK_AZURE_OPENAI_DEPLOYMENT || '' },
    azureApiVersion: env.AZURE_OPENAI_API_VERSION || '',
    priceInputCentsPerMTok: num(env, 'PRICE_INPUT_CENTS_PER_MTOK', 400),
    priceOutputCentsPerMTok: num(env, 'PRICE_OUTPUT_CENTS_PER_MTOK', 2000),
    dailyCapCents: num(env, 'DAILY_CAP_CENTS', 500),
    dailyTokenBudget: num(env, 'DAILY_TOKEN_BUDGET', 2_000_000),
    dailyRequestCap: num(env, 'DAILY_REQUEST_CAP', 300),
    maxOutputTokens: num(env, 'AI_MAX_OUTPUT_TOKENS', 32_000),
    postersPerVisitorPerDay: num(env, 'POSTERS_PER_VISITOR_PER_DAY', 3),
    attemptsPerVisitorPerDay: num(env, 'ATTEMPTS_PER_VISITOR_PER_DAY', 15),
    retentionDays: num(env, 'RETENTION_DAYS', 30),
    purgeAfterExpiryDays: 60,
    jobConcurrency: num(env, 'JOB_CONCURRENCY', 2),
    renderConcurrency: num(env, 'RENDER_CONCURRENCY', 2),
    defaultTheme: env.DEFAULT_THEME || 'paper',
    posterWidthMm: num(env, 'POSTER_WIDTH_MM', 420),
    posterHeightMm: num(env, 'POSTER_HEIGHT_MM', 594),
    posterGrowSteps: Math.max(0, Math.min(3, Math.round(num(env, 'POSTER_GROW_STEPS', 2)))),
    chromePath: env.CHROME_PATH || '',
    logMaxBytes: num(env, 'LOG_MAX_BYTES', 10 * 1024 * 1024),
    logKeep: num(env, 'LOG_KEEP', 5),
  };
}

export function normalizeBasePath(raw: string | undefined): string {
  const parts = (raw || '/').split('/').filter(Boolean);
  if (parts.some((p) => !/^[A-Za-z0-9._~-]+$/.test(p) || p === '.' || p === '..')) throw new Error(`BASE_PATH must be a plain path like /cheatwall/, got "${raw}"`);
  return parts.length ? `/${parts.join('/')}/` : '/';
}

export function costCents(config: Pick<Config, 'priceInputCentsPerMTok' | 'priceOutputCentsPerMTok'>, inputTokens: number, outputTokens: number): number {
  return (inputTokens * config.priceInputCentsPerMTok + outputTokens * config.priceOutputCentsPerMTok) / 1_000_000;
}
