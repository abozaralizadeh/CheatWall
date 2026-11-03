// The default look. Change colours here and every poster follows. Each theme is plain CSS variable values.
// `npm test` checks every pair of text and background colours for contrast.

export interface Theme {
  id: string;
  name: string;
  vars: {
    bg: string; ink: string; muted: string; card: string; rule: string;
    headBg: string; headInk: string; codeBg: string; codeInk: string; stripe: string;
    onAccent: string; c0: string; c1: string; c2: string; c3: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: 'paper', name: 'Paper',
    vars: {
      bg: '#f6f1e7', ink: '#1c2433', muted: '#4a5568', card: '#fffdf8', rule: '#d9cfbb',
      headBg: '#1f3a5f', headInk: '#ffffff', codeBg: '#1e2433', codeInk: '#e8edf7', stripe: '#f0e9d8',
      onAccent: '#ffffff', c0: '#1f6fb2', c1: '#c2410c', c2: '#2b7a53', c3: '#7c3aed',
    },
  },
  {
    id: 'midnight', name: 'Midnight',
    vars: {
      bg: '#0e1526', ink: '#e8edf7', muted: '#a9b4c9', card: '#17213a', rule: '#2b3a5c',
      headBg: '#16264a', headInk: '#ffffff', codeBg: '#070b16', codeInk: '#dbe6ff', stripe: '#1c2846',
      onAccent: '#0a1020', c0: '#5cc8ff', c1: '#ffb454', c2: '#6ee7a8', c3: '#c4a5ff',
    },
  },
  {
    id: 'sunrise', name: 'Sunrise',
    vars: {
      bg: '#fff4e6', ink: '#2b1a12', muted: '#5b4636', card: '#fffaf3', rule: '#f0cfa8',
      headBg: '#b8390b', headInk: '#ffffff', codeBg: '#2b1a12', codeInk: '#ffe9d2', stripe: '#fdebd3',
      onAccent: '#ffffff', c0: '#b8390b', c1: '#a04a08', c2: '#0f766e', c3: '#9d174d',
    },
  },
];

export function getTheme(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export function themeCss(theme: Theme): string {
  const v = theme.vars;
  return `--bg:${v.bg};--ink:${v.ink};--muted:${v.muted};--card:${v.card};--rule:${v.rule};--head-bg:${v.headBg};--head-ink:${v.headInk};--code-bg:${v.codeBg};--code-ink:${v.codeInk};--stripe:${v.stripe};--on-accent:${v.onAccent};--c0:${v.c0};--c1:${v.c1};--c2:${v.c2};--c3:${v.c3};`;
}

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
