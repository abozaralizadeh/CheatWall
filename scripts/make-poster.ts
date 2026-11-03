// Command line: topic in, PDF and PNG out. Uses the provider from .env (the fake by default).
// Usage: npm run poster -- "SQL" [--level student] [--theme paper] [--out out]
import fs from 'node:fs';
import path from 'node:path';
import { createProvider } from '../src/ai/index.ts';
import { loadConfig } from '../src/config.ts';
import { normalizeLevel, normalizeTopic, parsePoster, slugify } from '../src/content.ts';
import { ChromiumRenderer } from '../src/render/chromium.ts';
import { getTheme } from '../src/render/themes.ts';
import { loadEnvFile } from '../src/env.ts';

loadEnvFile();
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const topicArg = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')));

const config = loadConfig();
const topic = normalizeTopic(topicArg);
if (!topic.ok) { console.error(topic.error); process.exit(1); }
const level = normalizeLevel(flag('level'));
if (!level.ok) { console.error(level.error); process.exit(1); }
const theme = getTheme(flag('theme') ?? config.defaultTheme);
if (!theme) { console.error('Unknown theme'); process.exit(1); }
const outDir = path.resolve(flag('out') ?? 'out');
fs.mkdirSync(outDir, { recursive: true });

const provider = createProvider(config);
const check = await provider.checkTopic(topic.value, level.value);
if (!check.value.allowed) { console.error('Refused: ' + (check.value.reason ?? 'topic not allowed')); process.exit(2); }
const written = await provider.writePoster(topic.value, level.value);
const reviewed = await provider.reviewPoster(topic.value, level.value, written.value);
const parsed = parsePoster(reviewed.value);
if (!parsed.ok) { console.error('Provider returned bad content: ' + parsed.error); process.exit(3); }

const renderer = new ChromiumRenderer({ chromePath: config.chromePath, concurrency: 1, widthMm: config.posterWidthMm, heightMm: config.posterHeightMm });
try {
  const started = Date.now();
  const r = await renderer.render(parsed.value, theme);
  const base = path.join(outDir, `${slugify(topic.value)}-${theme.id}`);
  fs.writeFileSync(base + '.pdf', r.pdf);
  fs.writeFileSync(base + '.png', r.png);
  console.log(`${base}.pdf  pages=${r.pages} scale=${r.fit.scale.toFixed(2)} fill=${(r.fit.fill * 100).toFixed(0)}% fits=${r.fit.fits} ms=${Date.now() - started}`);
} finally {
  await renderer.close();
}
