// Validates contractions.json: every dots array must match its Unicode cell,
// cells must be in the braille block, and the module must round-trip.
// Usage: node tools/braille/validate.mjs
import { tables, cellToDots, dotsToCell, contractWord, contractText } from "./contractions.mjs";

let failures = 0;
const fail = (msg) => { failures++; console.error("FAIL:", msg); };

for (const section of [
  "strongGroupsigns", "strongWordsigns", "lowerGroupsigns", "lowerWordsigns", "indicators",
]) {
  for (const [key, { cell, dots }] of Object.entries(tables[section])) {
    const cp = cell.codePointAt(0);
    if (cp < 0x2800 || cp > 0x28ff) fail(`${section}.${key}: ${cell} not a braille cell`);
    const derived = cellToDots(cell);
    if (JSON.stringify(derived) !== JSON.stringify(dots)) {
      fail(`${section}.${key}: dots ${JSON.stringify(dots)} != cell ${cell} (${JSON.stringify(derived)})`);
    }
    if (dotsToCell(dots) !== cell) fail(`${section}.${key}: dotsToCell round-trip mismatch`);
  }
}

// Spot-check known UEB values.
const expect = {
  "strongGroupsigns.th": "⠹", "strongGroupsigns.st": "⠌", "strongGroupsigns.ing": "⠬",
  "strongWordsigns.and": "⠯", "strongWordsigns.the": "⠮", "strongWordsigns.for": "⠿",
  "lowerWordsigns.was": "⠴", "indicators.number": "⠼",
};
for (const [path, want] of Object.entries(expect)) {
  const [s, k] = path.split(".");
  const got = tables[s][k].cell;
  if (got !== want) fail(`${path}: expected ${want}, got ${got}`);
}

// Functional spot-checks.
if (contractWord("the") !== "⠮") fail("contractWord('the')");
if (contractWord("so") !== "⠎") fail("contractWord('so') should be letter-s wordsign ⠎");
if (!contractText("The cat").startsWith("⠠")) fail("capital indicator missing");

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("OK: all contraction tables consistent");
