import { createApp } from './app.ts';
import { createProvider } from './ai/index.ts';
import { loadConfig } from './config.ts';
import { loadEnvFile } from './env.ts';
import { createLogger } from './log.ts';
import { ChromiumRenderer, findChrome } from './render/chromium.ts';
import { Store } from './store.ts';

loadEnvFile();
const config = loadConfig();
const log = createLogger({ dir: config.logDir, maxBytes: config.logMaxBytes, keep: config.logKeep });
const store = new Store(config.dbPath);
const provider = createProvider(config);
const renderer = new ChromiumRenderer({ chromePath: config.chromePath, concurrency: config.renderConcurrency, widthMm: config.posterWidthMm, heightMm: config.posterHeightMm, log });
const app = createApp({ config, store, provider, renderer, log });

if (!findChrome(config.chromePath)) log.warn('no Chrome or Chromium found, posters will fail until CHROME_PATH is set or setup_service.sh has run');
if (config.provider === 'fake') log.warn('PROVIDER=fake: posters use local sample content, not real AI');

const port = await app.listen();
log.info('CheatWall listening', { host: config.host, port, provider: provider.name });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  await app.close();
  await renderer.close();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', { error: String(err) }));
