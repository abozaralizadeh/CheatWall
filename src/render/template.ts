import katex from 'katex';
import type { PosterContent, Section } from '../content.ts';
import { esc } from './escape.ts';
import { baseFontCss, katexFontCss } from './fonts.ts';
import { MIN_SCALE } from './sheets.ts';
import { themeCss, type Theme } from './themes.ts';

// Turns poster content into one HTML page. Rules that keep it safe:
// - every piece of text from the AI goes through esc(), the AI never supplies HTML or CSS
// - KaTeX output is the only HTML we trust, and it runs with trust turned off
// - the page carries a CSP: no network at all, and no scripts in the final render

export { MIN_SCALE };
export const MAX_SCALE = 1.7;
export const BASE_GAP_EM = 0.9;
export const MAX_GAP_EM = 3.4;

export const AI_NOTE = 'Made with AI. It can contain mistakes, so check anything important before you rely on it.';
export const BRAND = 'CheatWall';

export interface BuildOptions {
  theme: Theme;
  widthMm: number;
  heightMm: number;
  // Text columns on the sheet. Bigger sheets get more.
  columns?: number;
  // measure mode: the smallest text size allowed on this sheet
  minScale?: number;
  mode: 'measure' | 'final';
  // measure mode: how much to back off the best-fit size, to leave room for print differences
  shrink?: number;
  // final mode: the size and gap the measure step found
  scale?: number;
  gap?: number;
  // final mode: text size for each table, in em, found by the measure step
  tableFonts?: number[];
  // final mode: tables that may break inside long words, found by the measure step
  tableWrap?: boolean[];
}

function math(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, output: 'html', trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20, displayMode: false });
  } catch {
    return esc(latex);
  }
}

function section(s: Section, index: number, tableAttrs: () => string): string {
  const cls = `sec k-${s.kind} c${index % 4}`;
  const head = `<h2>${esc(s.heading)}</h2>`;
  switch (s.kind) {
    case 'points':
      return `<section class="${cls}">${head}<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`;
    case 'steps':
      return `<section class="${cls}">${head}<ol>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol></section>`;
    case 'definitions':
      return `<section class="${cls}">${head}<dl>${s.items.map((i) => `<dt>${esc(i.term)}</dt><dd>${esc(i.meaning)}</dd>`).join('')}</dl></section>`;
    case 'table':
      return `<section class="${cls}">${head}<table${tableAttrs()}><thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></section>`;
    case 'formulas':
      return `<section class="${cls}">${head}<div class="formulas">${s.items
        .map((i) => `<div class="formula"><div class="eq">${math(i.latex)}</div><div class="cap">${esc(i.caption)}</div></div>`)
        .join('')}</div></section>`;
    case 'code':
      return `<section class="${cls}">${head}<pre><code>${esc(s.code)}</code></pre><div class="lang">${esc(s.language)}</div></section>`;
  }
}

