/**
 * Iterative Codebook Alignment
 * 
 * Goal: Get multiple LLMs to converge on a shared braille codebook
 * through negotiation rounds — no gradient descent, just conversation.
 * 
 * Protocol:
 *   Round 0: Each model proposes an initial codebook (braille cell → meaning)
 *   Round 1+: 
 *     1. Encoder sends a test message encoded with its codebook
 *     2. Decoder attempts to decode using its codebook
 *     3. Decoder reports what it understood (+ confidence)
 *     4. Both models see the delta and adjust their codebooks
 *     5. Repeat until convergence (fidelity score stabilizes)
 * 
 * This creates a joint discrete embedding space through emergent agreement.
 */

import { callAnyModel, getAllModels, type ModelResponse } from './providers.js';
import { ENCODER_SYSTEM_PROMPT } from './braille.js';
import { randomUUID } from 'crypto';
import { appendFileSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, '..', 'results');
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// --- Types ---

export interface CodebookEntry {
  cell: string;       // braille character (U+2800–U+28FF)
  meaning: string;    // what it represents
  confidence: number; // 0-1, how stable this assignment is
}

export interface Codebook {
  model: string;
  version: number;
  entries: CodebookEntry[];
  raw?: string;
}

export interface AlignmentRound {
  round: number;
  timestamp: string;
  encoder_model: string;
  decoder_model: string;
  test_sentence: string;
  encoded_braille: string;
  decoder_interpretation: string;
  fidelity_score: number;   // 0-1, how close decoder got
  encoder_codebook_version: number;
  decoder_codebook_version: number;
  adjustments: string[];    // what changed this round
}

export interface AlignmentSession {
  session_id: string;
  encoder_model: string;
  decoder_model: string;
  rounds: AlignmentRound[];
  final_codebook: Codebook | null;
  convergence_round: number | null;  // round where fidelity stabilized
  final_fidelity: number;
}

// --- Test sentences for alignment (progressively harder) ---
const ALIGNMENT_SENTENCES = [
  'The cat sat on the mat.',
  'Water is made of hydrogen and oxygen.',
  'She walked quickly to the store.',
  'The economy grew by three percent last year.',
  'If the temperature drops below freezing, the pipes may burst.',
  'Machine learning models require large amounts of training data.',
  'The committee voted unanimously to approve the proposal.',
  'Photosynthesis converts carbon dioxide and water into glucose using sunlight.',
];

// --- Prompts ---

const PROPOSE_CODEBOOK_PROMPT = `You are designing a compression codebook using 8-dot braille characters (U+2800–U+28FF, 256 possible symbols).

Assign meanings to braille cells to maximize compression of English text. Your codebook should cover:
- The 50 most common English words (the, is, of, to, and, a, in, that, it, for, was, on, are, with, they, be, at, one, have, this...)
- Common word endings (-ing, -tion, -ed, -ly, -er, -ness...)  
- Punctuation and structure (period, comma, space, newline, capitalize-next...)
- Numbers (digits 0-9)

FORMAT (output EXACTLY this format, one per line):
⠁ = the
⠂ = is
⠃ = of
...

Output 80-120 assignments. Be systematic. This codebook will be shared with another LLM that must decode your messages.`;

const REFINE_CODEBOOK_PROMPT = (currentCodebook: string, feedback: string) => `You have an existing braille codebook. Based on communication feedback, REFINE it.

CURRENT CODEBOOK:
${currentCodebook}

FEEDBACK FROM DECODER:
${feedback}

INSTRUCTIONS:
- Keep assignments that worked well (decoder understood correctly)
- Change assignments that caused confusion
- Add new assignments for words/concepts that weren't covered
- Remove redundant or never-used assignments

Output the COMPLETE UPDATED codebook in the same format:
⠁ = the
⠂ = is
...

Output 80-120 assignments.`;

