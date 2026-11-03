import type { PosterContent } from '../content.ts';
import type { PosterRenderer, RenderResult } from './renderer.ts';
import type { Theme } from './themes.ts';

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');

// Stand-in renderer for tests that do not need a browser.
export class StubRenderer implements PosterRenderer {
  // Report "does not fit" this many times first, to test the shorten loop.
  misses = 0;
  renders = 0;
  async render(_content: PosterContent, theme: Theme): Promise<RenderResult> {
    this.renders++;
    const fits = this.misses <= 0;
    if (!fits) this.misses--;
    return {
      pdf: Buffer.from(`%PDF-1.4\n% stub ${theme.id}\n/Type /Page\n%%EOF\n`),
      png: PNG,
      fit: { fits, scale: 1, gap: 1, fill: 0.95, overflow: fits ? 1 : 1.2, tableFonts: [] },
      pages: 1,
    };
  }
  async close(): Promise<void> {}
}
