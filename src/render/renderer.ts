import type { PosterContent } from '../content.ts';
import type { Sheet } from './sheets.ts';
import type { Theme } from './themes.ts';

export interface FitResult {
  fits: boolean;
  scale: number;
  gap: number;
  // Share of the page body used by content, 1 means full.
  fill: number;
  // 1 when it fits; above 1 is how many times too big the content is.
  overflow: number;
  // Text size per table in em, measured so each table stays inside its card.
  tableFonts: number[];
  // Tables that were allowed to break inside long words.
  tableWrap: boolean[];
}

export interface RenderResult {
  pdf: Buffer;
  png: Buffer;
  fit: FitResult;
  pages: number;
  // The sheet the poster ended up on.
  sheet: Sheet;
}

export interface RenderOptions {
  // Redraw on this sheet (by id) instead of searching for the smallest one that fits, e.g. for a theme switch.
  sheet?: string | null;
}

export interface PosterRenderer {
  render(content: PosterContent, theme: Theme, opts?: RenderOptions): Promise<RenderResult>;
  close(): Promise<void>;
}
