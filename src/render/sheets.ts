// Paper sizes a poster can grow to. A dense poster first gets more columns, then a bigger sheet, and only on the
// biggest sheet may the text go below the normal minimum (down to about 8 pt in print).

export interface Sheet {
  // Stored with the poster, so a theme switch redraws on the same sheet.
  id: string;
  // Shown to people, e.g. "A1".
  label: string;
  widthMm: number;
  heightMm: number;
  columns: number;
  minScale: number;
}

export const MIN_SCALE = 0.6;
export const LAST_MIN_SCALE = 0.48;

const ISO = [
  ['A0', 841, 1189],
  ['A1', 594, 841],
  ['A2', 420, 594],
  ['A3', 297, 420],
  ['A4', 210, 297],
] as const;

function label(w: number, h: number): string {
  const hit = ISO.find(([, iw, ih]) => Math.abs(iw - w) <= 2 && Math.abs(ih - h) <= 2);
  return hit ? hit[0] : `${Math.round(w)} x ${Math.round(h)} mm`;
}

// Each step up is one ISO size (twice the area). From the default A2: A2 with 3 and 4 columns, A1 with 4 and 5,
// A0 with 5 and 6, and last A0 with 6 columns and smaller text.
export function sheetLadder(widthMm: number, heightMm: number, steps = 2): Sheet[] {
  const out: Sheet[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = Math.SQRT2 ** i;
    // Snap to the real ISO size when it is one (A1 is 594 x 841, not 594 x 840).
    const iso = ISO.find(([, iw, ih]) => Math.abs(iw - widthMm * f) <= 2 && Math.abs(ih - heightMm * f) <= 2);
    const w = iso ? iso[1] : Math.round(widthMm * f);
    const h = iso ? iso[2] : Math.round(heightMm * f);
    const name = label(w, h);
    for (const columns of [3 + i, 4 + i]) out.push({ id: `${w}x${h}c${columns}`, label: name, widthMm: w, heightMm: h, columns, minScale: MIN_SCALE });
  }
  const last = out[out.length - 1]!;
  out.push({ ...last, id: `${last.id}s`, minScale: LAST_MIN_SCALE });
  return out;
}

export function findSheet(ladder: Sheet[], id: string | null | undefined): Sheet | undefined {
  return id ? ladder.find((s) => s.id === id) : undefined;
}
