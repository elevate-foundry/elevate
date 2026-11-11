/**
 * Signed Random Projection Locality-Sensitive Hashing (SRP-LSH / SimHash)
 *
 * Implements the analog-to-digital bridge described in Spec Section 2.
 *
 * The key insight: standard hashes (SHA-256) maximize avalanche — a single
 * bit change completely changes the output. SRP-LSH does the opposite:
 * similar inputs produce similar outputs. This is how BBID tolerates the
 * natural noise in behavioral biometrics.
 *
 * The projection function h_SRP: R^d_B -> {0,1}^k maps the behavioral
 * vector B onto k random hyperplanes. Each bit w_i = 1 if B is on the
 * positive side of hyperplane r_i, 0 otherwise.
 *
 * Hyperplanes are generated deterministically from a 256-bit seed via
 * AES-CTR-DRBG (Spec Section 6.4.3), so the same seed always produces
 * the same projection matrix. The seed is derived server-side via HKDF
 * and transmitted to the client — never stored.
 */

import { createCipheriv } from 'node:crypto';
import { FEATURE_DIM } from './features.js';

/** Number of bits in the LSH output. BCH(127,64,10) needs n=127. */
export const LSH_BITS = 127;

/**
 * AES-CTR-DRBG: Deterministic Random Bit Generator using AES-128-CTR.
 *
 * Given a 256-bit seed, produces a deterministic stream of pseudorandom
 * bytes. The first 128 bits of the seed become the AES key, the second
 * 128 bits become the initial counter.
 *
 * Spec Section 6.4.3: "The derived user-specific seed is loaded into
 * a cryptographically secure DRBG configured in AES-CTR mode."
 */
export class AesCtrDrbg {
  private key: Uint8Array;
  private counter: Uint8Array;
  private buffer: Uint8Array;
  private offset: number;

  constructor(seed: Uint8Array) {
    if (seed.length !== 32) throw new Error('Seed must be 32 bytes');
    this.key = seed.slice(0, 16);
    this.counter = seed.slice(16, 32);
    this.buffer = new Uint8Array(0);
    this.offset = 0;
  }

  /** Generate the next block of pseudorandom bytes using AES-128-CTR. */
  private generateBlock(): Uint8Array {
    const cipher = createCipheriv('aes-128-ctr', this.key, this.counter);
    const plaintext = new Uint8Array(256);
    const result = new Uint8Array(cipher.update(plaintext));
    cipher.final();
    this.incrementCounter(plaintext.length / 16);
    return result;
  }

  private incrementCounter(blocks: number): void {
    let carry = blocks;
    for (let i = 15; i >= 0 && carry > 0; i--) {
      const val = this.counter[i] + carry;
      this.counter[i] = val & 0xff;
      carry = val >>> 8;
    }
  }

  /** Get the next n pseudorandom bytes. */
  nextBytes(n: number): Uint8Array {
    const result = new Uint8Array(n);
    let written = 0;

    while (written < n) {
      if (this.offset >= this.buffer.length) {
        this.buffer = this.generateBlock();
        this.offset = 0;
      }
      const available = this.buffer.length - this.offset;
      const toCopy = Math.min(available, n - written);
      result.set(this.buffer.subarray(this.offset, this.offset + toCopy), written);
      this.offset += toCopy;
      written += toCopy;
    }

    return result;
  }

  /** Box-Muller transform: generate a normally distributed value from uniform bytes. */
  nextGaussian(): number {
    const bytes = this.nextBytes(8);
    const u1View = new DataView(bytes.buffer, bytes.byteOffset, 4);
    const u2View = new DataView(bytes.buffer, bytes.byteOffset + 4, 4);
    const u1 = (u1View.getUint32(0) >>> 0) / 0x100000000;
    const u2 = (u2View.getUint32(0) >>> 0) / 0x100000000;

    const safeU1 = Math.max(u1, 1e-10);
    return Math.sqrt(-2 * Math.log(safeU1)) * Math.cos(2 * Math.PI * u2);
  }
}

