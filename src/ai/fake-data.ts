import type { Level, PosterContent } from '../content.ts';

// Handwritten sample posters for the local fake provider. Real facts, kept short.
// Anything not matched here gets the generic sample poster from fake.ts.

export const sqlPoster: PosterContent = {
  title: 'SQL Cheat Sheet',
  subtitle: 'Query, join, group and change data in a relational database',
  sections: [
    {
      kind: 'code', heading: 'Reading data', language: 'sql',
      code: 'SELECT name, city\nFROM customers\nWHERE country = \'IT\'\n  AND active = 1\nORDER BY name ASC\nLIMIT 10;',
    },
    {
      kind: 'definitions', heading: 'Order of a query',
      items: [
        { term: 'FROM', meaning: 'Pick the tables and join them.' },
        { term: 'WHERE', meaning: 'Filter single rows before grouping.' },
        { term: 'GROUP BY', meaning: 'Collapse rows into groups.' },
        { term: 'HAVING', meaning: 'Filter groups after grouping.' },
        { term: 'SELECT', meaning: 'Choose and compute the output columns.' },
        { term: 'ORDER BY', meaning: 'Sort the final rows.' },
        { term: 'LIMIT', meaning: 'Keep only the first rows.' },
      ],
    },
    {
      kind: 'table', heading: 'Joins', columns: ['Join', 'Keeps', 'Typical use'],
      rows: [
        ['INNER', 'Rows that match in both', 'Orders with their customers'],
        ['LEFT', 'All left rows, matches on the right', 'Customers, even with no orders'],
        ['RIGHT', 'All right rows, matches on the left', 'Rarely used, swap the tables'],
        ['FULL', 'Every row from both sides', 'Find what is missing on either side'],
        ['CROSS', 'Every pair of rows', 'Build all combinations'],
      ],
    },
    {
      kind: 'table', heading: 'Aggregates', columns: ['Function', 'Returns'],
      rows: [
        ['COUNT(*)', 'Number of rows'],
        ['COUNT(col)', 'Number of non-NULL values'],
        ['SUM(col)', 'Total of the values'],
        ['AVG(col)', 'Mean of the values'],
        ['MIN / MAX', 'Smallest or largest value'],
      ],
    },
    {
      kind: 'code', heading: 'Group and filter groups', language: 'sql',
      code: 'SELECT country, COUNT(*) AS n\nFROM customers\nGROUP BY country\nHAVING COUNT(*) > 5\nORDER BY n DESC;',
    },
    {
      kind: 'code', heading: 'Changing data', language: 'sql',
      code: 'INSERT INTO t (a, b) VALUES (1, \'x\');\nUPDATE t SET b = \'y\' WHERE a = 1;\nDELETE FROM t WHERE a = 1;',
    },
    {
      kind: 'points', heading: 'Handy habits',
      items: [
        'Always write a WHERE before an UPDATE or DELETE.',
        'NULL is not equal to anything, use IS NULL.',
        'Name the columns you need instead of SELECT *.',
        'Use a transaction when several changes belong together.',
        'Add an index on columns you filter or join on often.',
      ],
    },
    {
      kind: 'steps', heading: 'Debugging a query',
      items: [
        'Run the FROM and JOIN part alone and count the rows.',
        'Add the WHERE and check the count again.',
        'Add GROUP BY and compare to what you expect.',
        'Only then add SELECT columns and sorting.',
      ],
    },
  ],
};

export const spanishPoster: PosterContent = {
  title: 'Spanish Verbs',
  subtitle: 'Regular endings, the big irregulars and when to use each tense',
  sections: [
    {
      kind: 'table', heading: 'Present tense, regular', columns: ['Person', '-ar hablar', '-er comer', '-ir vivir'],
      rows: [
        ['yo', 'hablo', 'como', 'vivo'],
        ['tú', 'hablas', 'comes', 'vives'],
        ['él / ella', 'habla', 'come', 'vive'],
        ['nosotros', 'hablamos', 'comemos', 'vivimos'],
        ['vosotros', 'habláis', 'coméis', 'vivís'],
        ['ellos / ellas', 'hablan', 'comen', 'viven'],
      ],
    },
    {
      kind: 'table', heading: 'Ser and estar', columns: ['Use', 'Verb', 'Example'],
      rows: [
        ['Identity', 'ser', 'Soy Ana'],
        ['Origin', 'ser', 'Es de Chile'],
        ['Time', 'ser', 'Son las tres'],
        ['Mood', 'estar', 'Estoy cansado'],
        ['Location', 'estar', 'Está en casa'],
      ],
    },
    {
      kind: 'table', heading: 'Key irregulars, present', columns: ['Verb', 'yo', 'tú', 'nosotros'],
      rows: [
        ['ser', 'soy', 'eres', 'somos'],
        ['estar', 'estoy', 'estás', 'estamos'],
        ['ir', 'voy', 'vas', 'vamos'],
        ['tener', 'tengo', 'tienes', 'tenemos'],
        ['hacer', 'hago', 'haces', 'hacemos'],
      ],
    },
    {
      kind: 'definitions', heading: 'Which past tense?',
      items: [
        { term: 'Pretérito', meaning: 'A finished action at a point in time: comí a las dos.' },
        { term: 'Imperfecto', meaning: 'Habit or background in the past: comía en casa.' },
        { term: 'Perfecto', meaning: 'Recent past that still matters: he comido.' },
        { term: 'Pluscuamperfecto', meaning: 'Before another past event: había comido.' },
      ],
    },
    {
      kind: 'points', heading: 'Stem changes',
      items: [
        'e to ie: pensar, pienso, pensamos stays regular.',
        'o to ue: poder, puedo, podemos stays regular.',
        'e to i: pedir, pido, pedimos stays regular.',
        'Nosotros and vosotros keep the original stem in the present.',
      ],
    },
    {
      kind: 'steps', heading: 'Conjugating a regular verb',
      items: [
        'Find the ending: -ar, -er or -ir.',
        'Drop the ending to get the stem.',
        'Check if the verb is irregular or changes its stem.',
        'Add the ending for the person and tense you need.',
      ],
    },
    {
      kind: 'points', heading: 'Common traps',
      items: [
        'Do not say "yo" every time, the ending already shows the person.',
        'Use "tener" for age: tengo veinte años.',
        'Use "hay" for there is and there are.',
        'Reflexive verbs need me, te, se, nos, os, se before the verb.',
      ],
    },
  ],
};