const CSS = (w: number, h: number, cols: number) => `
@page{size:${w}mm ${h}mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.poster{width:${w}mm;height:${h}mm;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);
  font-family:"Inter Variable",system-ui,sans-serif;font-size:calc(22px * var(--s));line-height:1.35;overflow:hidden}
.head{background:var(--head-bg);color:var(--head-ink);padding:13mm 14mm 10mm}
.head h1{margin:0;font-size:3.7em;line-height:1.04;font-weight:800;letter-spacing:-.02em}
.head p{margin:.45em 0 0;font-size:1.35em;font-weight:500}
.main{flex:1 1 auto;min-height:0;padding:9mm 14mm 3mm;column-count:${cols};column-gap:1.5em;column-fill:balance;overflow:hidden}
.sec{break-inside:avoid;margin:0 0 var(--gap);background:var(--card);border:1px solid var(--rule);border-top:.35em solid var(--c);
  border-radius:.55em;padding:.75em 1em .95em}
.c0{--c:var(--c0)}.c1{--c:var(--c1)}.c2{--c:var(--c2)}.c3{--c:var(--c3)}
.sec h2{margin:0 0 .5em;font-size:1.3em;line-height:1.2;font-weight:750}
ul,ol,dl{margin:0;padding:0}
ul{list-style:none}
ul li{position:relative;padding-left:1.2em;margin:.38em 0}
ul li::before{content:"";position:absolute;left:.1em;top:.52em;width:.5em;height:.5em;border-radius:50%;background:var(--c)}
ol{list-style:none;counter-reset:step}
ol li{position:relative;counter-increment:step;padding-left:2em;margin:.5em 0;min-height:1.5em}
ol li::before{content:counter(step);position:absolute;left:0;top:.02em;width:1.4em;height:1.4em;border-radius:50%;background:var(--c);
  color:var(--on-accent);font-weight:700;font-size:.85em;line-height:1.4em;text-align:center}
dt{font-weight:700;margin-top:.5em}
dd{margin:.05em 0 0}
table{width:100%;border-collapse:collapse;font-size:.92em}
th{background:var(--head-bg);color:var(--head-ink);text-align:left;font-weight:650;padding:.3em .45em}
td{padding:.28em .45em;border-bottom:1px solid var(--rule);vertical-align:top}
table.wrap th,table.wrap td{overflow-wrap:anywhere}
tbody tr:nth-child(even) td{background:var(--stripe)}
pre{margin:0;background:var(--code-bg);color:var(--code-ink);border-radius:.4em;padding:.6em .8em;overflow:hidden}
code{font-family:"JetBrains Mono Variable",ui-monospace,monospace;font-size:.82em;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.lang{margin-top:.3em;font-size:.72em;color:var(--muted);text-align:right;text-transform:uppercase;letter-spacing:.08em}
.formula{margin:.5em 0}
.eq{font-size:1.15em;overflow:hidden}
.cap{font-size:.85em;color:var(--muted)}
.foot{padding:3mm 14mm 9mm;font-size:.78em;color:var(--muted);display:flex;justify-content:space-between;align-items:flex-end;gap:2em}
.foot .notes{flex:1}
.foot .extra{margin:0 0 .5em;padding:.4em .7em;border:1px solid var(--rule);border-left:.3em solid var(--c1);background:var(--card);color:var(--ink);border-radius:.3em}
.foot .brand{font-weight:700;white-space:nowrap}
.foot p{margin:0}
`;

