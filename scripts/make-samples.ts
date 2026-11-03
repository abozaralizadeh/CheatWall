// Makes the three small example posters shown on the home page. Uses the fake provider, so they are test posters.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { orgChemPoster, spanishPoster, sqlPoster } from '../src/ai/fake-data.ts';
import { ChromiumRenderer } from '../src/render/chromium.ts';
import { getTheme } from '../src/render/themes.ts';

const config = loadConfig();
const out = path.resolve('public/assets/samples');
fs.mkdirSync(out, { recursive: true });
const renderer = new ChromiumRenderer({ chromePath: config.chromePath, concurrency: 1, widthMm: config.posterWidthMm, heightMm: config.posterHeightMm, pngScale: 0.3 });
try {
  for (const [name, content, theme] of [['sql', sqlPoster, 'paper'], ['spanish', spanishPoster, 'midnight'], ['chemistry', orgChemPoster, 'sunrise']] as const) {
    const r = await renderer.render(content, getTheme(theme)!);
    fs.writeFileSync(path.join(out, `${name}.png`), r.png);
    console.log(name, theme, `${(r.png.length / 1024).toFixed(0)} KB`, `pages=${r.pages}`, `fill=${r.fit.fill.toFixed(2)}`);
  }
} finally {
  await renderer.close();
}
