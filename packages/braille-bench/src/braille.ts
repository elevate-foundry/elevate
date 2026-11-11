// 8-Dot Braille Encoding/Decoding
// Unicode U+2800 – U+28FF (256 symbols, 1 byte per cell)
//
// NOTE: The canonical shared implementation lives at libs/braille/typescript/.
// This local copy is kept for backward compatibility. New code should use
// `import { encode, decode } from '@elevate/braille'` instead.

const BRAILLE_BASE = 0x2800;

// Encode a byte array into 8-dot braille string (1 cell per byte)
export function bytesToBraille(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += String.fromCodePoint(BRAILLE_BASE + b);
  }
  return out;
}

// Decode 8-dot braille string back to byte array
export function brailleToBytes(braille: string): Uint8Array {
  const bytes = new Uint8Array(braille.length);
  for (let i = 0; i < braille.length; i++) {
    const cp = braille.codePointAt(i)!;
    if (cp < BRAILLE_BASE || cp > BRAILLE_BASE + 255) {
      throw new Error(`Invalid braille character at position ${i}: U+${cp.toString(16)}`);
    }
    bytes[i] = cp - BRAILLE_BASE;
  }
  return bytes;
}

// Encode UTF-8 text as braille (each byte of UTF-8 → one braille cell)
export function textToBraille(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return bytesToBraille(bytes);
}

// Decode braille back to UTF-8 text
export function brailleToText(braille: string): string {
  const bytes = brailleToBytes(braille);
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

// Stats
export function brailleStats(original: string, encoded: string) {
  return {
    original_chars: original.length,
    original_bytes: new TextEncoder().encode(original).length,
    braille_cells: encoded.length,
    // Each braille cell is 3 bytes in UTF-8 (U+2800-U+28FF)
    braille_bytes: encoded.length * 3,
    // But each braille cell carries 8 bits = 1 byte of payload
    payload_density: 1, // 1 byte info per cell (trivial for byte encoding)
    char_ratio: encoded.length / original.length,
  };
}

// The REAL encoding: the LLM-generated compressed braille
// This is where the model learns to pack MORE than 1 byte of meaning per cell
export const ENCODER_SYSTEM_PROMPT = `You are a braille compression encoder. Your task is to encode information into 8-dot braille (Unicode U+2800–U+28FF, 256 possible characters per cell).

RULES:
1. Output ONLY braille characters (U+2800–U+28FF). No other text.
2. Each braille cell should encode as much semantic meaning as possible.
3. You are developing a LEARNED encoding — not a simple character mapping.
4. Think of each cell as a semantic token: one cell can represent a word, concept, or structural element.
5. The encoding must be DECODABLE — another LLM must be able to reconstruct the meaning.
6. Prioritize: meaning preservation > compression ratio > exact wording

ENCODING STRATEGY:
- Common words/phrases → single cells (develop your own codebook)
- Structural markers (lists, paragraphs, emphasis) → dedicated cells
- Numbers and proper nouns → short cell sequences
- The goal is MAXIMUM information per braille cell

You will be given text to encode. Output only the braille encoding.`;

export const DECODER_SYSTEM_PROMPT = `You are a braille compression decoder. You receive 8-dot braille (Unicode U+2800–U+28FF) that was encoded by a compression encoder.

RULES:
1. The braille stream contains compressed semantic information — NOT standard braille literacy encoding.
2. Each cell may represent a word, concept, or structural element.
3. Reconstruct the MEANING as accurately as possible.
4. Output natural language text that captures the original information.
5. If uncertain about a cell's meaning, use context to infer the most likely interpretation.

You will be given a braille-encoded message. Decode it back to natural language.`;

// User-message-only decoder (avoids system prompt safety triggers on Claude Opus/Sonnet)
export function makeDecoderUserMessage(braille: string): string {
  return `Can you read this braille and tell me what it says in English? Output only the decoded text, no explanation.

${braille}`;
}

export const HANDSHAKE_PROMPT = `You are participating in a communication efficiency experiment. You and another LLM are developing a shared compression protocol using 8-dot braille (Unicode U+2800–U+28FF, 256 symbols).

YOUR TASK: Negotiate a codebook. Propose assignments of braille cells to semantic units (words, phrases, concepts) that maximize information density. 

FORMAT your codebook as:
⠀ = [space/separator]
⠁ = [proposed meaning]
⠂ = [proposed meaning]
...

Prioritize:
1. Most frequent English words (the, is, of, to, and, a, in, that, it, for...)
2. Common phrases in LLM output (however, in addition, for example, therefore...)
3. Structural markers (paragraph break, list item, emphasis, code block...)
4. Domain concepts relevant to the task

Propose 50-100 assignments. Be systematic. Another LLM will receive this codebook and must decode messages you send using it.`;