// Runs in a page with network blocked. Finds the biggest text size, then the widest gap, where nothing spills into a 4th column.
const FIT_SCRIPT = (shrink: number, minScale: number) => `
(function(){
  var MIN=${minScale},MAX=${MAX_SCALE},G0=${BASE_GAP_EM},GMAX=${MAX_GAP_EM},SHRINK=${shrink};
  var root=document.querySelector('.poster'),main=document.querySelector('.main');
  // Each table gets the biggest text size (down to TMIN) at which it stays inside its card, so one table with long words
  // does not force the whole poster to shrink.
  var TBASE=0.92,TMIN=0.6;
  function tableOut(t){
    var sec=t.closest('.sec'),cs=getComputedStyle(sec);
    return t.getBoundingClientRect().right>sec.getBoundingClientRect().right-parseFloat(cs.paddingRight)+1;
  }
  // A table that still spills at the smallest size may break inside long words, so it always fits its card.
  function sizeTables(){
    var fonts=[],wraps=[];
    main.querySelectorAll('.sec table').forEach(function(t){
      var fs=TBASE;t.classList.remove('wrap');t.style.fontSize=fs+'em';
      while(tableOut(t)&&fs>TMIN+0.001){fs=Math.round((fs-0.04)*100)/100;t.style.fontSize=fs+'em';}
      var w=tableOut(t);if(w)t.classList.add('wrap');
      fonts.push(fs);wraps.push(w);
    });
    tableWrap=wraps;
    return fonts;
  }
  var tableFonts=[],tableWrap=[],cur=MIN;
  function set(s,g){cur=s;root.style.setProperty('--s',String(s));root.style.setProperty('--gap',g+'em');tableFonts=sizeTables();}
  // Tables, code and formulas must stay inside their card. A table with a long word in a narrow column spills out otherwise.
  function wide(){
    var els=main.querySelectorAll('.sec table,.sec pre,.sec .eq');
    for(var i=0;i<els.length;i++){
      var sec=els[i].closest('.sec'),cs=getComputedStyle(sec);
      var limit=sec.getBoundingClientRect().right-parseFloat(cs.paddingRight);
      if(els[i].getBoundingClientRect().right>limit+1||els[i].scrollWidth>els[i].clientWidth+1&&els[i].tagName!=='TABLE')return true;
    }
    return false;
  }
  // A card taller than a column gets broken across two columns. That reads badly, so it counts as not fitting.
  function split(){
    var secs=main.querySelectorAll('.sec');
    for(var i=0;i<secs.length;i++){if(secs[i].getClientRects().length>1)return true;}
    return false;
  }
  // Breaking words is a last resort: above the smallest size, a table that needs it counts as not fitting.
  function broken(){return cur>MIN+0.0001&&tableWrap.some(function(w){return w;});}
  function over(){return main.scrollWidth>main.clientWidth+2||wide()||split()||broken();}
  function fill(){
    var cs=getComputedStyle(main),pt=parseFloat(cs.paddingTop),pb=parseFloat(cs.paddingBottom);
    var top=main.getBoundingClientRect().top+pt,bottom=top;
    main.querySelectorAll('.sec').forEach(function(el){var r=el.getBoundingClientRect();if(r.bottom>bottom)bottom=r.bottom;});
    return (bottom-top)/(main.clientHeight-pt-pb);
  }
  function run(){
    var lo=MIN,hi=MAX,fits=true,scale;
    set(MAX,G0);
    if(!over()){scale=MAX;}
    else{
      set(MIN,G0);
      if(over()){fits=false;scale=MIN;}
      else{for(var i=0;i<14;i++){var mid=(lo+hi)/2;set(mid,G0);if(over())hi=mid;else lo=mid;}scale=lo;}
    }
    var overflow=1;
    if(!fits){set(MIN,G0);overflow=main.scrollWidth/main.clientWidth;}
    scale=scale*SHRINK;
    set(scale,G0);
    var gap=G0;
    if(fits&&fill()<0.97){
      var glo=G0,ghi=GMAX;
      for(var j=0;j<12;j++){var gm=(glo+ghi)/2;set(scale,gm);if(over())ghi=gm;else glo=gm;}
      gap=glo*0.98;
      set(scale,gap);
    }
    window.__fit={fits:fits&&!over(),scale:scale,gap:gap,fill:fits?fill():1,overflow:overflow,tableFonts:tableFonts,tableWrap:tableWrap};
  }
  function go(){void root.offsetHeight;document.fonts.ready.then(function(){run();});}
  if(document.readyState==='complete')go();else window.addEventListener('load',go);
})();
`;

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function buildPosterHtml(content: PosterContent, opts: BuildOptions): string {
  const hasFormulas = content.sections.some((s) => s.kind === 'formulas');
  const script = opts.mode === 'measure' ? `<script>${FIT_SCRIPT(opts.shrink ?? 0.985, clampNum(opts.minScale, 0.3, MAX_SCALE, MIN_SCALE))}</script>` : '';
  const cols = Math.round(clampNum(opts.columns, 1, 8, 3));
  const csp =
    opts.mode === 'measure'
      ? "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'unsafe-inline'"
      : "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";
  const scale = opts.mode === 'final' ? opts.scale ?? 1 : 1;
  const gap = opts.mode === 'final' ? opts.gap ?? BASE_GAP_EM : BASE_GAP_EM;
  // Only tables get an inline size, and it is a number we computed, never text from the AI.
  const sizes = opts.mode === 'final' ? opts.tableFonts ?? [] : [];
  const wraps = opts.mode === 'final' ? opts.tableWrap ?? [] : [];
  let seen = -1;
  const tableAttrs = (): string => {
    seen++;
    const v = sizes[seen];
    const size = typeof v === 'number' && Number.isFinite(v) && v >= 0.5 && v <= 1.2 ? ` style="font-size:${v}em"` : '';
    return (wraps[seen] === true ? ' class="wrap"' : '') + size;
  };
  const extra = content.note ? `<p class="extra">${esc(content.note)}</p>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(content.title)}</title>
<style>${baseFontCss()}${hasFormulas ? katexFontCss() : ''}${CSS(opts.widthMm, opts.heightMm, cols)}</style>
</head><body>
<div class="poster" style="${themeCss(opts.theme)}--s:${scale};--gap:${gap}em">
<header class="head"><h1>${esc(content.title)}</h1><p>${esc(content.subtitle)}</p></header>
<main class="main">${content.sections.map((s, i) => section(s, i, tableAttrs)).join('')}</main>
<footer class="foot"><div class="notes">${extra}<p>${esc(AI_NOTE)}</p></div><div class="brand">${BRAND}</div></footer>
</div>${script}</body></html>`;
}
