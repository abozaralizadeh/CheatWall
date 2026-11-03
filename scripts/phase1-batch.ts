// Batch run: ten different topics through the whole pipeline pieces (check, write, review, render), timed.
// With the fake provider this measures layout and speed only. Poster quality and AI cost stay unmeasured.
import fs from 'node:fs';
import path from 'node:path';
import { createProvider } from '../src/ai/index.ts';
import { costCents, loadConfig } from '../src/config.ts';
import { parsePoster, slugify } from '../src/content.ts';
import { loadEnvFile } from '../src/env.ts';
import { ChromiumRenderer } from '../src/render/chromium.ts';
import { getTheme } from '../src/render/themes.ts';

loadEnvFile();
const config = loadConfig();
const provider = createProvider(config);
const topics = ['Organic chemistry', 'Spanish verbs', 'SQL', 'French Revolution', 'Music theory', 'Linear algebra', 'Human anatomy', 'Tax basics', 'Python decorators', 'World War II timeline'];
const out = path.resolve('out/phase1');
fs.mkdirSync(out, { recursive: true });
const renderer = new ChromiumRenderer({ chromePath: config.chromePath, concurrency: 1, widthMm: config.posterWidthMm, heightMm: config.posterHeightMm });
const theme = getTheme(config.defaultTheme)!;
const rows: string[] = [];
try {
  for (const topic of topics) {
    const t0 = Date.now();
    const check = await provider.checkTopic(topic, null);
    if (!check.value.allowed) { rows.push(`| ${topic} | refused | | | | | |`); continue; }
    const w = await provider.writePoster(topic, null);
    const r = await provider.reviewPoster(topic, null, w.value);
    const parsed = parsePoster(r.value);
    if (!parsed.ok) { rows.push(`| ${topic} | invalid: ${parsed.error} | | | | | |`); continue; }
    const res = await renderer.render(parsed.value, theme);
    fs.writeFileSync(path.join(out, `${slugify(topic)}.pdf`), res.pdf);
    fs.writeFileSync(path.join(out, `${slugify(topic)}.png`), res.png);
    const inTok = check.usage.inputTokens + w.usage.inputTokens + r.usage.inputTokens;
    const outTok = check.usage.outputTokens + w.usage.outputTokens + r.usage.outputTokens;
    const ms = Date.now() - t0;
    rows.push(`| ${topic} | ${res.fit.fits && res.pages === 1 ? 'ok' : 'PROBLEM'} | ${res.pages} | ${res.fit.scale.toFixed(2)} | ${(res.fit.fill * 100).toFixed(0)}% | ${(ms / 1000).toFixed(1)} s | ${costCents(config, inTok, outTok).toFixed(1)} |`);
    console.log(rows.at(-1));
  }
} finally {
  await renderer.close();
}
const report = `# Ten-topic fit test (local fake provider)

Provider: \`${provider.name}\`. Run: ${new Date().toISOString().slice(0, 10)}. Theme: ${theme.id}. Page: ${config.posterWidthMm} x ${config.posterHeightMm} mm.

**What this shows:** layout, fitting and render speed on ten different topics.
**What it does not show:** real AI poster quality, real AI cost, or real AI time. The fake writes handwritten samples and a labelled placeholder poster. The "synthetic cents" column is made up from text length at the configured prices and must not be read as a measured cost.

| Topic | Result | PDF pages | Text scale | Page filled | Time | Synthetic cents |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
fs.writeFileSync(path.resolve('docs/PHASE1-RESULTS.md'), report);
console.log('wrote docs/PHASE1-RESULTS.md');