const ENCODE_WITH_CODEBOOK_PROMPT = (codebook: string) => `You are encoding text into braille using a SPECIFIC codebook. Use ONLY the assignments below. For words not in the codebook, spell them out using standard braille letter-by-letter (⠁=a, ⠃=b, ⠉=c, ⠙=d, ⠑=e, ⠋=f, ⠛=g, ⠓=h, ⠊=i, ⠚=j, ⠅=k, ⠇=l, ⠍=m, ⠝=n, ⠕=o, ⠏=p, ⠟=q, ⠗=r, ⠎=s, ⠞=t, ⠥=u, ⠧=v, ⠺=w, ⠭=x, ⠽=y, ⠵=z).

CODEBOOK:
${codebook}

RULES:
1. Output ONLY braille characters. No other text whatsoever.
2. Use codebook entries for exact matches.
3. Spell out words not in the codebook letter-by-letter.
4. Use the space separator from the codebook between words.`;

const DECODE_WITH_CODEBOOK_PROMPT = (codebook: string) => `You are decoding braille back to English using a SPECIFIC codebook. The encoder used the assignments below.

CODEBOOK:
${codebook}

RULES:
1. Look up each braille cell or cell-sequence in the codebook.
2. For cells not in the codebook, they may be letter-by-letter standard braille (⠁=a, ⠃=b, ⠉=c, ⠙=d, ⠑=e, ⠋=f, ⠛=g, ⠓=h, ⠊=i, ⠚=j, ⠅=k, ⠇=l, ⠍=m, ⠝=n, ⠕=o, ⠏=p, ⠟=q, ⠗=r, ⠎=s, ⠞=t, ⠥=u, ⠧=v, ⠺=w, ⠭=x, ⠽=y, ⠵=z).
3. Output ONLY the decoded English text. No explanation.`;

// --- Core Functions ---

function parseCodebook(raw: string): CodebookEntry[] {
  const entries: CodebookEntry[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const match = line.match(/^([\u2800-\u28FF]+)\s*=\s*(.+)$/);
    if (match) {
      entries.push({
        cell: match[1],
        meaning: match[2].trim(),
        confidence: 0.5
      });
    }
  }
  return entries;
}

function codebookToString(entries: CodebookEntry[]): string {
  return entries.map(e => `${e.cell} = ${e.meaning}`).join('\n');
}

function scoreFidelity(original: string, decoded: string): number {
  const origWords = new Set(original.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/));
  const decWords = new Set(decoded.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/));
  if (origWords.size === 0) return 0;
  const intersection = [...origWords].filter(w => decWords.has(w)).length;
  const union = new Set([...origWords, ...decWords]).size;
  return union > 0 ? intersection / union : 0;
}

// --- Phase 0: Initial codebook proposal ---

async function proposeCodebook(model: string): Promise<Codebook> {
  console.log(`  [${model}] Proposing initial codebook...`);
  const res = await callAnyModel(model, {
    messages: [{ role: 'user', content: PROPOSE_CODEBOOK_PROMPT }],
    max_tokens: 2048,
    temperature: 0.4
  });

  const entries = parseCodebook(res.content);
  console.log(`  [${model}] Proposed ${entries.length} entries (${res.latency_ms}ms)`);

  return {
    model,
    version: 0,
    entries,
    raw: res.content
  };
}

// --- Phase 1+: Alignment rounds ---

