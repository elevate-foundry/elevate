export interface SharedCodecEntry {
  cell: string;
  expansion: string;
  category: 'latex' | 'prose' | 'code' | 'structured' | 'control';
}

export interface SharedCodecResult {
  encoded: string;
  decoded: string;
  original_chars: number;
  encoded_cells: number;
  compression_ratio: number;
  exact_roundtrip: boolean;
  matched_entries: Array<{ cell: string; expansion: string; count: number }>;
}

const cell = (offset: number) => String.fromCodePoint(0x2800 + offset);

export const SHARED_CODEC: SharedCodecEntry[] = [
  { cell: cell(1), expansion: 'the', category: 'prose' },
  { cell: cell(2), expansion: 'and', category: 'prose' },
  { cell: cell(3), expansion: 'of', category: 'prose' },
  { cell: cell(4), expansion: 'to', category: 'prose' },
  { cell: cell(5), expansion: 'in', category: 'prose' },
  { cell: cell(6), expansion: 'a', category: 'prose' },
  { cell: cell(7), expansion: 'is', category: 'prose' },
  { cell: cell(8), expansion: 'for', category: 'prose' },
  { cell: cell(9), expansion: 'with', category: 'prose' },
  { cell: cell(10), expansion: 'as', category: 'prose' },
  { cell: cell(11), expansion: 'by', category: 'prose' },
  { cell: cell(12), expansion: 'that', category: 'prose' },
  { cell: cell(13), expansion: 'this', category: 'prose' },
  { cell: cell(14), expansion: 'from', category: 'prose' },
  { cell: cell(15), expansion: 'which', category: 'prose' },
  { cell: cell(16), expansion: 'energy', category: 'prose' },
  { cell: cell(17), expansion: 'model', category: 'prose' },
  { cell: cell(18), expansion: 'models', category: 'prose' },
  { cell: cell(19), expansion: 'compression', category: 'prose' },
  { cell: cell(20), expansion: 'communication', category: 'prose' },
  { cell: cell(21), expansion: 'information', category: 'prose' },
  { cell: cell(22), expansion: 'semantic', category: 'prose' },
  { cell: cell(23), expansion: 'therefore', category: 'prose' },
  { cell: cell(24), expansion: 'because', category: 'prose' },
  { cell: cell(25), expansion: 'however', category: 'prose' },
  { cell: cell(26), expansion: 'photosynthesis', category: 'prose' },
  { cell: cell(27), expansion: 'plants', category: 'prose' },
  { cell: cell(28), expansion: 'sunlight', category: 'prose' },
  { cell: cell(29), expansion: 'water', category: 'prose' },
  { cell: cell(30), expansion: 'carbon dioxide', category: 'prose' },
  { cell: cell(31), expansion: 'glucose', category: 'prose' },
  { cell: cell(32), expansion: 'oxygen', category: 'prose' },
  { cell: cell(33), expansion: 'thermodynamics', category: 'prose' },
  { cell: cell(34), expansion: 'temperature', category: 'prose' },
  { cell: cell(35), expansion: 'entropy', category: 'prose' },
  { cell: cell(36), expansion: 'function', category: 'code' },
  { cell: cell(37), expansion: 'return', category: 'code' },
  { cell: cell(38), expansion: 'const', category: 'code' },
  { cell: cell(39), expansion: 'let', category: 'code' },
  { cell: cell(40), expansion: 'if', category: 'code' },
  { cell: cell(41), expansion: 'else', category: 'code' },
  { cell: cell(42), expansion: 'def', category: 'code' },
  { cell: cell(43), expansion: 'import', category: 'code' },
  { cell: cell(44), expansion: 'true', category: 'code' },
  { cell: cell(45), expansion: 'false', category: 'code' },
  { cell: cell(46), expansion: 'planet', category: 'structured' },
  { cell: cell(47), expansion: 'diameter', category: 'structured' },
  { cell: cell(48), expansion: 'kilometers', category: 'structured' },
  { cell: cell(49), expansion: 'Jupiter', category: 'structured' },
  { cell: cell(50), expansion: 'Saturn', category: 'structured' },
  { cell: cell(51), expansion: 'Uranus', category: 'structured' },
  { cell: cell(52), expansion: 'Neptune', category: 'structured' },
  { cell: cell(53), expansion: 'Earth', category: 'structured' },
  { cell: cell(180), expansion: '\\documentclass{article}', category: 'latex' },
  { cell: cell(181), expansion: '\\begin{document}', category: 'latex' },
  { cell: cell(182), expansion: '\\end{document}', category: 'latex' },
  { cell: cell(183), expansion: '\\section{', category: 'latex' },
  { cell: cell(184), expansion: '\\subsection{', category: 'latex' },
  { cell: cell(185), expansion: '\\begin{equation}', category: 'latex' },
  { cell: cell(186), expansion: '\\end{equation}', category: 'latex' },
  { cell: cell(187), expansion: '\\frac{', category: 'latex' },
  { cell: cell(188), expansion: '\\sum', category: 'latex' },
  { cell: cell(189), expansion: '\\title{', category: 'latex' },
  { cell: cell(190), expansion: '\\author{', category: 'latex' },
  { cell: cell(191), expansion: '\\maketitle', category: 'latex' },
  { cell: cell(240), expansion: '\n', category: 'control' },
  { cell: cell(241), expansion: '  ', category: 'control' }
];

const entriesByLongestExpansion = [...SHARED_CODEC].sort((a, b) => b.expansion.length - a.expansion.length);
const expansionByCell = new Map(SHARED_CODEC.map(e => [e.cell, e.expansion]));

export function encodeSharedCodec(input: string): SharedCodecResult {
  let encoded = '';
  let i = 0;
  const counts = new Map<string, { cell: string; expansion: string; count: number }>();

  while (i < input.length) {
    const match = entriesByLongestExpansion.find(e => input.startsWith(e.expansion, i));
    if (match) {
      encoded += match.cell;
      i += match.expansion.length;
      const prior = counts.get(match.cell) || { cell: match.cell, expansion: match.expansion, count: 0 };
      prior.count += 1;
      counts.set(match.cell, prior);
    } else {
      encoded += input[i];
      i += 1;
    }
  }

  const decoded = decodeSharedCodec(encoded);
  const encodedCells = [...encoded].length;
  return {
    encoded,
    decoded,
    original_chars: input.length,
    encoded_cells: encodedCells,
    compression_ratio: encodedCells > 0 ? input.length / encodedCells : 0,
    exact_roundtrip: decoded === input,
    matched_entries: [...counts.values()].sort((a, b) => b.count - a.count)
  };
}

export function decodeSharedCodec(encoded: string): string {
  return [...encoded].map(ch => expansionByCell.get(ch) || ch).join('');
}

export function sharedCodecStats() {
  const byCategory = SHARED_CODEC.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.category] = (acc[entry.category] || 0) + 1;
    return acc;
  }, {});
  return {
    entries: SHARED_CODEC.length,
    byCategory,
    remainingCells: 256 - SHARED_CODEC.length
  };
}
