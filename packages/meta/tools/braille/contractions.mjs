// Canonical grade-2 (UEB) contraction module for the elevate-foundry org.
// Data lives in contractions.json — the single source of truth. Every other
// implementation in the org (JS, Rust, Python) should derive from or be
// validated against these tables. See README.md for the mapping.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const tables = JSON.parse(
  readFileSync(join(here, "contractions.json"), "utf8")
);

const {
  strongGroupsigns,
  strongWordsigns,
  alphabeticWordsigns,
  lowerGroupsigns,
  lowerWordsigns,
  shortforms,
  indicators,
} = tables;

export {
  strongGroupsigns,
  strongWordsigns,
  alphabeticWordsigns,
  lowerGroupsigns,
  lowerWordsigns,
  shortforms,
  indicators,
};

// Standard 6-dot letter cells (a-z) for alphabetic wordsigns.
const LETTER_DOTS = {
  a: [1, 0, 0, 0, 0, 0], b: [1, 1, 0, 0, 0, 0], c: [1, 0, 0, 1, 0, 0],
  d: [1, 0, 0, 1, 1, 0], e: [1, 0, 0, 0, 1, 0], f: [1, 1, 0, 1, 0, 0],
  g: [1, 1, 0, 1, 1, 0], h: [1, 1, 0, 0, 1, 0], i: [0, 1, 0, 1, 0, 0],
  j: [0, 1, 0, 1, 1, 0], k: [1, 0, 1, 0, 0, 0], l: [1, 1, 1, 0, 0, 0],
  m: [1, 0, 1, 1, 0, 0], n: [1, 0, 1, 1, 1, 0], o: [1, 0, 1, 0, 1, 0],
  p: [1, 1, 1, 1, 0, 0], q: [1, 1, 1, 1, 1, 0], r: [1, 1, 1, 0, 1, 0],
  s: [0, 1, 1, 1, 0, 0], t: [0, 1, 1, 1, 1, 0], u: [1, 0, 1, 0, 0, 1],
  v: [1, 1, 1, 0, 0, 1], w: [0, 1, 0, 1, 1, 1], x: [1, 0, 1, 1, 0, 1],
  y: [1, 0, 1, 1, 1, 1], z: [1, 0, 1, 0, 1, 1],
};

// All standalone-word contractions (word -> cell string), longest first.
export const wordContractions = (() => {
  const out = new Map();
  for (const [w, v] of Object.entries(strongWordsigns)) out.set(w, v.cell);
  for (const [w, v] of Object.entries(lowerWordsigns)) out.set(w, v.cell);
  for (const [w, letter] of Object.entries(alphabeticWordsigns)) {
    out.set(w, letterToCell(letter));
  }
  return new Map([...out].sort((a, b) => b[0].length - a[0].length));
})();

// All in-word groupsigns (sequence -> cell string), longest first.
export const groupContractions = (() => {
  const out = new Map();
  for (const [g, v] of Object.entries(strongGroupsigns)) out.set(g, v.cell);
  for (const [g, v] of Object.entries(lowerGroupsigns)) out.set(g, v.cell);
  return new Map([...out].sort((a, b) => b[0].length - a[0].length));
})();

export function letterToCell(letter) {
  return dotsToCell(LETTER_DOTS[letter.toLowerCase()]);
}

export function dotsToCell(dots) {
  let code = 0x2800;
  for (let i = 0; i < 6; i++) if (dots[i]) code |= 1 << i;
  return String.fromCodePoint(code);
}

export function cellToDots(cell) {
  const bits = cell.codePointAt(0) - 0x2800;
  return Array.from({ length: 6 }, (_, i) => (bits >> i) & 1);
}

// Contract a single lowercase word: whole-word sign if one exists,
// otherwise apply groupsigns greedily (longest match first).
export function contractWord(word) {
  if (wordContractions.has(word)) return wordContractions.get(word);
  let out = "";
  let i = 0;
  outer: while (i < word.length) {
    for (const [seq, cell] of groupContractions) {
      if (word.startsWith(seq, i)) {
        out += cell;
        i += seq.length;
        continue outer;
      }
    }
    const ch = word[i];
    out += LETTER_DOTS[ch] ? letterToCell(ch) : ch;
    i++;
  }
  return out;
}

// Contract running text word-by-word (simplified: ignores punctuation-
// adjacent bridging rules; capital/number indicators per UEB).
export function contractText(text) {
  return text.replace(/[A-Za-z]+|\d+/g, (tok) => {
    if (/^\d+$/.test(tok)) return indicators.number.cell + tok;
    const caps = /^[A-Z]/.test(tok) ? indicators.capital.cell : "";
    return caps + contractWord(tok.toLowerCase());
  });
}

// Cell-count estimate (parity with corpus-builder/experiments/braille_compression.py).
export function cellCount(text) {
  return [...contractText(text)].length;
}