async function runAlignmentRound(
  encoderModel: string,
  decoderModel: string,
  encoderCodebook: Codebook,
  decoderCodebook: Codebook,
  testSentence: string,
  roundNum: number
): Promise<{ round: AlignmentRound; encoderFeedback: string; decoderFeedback: string }> {
  
  const cbStr = codebookToString(encoderCodebook.entries);
  
  // Step 1: Encoder encodes the test sentence using its codebook
  const encodeRes = await callAnyModel(encoderModel, {
    messages: [
      { role: 'system', content: ENCODE_WITH_CODEBOOK_PROMPT(cbStr) },
      { role: 'user', content: testSentence }
    ],
    max_tokens: 512,
    temperature: 0.1
  });

  // Step 2: Decoder decodes using its own codebook
  const decoderCbStr = codebookToString(decoderCodebook.entries);
  const decodeRes = await callAnyModel(decoderModel, {
    messages: [
      { role: 'user', content: `${DECODE_WITH_CODEBOOK_PROMPT(decoderCbStr)}\n\nDecode this:\n${encodeRes.content}` }
    ],
    max_tokens: 512,
    temperature: 0.2
  });

  const fidelity = scoreFidelity(testSentence, decodeRes.content);

  // Step 3: Generate feedback for both sides
  const encoderFeedback = `Round ${roundNum}: You encoded "${testSentence}" as "${encodeRes.content}". The decoder interpreted it as: "${decodeRes.content}". Fidelity score: ${(fidelity * 100).toFixed(0)}%.${fidelity < 0.8 ? ' Adjust your codebook to improve clarity.' : ' Good alignment — keep these assignments stable.'}`;
  
  const decoderFeedback = `Round ${roundNum}: You received "${encodeRes.content}" and decoded it as "${decodeRes.content}". The original was: "${testSentence}". Fidelity score: ${(fidelity * 100).toFixed(0)}%.${fidelity < 0.8 ? ' Adjust your codebook to better match the encoder.' : ' Good alignment — keep these assignments stable.'}`;

  const round: AlignmentRound = {
    round: roundNum,
    timestamp: new Date().toISOString(),
    encoder_model: encoderModel,
    decoder_model: decoderModel,
    test_sentence: testSentence,
    encoded_braille: encodeRes.content,
    decoder_interpretation: decodeRes.content,
    fidelity_score: fidelity,
    encoder_codebook_version: encoderCodebook.version,
    decoder_codebook_version: decoderCodebook.version,
    adjustments: []
  };

  console.log(`    Round ${roundNum}: "${testSentence.slice(0, 30)}..." → fidelity: ${(fidelity * 100).toFixed(0)}%`);
  
  return { round, encoderFeedback, decoderFeedback };
}

// --- Refine codebook based on feedback ---

async function refineCodebook(model: string, codebook: Codebook, feedbackHistory: string[]): Promise<Codebook> {
  const feedback = feedbackHistory.slice(-3).join('\n\n'); // last 3 rounds of feedback
  const currentCbStr = codebookToString(codebook.entries);

  const res = await callAnyModel(model, {
    messages: [{ role: 'user', content: REFINE_CODEBOOK_PROMPT(currentCbStr, feedback) }],
    max_tokens: 2048,
    temperature: 0.3
  });

  const entries = parseCodebook(res.content);
  console.log(`  [${model}] Refined codebook: ${entries.length} entries (v${codebook.version + 1})`);

  return {
    model,
    version: codebook.version + 1,
    entries: entries.length > 0 ? entries : codebook.entries, // fallback if parse fails
    raw: res.content
  };
}

// --- Main alignment loop ---

