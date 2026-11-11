/**
 * @elevate/braille — Canonical braille byte codec for the Elevate Foundry ecosystem.
 *
 * The 256 Unicode Braille characters (U+2800 to U+28FF) map 1:1 to byte values
 * 0x00-0xFF. Each character's Unicode codepoint offset from U+2800 IS the byte
 * value. This gives us a natural, lossless, bijective encoding.
 *
 * This is the single canonical implementation used across all Elevate packages.
 */

export const BRAILLE_BASE = 0x2800;

// Pre-compute lookup tables
const BYTE_TO_BRAILLE: string[] = Array.from({ length: 256 }, (_, i) =>
  String.fromCodePoint(BRAILLE_BASE + i)
);
const BRAILLE_TO_BYTE = new Map<string, number>(
  Array.from({ length: 256 }, (_, i) => [String.fromCodePoint(BRAILLE_BASE + i), i])
);

// 8-dot braille dot bit positions
const DOT_BITS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];

/** Encode arbitrary bytes as a Braille Unicode string. */
export function encode(data: Uint8Array): string {
  let result = '';
  for (const byte of data) {
    result += BYTE_TO_BRAILLE[byte];
  }
  return result;
}

/**
 * Decode a Braille Unicode string back to bytes.
 * Strict: throws on non-Braille characters. Use extractBraille() first for mixed input.
 */
export function decode(braille: string): Uint8Array {
  const result = new Uint8Array(braille.length);
  for (let i = 0; i < braille.length; i++) {
    const cp = braille.codePointAt(i)! - BRAILLE_BASE;
    if (cp < 0 || cp > 255) {
      throw new Error(
        `Character at position ${i} is not a Braille pattern: U+${braille.codePointAt(i)!.toString(16).toUpperCase().padStart(4, '0')}`
      );
    }
    result[i] = cp;
  }
  return result;
}

/** Encode a hex string as Braille. */
export function encodeHex(hexStr: string): string {
  const clean = hexStr.replace(/\s/g, '').replace(/^0[xX]/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return encode(bytes);
}

/** Encode a UTF-8 text string as Braille. */
export function encodeText(text: string): string {
  return encode(new TextEncoder().encode(text));
}

/** Decode a Braille string back to UTF-8 text. */
export function decodeText(braille: string): string {
  return new TextDecoder().decode(decode(braille));
}

/** Check if a single character is a Braille pattern (U+2800-U+28FF). */
export function isBraille(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  return cp >= BRAILLE_BASE && cp <= BRAILLE_BASE + 255;
}

/** Extract only Braille characters from mixed text. */
export function extractBraille(text: string): string {
  return [...text].filter(isBraille).join('');
}

/** Convert a single Braille character to its 8-dot pattern. */
export function toDots(char: string): boolean[] {
  const cp = (char.codePointAt(0) ?? 0) - BRAILLE_BASE;
  if (cp < 0 || cp > 255) {
    throw new Error(`Not a Braille character: U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
  return DOT_BITS.map(bit => !!(cp & bit));
}

/** Convert an 8-dot pattern to a Braille character. */
export function fromDots(dots: boolean[]): string {
  if (dots.length !== 8) throw new Error(`Expected 8 dots, got ${dots.length}`);
  const byte = DOT_BITS.reduce((acc, bit, i) => acc | (dots[i] ? bit : 0), 0);
  return String.fromCodePoint(BRAILLE_BASE + byte);
}

/** Convert Braille string to hex representation. */
export function toHex(braille: string): string {
  return [...decode(braille)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Braille fingerprint: SHA-256 hash of data, take first `width` bytes, encode as Braille.
 * Requires Web Crypto (Node 18+ or browser).
 */
export async function fingerprintBytes(data: Uint8Array, width = 4): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return encode(new Uint8Array(hash).slice(0, width));
}

/** Fingerprint a UTF-8 string. */
export async function fingerprintStr(text: string, width = 4): Promise<string> {
  return fingerprintBytes(new TextEncoder().encode(text), width);
}

/**
 * Synchronous fingerprint using createHash (Node.js only).
 * Falls back to this when crypto.subtle is unavailable.
 */
export function fingerprintBytesSync(data: Uint8Array, width = 4): string {
  // Dynamic import to avoid breaking browser builds
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto');
  const hash = createHash('sha256').update(data).digest();
  return encode(hash.subarray(0, width));
}

/** Hamming-distance-based similarity between two Braille fingerprints. Returns 0.0-1.0. */
export function similarity(fp1: string, fp2: string): number {
  if (fp1.length !== fp2.length) {
    throw new Error(`Fingerprints must have same length: ${fp1.length} vs ${fp2.length}`);
  }
  if (!fp1.length) return 1.0;

  const totalBits = fp1.length * 8;
  let matchingBits = 0;

  for (let i = 0; i < fp1.length; i++) {
    const b1 = (fp1.codePointAt(i)! - BRAILLE_BASE);
    const b2 = (fp2.codePointAt(i)! - BRAILLE_BASE);
    const xor = b1 ^ b2;
    // popcount
    let diff = xor;
    diff = diff - ((diff >> 1) & 0x55);
    diff = (diff & 0x33) + ((diff >> 2) & 0x33);
    diff = (diff + (diff >> 4)) & 0x0f;
    matchingBits += 8 - diff;
  }

  return matchingBits / totalBits;
}

/** Raw Hamming distance in bits between two Braille fingerprints. */
export function hammingDistance(fp1: string, fp2: string): number {
  if (fp1.length !== fp2.length) {
    throw new Error(`Fingerprints must have same length: ${fp1.length} vs ${fp2.length}`);
  }
  let distance = 0;
  for (let i = 0; i < fp1.length; i++) {
    const b1 = (fp1.codePointAt(i)! - BRAILLE_BASE);
    const b2 = (fp2.codePointAt(i)! - BRAILLE_BASE);
    let xor = b1 ^ b2;
    while (xor) { distance++; xor &= xor - 1; }
  }
  return distance;
}
