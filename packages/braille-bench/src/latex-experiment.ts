/**
 * LaTeX round-trip experiment
 *
 * For each document in the corpus:
 *   1. Encoder compresses LaTeX → braille using the shared seed codebook
 *   2. Decoder reconstructs braille → LaTeX using the same codebook
 *   3. We validate structure and attempt real pdflatex compilation
 *
 * Success = recompilable LaTeX (lossless on structure), with compression > 1.
 */

import { callAnyModel } from './providers.js';
import {
  LATEX_SEED_CODEBOOK,
  LATEX_CORPUS,
  validateLatexStructure,
  compileLatex,
  scoreLatexFidelity
} from './latex.js';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, '..', 'results');
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

function codebookString(): string {
  return LATEX_SEED_CODEBOOK.map(e => `${e.cell} = ${JSON.stringify(e.meaning)}`).join('\n');
}

const STANDARD_BRAILLE_LETTERS =
  '⠁=a ⠃=b ⠉=c ⠙=d ⠑=e ⠋=f ⠛=g ⠓=h ⠊=i ⠚=j ⠅=k ⠇=l ⠍=m ⠝=n ⠕=o ⠏=p ⠟=q ⠗=r ⠎=s ⠞=t ⠥=u ⠧=v ⠺=w ⠭=x ⠽=y ⠵=z';

function encodePrompt(): string {
  return `You are a LaTeX-to-braille compression encoder. Convert LaTeX source into a braille stream.

COMMAND CODEBOOK (use these EXACT cells for these EXACT LaTeX constructs):
${codebookString()}

PROSE LETTERS (spell out any text/words/identifiers not covered above, one cell per letter):
${STANDARD_BRAILLE_LETTERS}
Digits: ⠼ prefix then ⠁=1 ⠃=2 ⠉=3 ⠙=4 ⠑=5 ⠋=6 ⠛=7 ⠓=8 ⠊=9 ⠚=0

RULES:
1. Output ONLY braille characters — no explanation, no markdown.
2. For any LaTeX command in the codebook, emit its single cell.
3. For prose text, spell letter-by-letter using the prose letters.
4. Preserve word boundaries with the space cell ⠀.
5. Capital letters: prefix with ⠠ (e.g. ⠠⠓ = H).`;
}

function decodePrompt(): string {
  return `You are a braille-to-LaTeX decoder. Convert a braille stream back into valid, compilable LaTeX source.

COMMAND CODEBOOK (expand these cells to these EXACT LaTeX constructs):
${codebookString()}

PROSE LETTERS:
${STANDARD_BRAILLE_LETTERS}
Digits: ⠼ prefix then ⠁=1 ⠃=2 ... ⠚=0. Capital prefix: ⠠.

RULES:
1. Expand each codebook cell to its LaTeX construct.
2. Convert prose letter-cells back to text.
3. Output ONLY the reconstructed LaTeX source — no explanation, no markdown fences.
4. The output MUST be syntactically valid LaTeX that compiles with pdflatex.
5. NEVER insert blank lines inside math environments (equation, align) — LaTeX forbids paragraph breaks in math mode. Keep each environment's lines contiguous.
6. Preserve capitalization exactly (⠠ prefix = capital letter).`;
}

export interface LatexRoundtripResult {
  doc_id: string;
  encoder_model: string;
  decoder_model: string;
  original: string;
  encoded_braille: string;
  decoded: string;
  original_chars: number;
  braille_cells: number;
  compression_ratio: number;
  fidelity: number;
  structure_valid: boolean;
  structure_errors: string[];
  original_compiles: boolean;
  decoded_compiles: boolean;
  encode_latency_ms: number;
  decode_latency_ms: number;
}

export async function runLatexRoundtrip(opts: {
  encoderModel: string;
  decoderModel: string;
  docIds?: string[];
}): Promise<LatexRoundtripResult[]> {
  const docs = opts.docIds
    ? LATEX_CORPUS.filter(d => opts.docIds!.includes(d.id))
    : LATEX_CORPUS;

  const results: LatexRoundtripResult[] = [];
  console.log(`\n⠿ LATEX ROUND-TRIP: ${opts.encoderModel} → ${opts.decoderModel}`);
  console.log(`  Codebook: ${LATEX_SEED_CODEBOOK.length} command mappings\n`);

  for (const doc of docs) {
    console.log(`  [${doc.id}] ${doc.src.length} chars...`);

    // 1. Encode
    const encodeRes = await callAnyModel(opts.encoderModel, {
      messages: [
        { role: 'system', content: encodePrompt() },
        { role: 'user', content: `Encode this LaTeX to braille:\n\n${doc.src}` }
      ],
      max_tokens: 2048,
      temperature: 0.1
    });

    // keep only braille range characters as the transmitted payload
    const braille = [...encodeRes.content].filter(c => {
      const cp = c.codePointAt(0)!;
      return cp >= 0x2800 && cp <= 0x28FF;
    }).join('');

    // 2. Decode
    const decodeRes = await callAnyModel(opts.decoderModel, {
      messages: [
        { role: 'system', content: decodePrompt() },
        { role: 'user', content: `Decode this braille to LaTeX:\n\n${braille}` }
      ],
      max_tokens: 2048,
      temperature: 0.1
    });

    // strip any accidental markdown fences
    const decoded = decodeRes.content.replace(/^```(?:latex|tex)?\n?/i, '').replace(/```$/i, '').trim();

    // 3. Validate + compile
    const cells = braille.length;
    const struct = validateLatexStructure(decoded);
    const [origCompile, decCompile] = await Promise.all([
      compileLatex(doc.src),
      compileLatex(decoded)
    ]);

    const result: LatexRoundtripResult = {
      doc_id: doc.id,
      encoder_model: opts.encoderModel,
      decoder_model: opts.decoderModel,
      original: doc.src,
      encoded_braille: braille,
      decoded,
      original_chars: doc.src.length,
      braille_cells: cells,
      compression_ratio: cells > 0 ? doc.src.length / cells : 0,
      fidelity: scoreLatexFidelity(doc.src, decoded),
      structure_valid: struct.valid,
      structure_errors: struct.errors,
      original_compiles: origCompile.compiles,
      decoded_compiles: decCompile.compiles,
      encode_latency_ms: encodeRes.latency_ms,
      decode_latency_ms: decodeRes.latency_ms
    };
    results.push(result);

    console.log(
      `    → ${result.compression_ratio.toFixed(2)}x, fidelity ${(result.fidelity * 100).toFixed(0)}%, ` +
      `structure ${struct.valid ? 'OK' : 'FAIL'}, compiles ${decCompile.compiles ? 'YES' : 'NO'} (${decCompile.log})`
    );
  }

  const outPath = join(RESULTS_DIR, `latex-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n  Saved to: ${outPath}\n`);
  return results;
}