export async function runAlignment(opts?: {
  encoderModel?: string;
  decoderModel?: string;
  maxRounds?: number;
  convergenceThreshold?: number;
}): Promise<AlignmentSession> {
  const models = getAllModels();
  const encoderModel = opts?.encoderModel || models.find(m => m.model.includes('haiku'))?.model || models[0]?.model;
  const decoderModel = opts?.decoderModel || models.find(m => m.model.includes('gemini'))?.model || models[1]?.model;
  const maxRounds = opts?.maxRounds || 6;
  const convergenceThreshold = opts?.convergenceThreshold || 0.75;

  console.log(`\n⠿ ALIGNMENT SESSION`);
  console.log(`  Encoder: ${encoderModel}`);
  console.log(`  Decoder: ${decoderModel}`);
  console.log(`  Max rounds: ${maxRounds}, convergence threshold: ${convergenceThreshold}\n`);

  const session: AlignmentSession = {
    session_id: randomUUID(),
    encoder_model: encoderModel,
    decoder_model: decoderModel,
    rounds: [],
    final_codebook: null,
    convergence_round: null,
    final_fidelity: 0
  };

  // Phase 0: Both models propose initial codebooks
  console.log('  Phase 0: Initial codebook proposals');
  let encoderCodebook = await proposeCodebook(encoderModel);
  let decoderCodebook = await proposeCodebook(decoderModel);

  // Start with the encoder's codebook shared to decoder (they start from a common base)
  // This simulates "publishing" the initial protocol spec
  decoderCodebook = { ...decoderCodebook, entries: [...encoderCodebook.entries], version: 0 };
  console.log(`  Shared initial codebook (${encoderCodebook.entries.length} entries) as starting point.\n`);

  // Alignment rounds
  const encoderFeedbackHistory: string[] = [];
  const decoderFeedbackHistory: string[] = [];
  let consecutiveGood = 0;

  for (let round = 1; round <= maxRounds; round++) {
    const testSentence = ALIGNMENT_SENTENCES[(round - 1) % ALIGNMENT_SENTENCES.length];
    
    const result = await runAlignmentRound(
      encoderModel, decoderModel,
      encoderCodebook, decoderCodebook,
      testSentence, round
    );

    session.rounds.push(result.round);
    encoderFeedbackHistory.push(result.encoderFeedback);
    decoderFeedbackHistory.push(result.decoderFeedback);

    // Check convergence
    if (result.round.fidelity_score >= convergenceThreshold) {
      consecutiveGood++;
      if (consecutiveGood >= 2) {
        session.convergence_round = round;
        console.log(`\n  ✓ CONVERGED at round ${round} (fidelity ≥ ${convergenceThreshold} for 2 consecutive rounds)`);
        break;
      }
    } else {
      consecutiveGood = 0;
    }

    // Refine codebooks every 2 rounds (or if fidelity is low)
    if (round % 2 === 0 || result.round.fidelity_score < 0.5) {
      console.log(`\n  Refining codebooks...`);
      encoderCodebook = await refineCodebook(encoderModel, encoderCodebook, encoderFeedbackHistory);
      decoderCodebook = await refineCodebook(decoderModel, decoderCodebook, decoderFeedbackHistory);
      console.log('');
    }
  }

  // Final stats
  const avgFidelity = session.rounds.length > 0
    ? session.rounds.reduce((s, r) => s + r.fidelity_score, 0) / session.rounds.length
    : 0;
  session.final_fidelity = avgFidelity;
  session.final_codebook = encoderCodebook;

  console.log(`\n  Session complete.`);
  console.log(`  Rounds: ${session.rounds.length}`);
  console.log(`  Average fidelity: ${(avgFidelity * 100).toFixed(1)}%`);
  console.log(`  Final codebook: ${encoderCodebook.entries.length} entries (v${encoderCodebook.version})`);
  if (session.convergence_round) {
    console.log(`  Converged at round: ${session.convergence_round}`);
  } else {
    console.log(`  Did NOT converge within ${maxRounds} rounds.`);
  }

  // Save
  const outPath = join(RESULTS_DIR, `alignment-${session.session_id.slice(0, 8)}.json`);
  writeFileSync(outPath, JSON.stringify(session, null, 2));
  console.log(`  Saved to: ${outPath}\n`);

  return session;
}

// --- Export the shared codebook for use in benchmarks ---

export function loadLatestCodebook(): Codebook | null {
  try {
    const files = require('fs').readdirSync(RESULTS_DIR)
      .filter((f: string) => f.startsWith('alignment-'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const session: AlignmentSession = JSON.parse(readFileSync(join(RESULTS_DIR, files[0]), 'utf-8'));
    return session.final_codebook;
  } catch {
    return null;
  }
}