export const orgChemPoster: PosterContent = {
  title: 'Organic Chemistry',
  subtitle: 'Functional groups, naming and the reactions you meet first',
  sections: [
    {
      kind: 'table', heading: 'Functional groups', columns: ['Group', 'Pattern', 'Example'],
      rows: [
        ['Alcohol', 'R-OH', 'Ethanol'],
        ['Aldehyde', 'R-CHO', 'Ethanal'],
        ['Ketone', 'R-CO-R', 'Propanone'],
        ['Carboxylic acid', 'R-COOH', 'Ethanoic acid'],
        ['Ester', 'R-COO-R', 'Ethyl ethanoate'],
        ['Amine', 'R-NH2', 'Methylamine'],
      ],
    },
    {
      kind: 'definitions', heading: 'Naming the carbon chain',
      items: [
        { term: 'meth-', meaning: '1 carbon' },
        { term: 'eth-', meaning: '2 carbons' },
        { term: 'prop-', meaning: '3 carbons' },
        { term: 'but-', meaning: '4 carbons' },
        { term: 'pent-', meaning: '5 carbons' },
        { term: 'hex-', meaning: '6 carbons' },
      ],
    },
    {
      kind: 'formulas', heading: 'General formulas',
      items: [
        { latex: 'C_nH_{2n+2}', caption: 'Alkanes' },
        { latex: 'C_nH_{2n}', caption: 'Alkenes, one double bond' },
        { latex: 'C_nH_{2n-2}', caption: 'Alkynes, one triple bond' },
      ],
    },
    {
      kind: 'table', heading: 'Reactions to know', columns: ['Reaction', 'Starts with', 'Gives'],
      rows: [
        ['Combustion', 'Hydrocarbon and O2', 'CO2 and water'],
        ['Addition', 'Alkene', 'Saturated product'],
        ['Substitution', 'Alkane and halogen', 'Haloalkane'],
        ['Oxidation', 'Primary alcohol', 'Aldehyde, then acid'],
        ['Esterification', 'Acid and alcohol', 'Ester and water'],
      ],
    },
    {
      kind: 'steps', heading: 'Naming a molecule',
      items: [
        'Find the longest carbon chain that holds the main group.',
        'Number it so the main group gets the lowest number.',
        'Name each branch and give it its number.',
        'List branches alphabetically, then add the chain name.',
      ],
    },
    {
      kind: 'points', heading: 'Ideas that explain a lot',
      items: [
        'Carbon forms four bonds.',
        'Polar groups raise boiling points through stronger attraction.',
        'More branching lowers the boiling point of isomers.',
        'Electron-rich spots attack electron-poor spots.',
      ],
    },
    {
      kind: 'points', heading: 'Exam traps',
      items: [
        'Draw every hydrogen on the carbon you change.',
        'Check the conditions: heat, catalyst, solvent.',
        'A double bond is one sigma and one pi bond.',
      ],
    },
  ],
};

