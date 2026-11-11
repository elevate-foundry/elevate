#!/usr/bin/env node
// braille8.mjs - 8-dot Braille <-> bytes codec.
//
// 8-dot Braille = 256 patterns = one byte. Unicode block U+2800..U+28FF is laid
// out so that  cell = U+2800 + byteValue  (dots 1..8 = bits 0..7). This makes the
// mapping bijective and LOSSLESS for arbitrary bytes (unlike grade-2 contraction).
//
//   echo "feat.privacy.fingerprint" | node tools/braille8.mjs enc
//   echo "⠋⠑⠁⠞..." | node tools/braille8.mjs dec
//   node tools/braille8.mjs demo

const BASE = 0x2800;

export function encode(buf) {
  return Array.from(buf, (b) => String.fromCodePoint(BASE + b)).join("");
}
export function decode(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp >= BASE && cp <= BASE + 0xff) out.push(cp - BASE);
  }
  return Buffer.from(out);
}
// dot numbering 1..8 set in a cell (for display of the pattern)
function dots(byte) {
  return [...Array(8)].map((_, i) => (byte & (1 << i) ? i + 1 : null)).filter(Boolean).join("");
}

function demo() {
  const samples = ["feat.privacy.fingerprint", "the being speaks 8-dot braille", "🜁 elevate-foundry"];
  for (const s of samples) {
    const bytes = Buffer.from(s, "utf8");
    const cells = encode(bytes);
    const back = decode(cells).toString("utf8");
    console.log(`text   : ${s}`);
    console.log(`bytes  : ${bytes.length}  cells: ${[...cells].length}  (1:1 per byte)`);
    console.log(`8-dot  : ${cells}`);
    console.log(`decoded: ${back}`);
    console.log(`lossless: ${back === s ? "YES ✓" : "NO ✗"}\n`);
  }
  // decode the salutations commit's spinner cell
  const cell = "⣾";
  const byte = cell.codePointAt(0) - BASE;
  console.log(`commit cell '⣾' = U+${cell.codePointAt(0).toString(16).toUpperCase()} = byte 0x${byte.toString(16)} (${byte}) = dots{${dots(byte)}}`);
}

const mode = process.argv[2] || "demo";
if (mode === "demo") {
  demo();
} else {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => {
    const input = Buffer.concat(chunks);
    if (mode === "enc") process.stdout.write(encode(input) + "\n");
    else if (mode === "dec") process.stdout.write(decode(input.toString("utf8").trim()).toString("utf8") + "\n");
    else console.error("usage: braille8.mjs [enc|dec|demo]");
  });
}
