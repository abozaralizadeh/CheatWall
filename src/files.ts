import fs from 'node:fs';
import path from 'node:path';
import { isPosterId } from './content.ts';
import type { RenderResult } from './render/renderer.ts';

export function posterDir(root: string, id: string): string {
  if (!isPosterId(id)) throw new Error('bad poster id');
  return path.join(root, id);
}

export function posterFile(root: string, id: string, theme: string, ext: 'pdf' | 'png'): string {
  if (!/^[a-z0-9-]+$/.test(theme)) throw new Error('bad theme id');
  return path.join(posterDir(root, id), `${theme}.${ext}`);
}

function writeAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writePosterFiles(root: string, id: string, theme: string, r: Pick<RenderResult, 'pdf' | 'png'>): void {
  fs.mkdirSync(posterDir(root, id), { recursive: true });
  writeAtomic(posterFile(root, id, theme, 'pdf'), r.pdf);
  writeAtomic(posterFile(root, id, theme, 'png'), r.png);
}

export function hasPosterFiles(root: string, id: string, theme: string): boolean {
  return fs.existsSync(posterFile(root, id, theme, 'pdf')) && fs.existsSync(posterFile(root, id, theme, 'png'));
}

export function removePosterFiles(root: string, id: string): void {
  fs.rmSync(posterDir(root, id), { recursive: true, force: true });
}