export function sampleFor(topic: string): PosterContent | null {
  const t = topic.toLowerCase();
  if (/\bsql\b/.test(t)) return sqlPoster;
  if (/spanish|español|espanol/.test(t) && /verb/.test(t)) return spanishPoster;
  if (/organic chem/.test(t)) return orgChemPoster;
  return null;
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

function titleCase(text: string): string {
  const t = text.length > 52 ? text.slice(0, 52).trim() : text;
  return t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// Placeholder poster for any other topic. It says it is a sample so nobody mistakes it for real facts.
export function genericPoster(topic: string, level: Level | null): PosterContent {
  const h = hash(topic);
  const n = (min: number, max: number, salt: number) => min + ((h >>> salt) % (max - min + 1));
  const name = titleCase(topic);
  // Long topics would push the placeholder lines past the schema limits, so lines use a short form.
  const short = [...topic].length > 40 ? [...topic].slice(0, 37).join('') + '...' : topic;
  const items = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${prefix} ${i + 1} about ${short}. Sample line from the local test generator.`);
  return {
    title: name,
    subtitle: `Sample poster${level ? ` for ${level} level` : ''}, made by the local test generator`,
    sections: [
      { kind: 'points', heading: 'Key ideas', items: items('Key idea', n(4, 7, 0)) },
      {
        kind: 'definitions', heading: 'Core terms',
        items: Array.from({ length: n(4, 7, 3) }, (_, i) => ({ term: `Term ${i + 1}`, meaning: `Sample meaning of term ${i + 1} in ${short}.` })),
      },
      { kind: 'steps', heading: 'How to approach it', items: items('Step', n(3, 6, 6)) },
      {
        kind: 'table', heading: 'Quick comparison', columns: ['Idea', 'What it means', 'When it matters'],
        rows: Array.from({ length: n(3, 6, 9) }, (_, i) => [`Idea ${i + 1}`, 'Sample meaning', 'Sample situation']),
      },
      { kind: 'points', heading: 'Common mistakes', items: items('Mistake', n(3, 6, 12)) },
      { kind: 'steps', heading: 'Study plan', items: items('Study session', n(3, 5, 15)) },
      { kind: 'points', heading: 'Remember', items: items('Reminder', n(3, 5, 18)) },
      {
        kind: 'definitions', heading: 'Questions to test yourself',
        items: Array.from({ length: n(3, 5, 21) }, (_, i) => ({ term: `Question ${i + 1}`, meaning: `Sample question about ${short}.` })),
      },
    ],
  };
}

// Topics that ask for a whole field at once: "the whole Python standard library", "all of organic chemistry".
export function isBigTopic(topic: string): boolean {
  return /\b(whole|entire|all of|everything|complete|full)\b/i.test(topic);
}

// A dense placeholder poster for big topics. It goes over the limits on purpose, the way real models do
// (wide tables, long cells, long lists, too many sections), so the repair step and the bigger sheets get exercised.
// Returned as unknown because it is not valid until it has been repaired.
export function bigPoster(topic: string, level: Level | null): unknown {
  const short = [...topic].length > 40 ? [...topic].slice(0, 37).join('') + '...' : topic;
  const words = (n: number, seed: number) =>
    Array.from({ length: n }, (_, i) => ['module', 'function', 'pattern', 'rule', 'example', 'detail', 'case', 'idea'][(i + seed) % 8]).join(' ');
  const cell = (r: number, c: number, len: number) => `Row ${r + 1} col ${c + 1}: ${words(40, r + c)}`.slice(0, len);
  const sections: unknown[] = [];
  for (let i = 0; i < 26; i++) {
    const n = i + 1;
    switch (i % 6) {
      case 0:
        // 8 columns, longer than the 6 allowed, with 120 character cells
        sections.push({ kind: 'table', heading: `Overview table ${n}`, columns: Array.from({ length: 8 }, (_, c) => `Col ${c + 1}`), rows: Array.from({ length: 5 }, (_, r) => Array.from({ length: 8 }, (_, c) => cell(r, c, c % 2 ? 120 : 30))) });
        break;
      case 1:
        sections.push({ kind: 'points', heading: `Key ideas ${n}`, items: Array.from({ length: 19 }, (_, j) => `Point ${j + 1} about ${short}: ${words(j % 3 === 0 ? 50 : 10, j)}`) });
        break;
      case 2:
        sections.push({ kind: 'definitions', heading: `Terms ${n}`, items: Array.from({ length: 9 }, (_, j) => ({ term: `Term ${n}.${j + 1}`, meaning: `Meaning in ${short}: ${words(14, j)}` })) });
        break;
      case 3:
        // 6 columns and 120 character cells, the shape the real model sends
        sections.push({ kind: 'table', heading: `Reference ${n}`, columns: ['Name', 'Kind', 'Use', 'Example', 'Watch out', 'Since'], rows: Array.from({ length: 7 }, (_, r) => Array.from({ length: 6 }, (_, c) => cell(r, c, c === 0 ? 20 : 120))) });
        break;
      case 4:
        sections.push({ kind: 'steps', heading: `How to ${n}`, items: Array.from({ length: 7 }, (_, j) => `Step ${j + 1}: ${words(12, j)}`) });
        break;
      case 5:
        sections.push({ kind: 'code', heading: `Example ${n}`, language: 'python', code: Array.from({ length: 30 }, (_, j) => `value_${j} = compute(${j}, "${words(3, j)}")`).join('\n') });
        break;
    }
  }
  return {
    title: `${titleCase(topic)}: the complete cheat sheet for everything you need, on one big poster`,
    subtitle: `Sample big poster${level ? ` for ${level} level` : ''}, made by the local test generator`,
    sections,
  };
}
