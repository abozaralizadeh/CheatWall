import type { PosterContent } from '../content.ts';
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
}

export interface RenderResult {
  pdf: Buffer;
  png: Buffer;
  fit: FitResult;
  pages: number;
}

export interface PosterRenderer {
  render(content: PosterContent, theme: Theme): Promise<RenderResult>;
  close(): Promise<void>;
}