/**
 * Generate the k x d_B projection matrix R from a seed.
 *
 * Each row r_i is drawn from N(0, I_{d_B}) using the AES-CTR-DRBG.
 * Because the DRBG is deterministic, the same seed always produces
 * the same hyperplanes — this is how enrollment and auth stay consistent
 * without storing the matrix.
 *
 * Spec Section 2.2:
 *   R = {r_1, r_2, ..., r_k}, r_i ~ N(0, I_{d_B})
 */
export function generateHyperplanes(seed: Uint8Array, k: number = LSH_BITS, d: number = FEATURE_DIM): Float64Array[] {
  const drbg = new AesCtrDrbg(seed);
  const hyperplanes: Float64Array[] = [];

  for (let i = 0; i < k; i++) {
    const plane = new Float64Array(d);
    for (let j = 0; j < d; j++) {
      plane[j] = drbg.nextGaussian();
    }
    // Normalize the hyperplane vector
    let norm = 0;
    for (let j = 0; j < d; j++) norm += plane[j] ** 2;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let j = 0; j < d; j++) plane[j] /= norm;
    }
    hyperplanes.push(plane);
  }

  return hyperplanes;
}

/**
 * Project a behavioral vector B through the hyperplanes to produce
 * the k-bit hash w.
 *
 * Spec Section 2.3:
 *   w_i = I[r_i . B >= 0]
 *
 * The probability that bit i matches between two sessions is:
 *   P[w_i(B1) = w_i(B2)] = 1 - theta/pi
 * where theta is the angle between B1 and B2.
 *
 * This means small behavioral variations (slightly faster typing today)
 * flip only a few bits, while a completely different person flips ~half.
 */
export function projectToHash(B: Float64Array, hyperplanes: Float64Array[]): Uint8Array {
  const k = hyperplanes.length;
  const numBytes = Math.ceil(k / 8);
  const hash = new Uint8Array(numBytes);

  for (let i = 0; i < k; i++) {
    // Dot product r_i . B
    let dot = 0;
    const r = hyperplanes[i];
    for (let j = 0; j < r.length && j < B.length; j++) {
      dot += r[j] * B[j];
    }

    // w_i = 1 if dot >= 0
    if (dot >= 0) {
      hash[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }

  return hash;
}

/**
 * Compute the Hamming distance between two bitstrings.
 * This is the number of bits that differ — lower means more similar.
 */
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    let xor = a[i] ^ b[i];
    // Popcount
    while (xor) {
      dist += xor & 1;
      xor >>>= 1;
    }
  }
  return dist;
}

/**
 * Normalize a behavioral feature vector before projection.
 *
 * Spec Section 2.6 recommends decorrelation. We use a simplified
 * z-score normalization with running statistics. This ensures that
 * features on different scales (e.g., flight time in ms vs. typing
 * rate in keys/sec) contribute equally to the projection.
 *
 * For a full decorrelation (Walsh transform), the population statistics
 * would need to be maintained server-side.
 */
export function normalizeVector(B: Float64Array, populationMeans?: Float64Array, populationStds?: Float64Array): Float64Array {
  const normalized = new Float64Array(B.length);

  if (populationMeans && populationStds) {
    for (let i = 0; i < B.length; i++) {
      normalized[i] = populationStds[i] > 1e-10
        ? (B[i] - populationMeans[i]) / populationStds[i]
        : 0;
    }
  } else {
    // Without population stats, use sign-preserving log-scaling to compress
    // dynamic range while maintaining direction. Then L2-normalize so the
    // projection only depends on the direction of the vector, not its magnitude.
    for (let i = 0; i < B.length; i++) {
      if (B[i] > 0) {
        normalized[i] = Math.log1p(B[i]);
      } else if (B[i] < 0) {
        normalized[i] = -Math.log1p(-B[i]);
      } else {
        normalized[i] = 0;
      }
    }
    // L2-normalize so SRP-LSH measures angular distance
    let norm = 0;
    for (let i = 0; i < normalized.length; i++) norm += normalized[i] ** 2;
    norm = Math.sqrt(norm);
    if (norm > 1e-10) {
      for (let i = 0; i < normalized.length; i++) normalized[i] /= norm;
    }
  }

  return normalized;
}
