import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fonts and KaTeX styles are inlined as data: URIs, so rendering never needs the network.
// Inter and JetBrains Mono are SIL Open Font License (via @fontsource-variable). KaTeX fonts are MIT/OFL.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const nm = (...p: string[]) => path.join(root, 'node_modules', ...p);

const b64 = (file: string) => fs.readFileSync(file).toString('base64');

let fontCss: string | undefined;
let katexCss: string | undefined;

export function baseFontCss(): string {
  if (fontCss) return fontCss;
  const inter = b64(nm('@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'));
  const mono = b64(nm('@fontsource-variable', 'jetbrains-mono', 'files', 'jetbrains-mono-latin-wght-normal.woff2'));
  fontCss =
    `@font-face{font-family:"Inter Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${inter}) format("woff2");}` +
    `@font-face{font-family:"JetBrains Mono Variable";font-style:normal;font-weight:100 800;src:url(data:font/woff2;base64,${mono}) format("woff2");}`;
  return fontCss;
}

export function katexFontCss(): string {
  if (katexCss) return katexCss;
  const dist = nm('katex', 'dist');
  const css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
  // Keep only the woff2 file for each face and inline it.
  katexCss = css.replace(/src:url\(fonts\/([A-Za-z0-9_-]+)\.woff2\)[^;}]*/g, (_m, name: string) => {
    return `src:url(data:font/woff2;base64,${b64(path.join(dist, 'fonts', `${name}.woff2`))}) format("woff2")`;
  });
  return katexCss;
}
