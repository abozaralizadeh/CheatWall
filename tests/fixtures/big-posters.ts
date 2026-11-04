// Shaped like what the real model sent for a big topic and what used to fail validation on the live server:
// a table with 6 columns (the old limit was 4) and table cells of about 120 characters (the old limit was 80).
// over: true pushes it past the new limits too (8 columns, 180 character cells, 20 bullets), to prove the repair.

const sentence = (len: number, seed: number) => {
  const words = ['returns', 'a', 'new', 'list', 'of', 'items', 'sorted', 'by', 'key', 'and', 'keeps', 'the', 'original', 'order', 'for', 'equal', 'values', 'when', 'stable'];
  let out = '';
  for (let i = seed; out.length < len; i++) out += (out ? ' ' : '') + words[i % words.length];
  return out.slice(0, len).trim();
};

export function azureFailingShape(opts: { over?: boolean } = {}): Record<string, any> {
  const cols = opts.over ? 8 : 6;
  const cellLen = opts.over ? 180 : 120;
  const modules = ['os', 'sys', 'pathlib', 'json', 're', 'itertools', 'functools', 'collections', 'datetime', 'typing'];
  return {
    title: 'The Whole Python Standard Library',
    subtitle: 'The modules you reach for most, what they do and how to call them',
    sections: [
      { kind: 'points', heading: 'How to read this poster', items: Array.from({ length: opts.over ? 20 : 8 }, (_, i) => sentence(90, i)) },
      { kind: 'definitions', heading: 'Core ideas', items: modules.slice(0, 8).map((m, i) => ({ term: m, meaning: sentence(110, i) })) },
      { kind: 'code', heading: 'Files and paths', language: 'python', code: 'from pathlib import Path\np = Path("data") / "in.txt"\ntext = p.read_text()\nfor line in text.splitlines():\n    print(line)' },
      {
        kind: 'table', heading: 'Modules at a glance',
        columns: ['Module', 'Area', 'Main use', 'Key call', 'Returns', 'Since', 'Notes', 'See also'].slice(0, cols),
        rows: modules.map((m, r) => Array.from({ length: cols }, (_, c) => (c === 0 ? m : sentence(c % 2 ? cellLen : 40, r + c)))),
      },
      { kind: 'steps', heading: 'Finding the right module', items: Array.from({ length: 6 }, (_, i) => sentence(100, i)) },
      { kind: 'formulas', heading: 'Handy numbers', items: [{ latex: '\\log_2 n', caption: 'Steps of a binary search in bisect' }, { latex: 'O(n \\log n)', caption: 'Cost of sorted()' }] },
      {
        kind: 'table', heading: 'Collections and itertools',
        columns: ['Name', 'What it does', 'Example', 'Cost'],
        rows: Array.from({ length: 8 }, (_, r) => ['name' + r, sentence(cellLen, r), sentence(cellLen, r + 3), sentence(30, r)]),
      },
      { kind: 'points', heading: 'Common mistakes', items: Array.from({ length: 8 }, (_, i) => sentence(140, i + 2)) },
      { kind: 'definitions', heading: 'Text and data', items: modules.slice(2).map((m, i) => ({ term: m, meaning: sentence(150, i + 1) })) },
      {
        kind: 'table', heading: 'Dates and times',
        columns: ['Call', 'Gives', 'Example', 'Time zone', 'Notes', 'Version'].slice(0, cols),
        rows: Array.from({ length: 6 }, (_, r) => Array.from({ length: cols }, (_, c) => sentence(c === 0 ? 20 : cellLen, r * 2 + c))),
      },
    ],
  };
}
