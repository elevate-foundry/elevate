/**
 * BCH (Bose-Chaudhuri-Hocquenghem) Error-Correcting Code
 *
 * Implements BCH(127, k, t) over GF(2^7):
 *   n = 127 (block length = 2^7 - 1)
 *   t = 10  (corrects up to 10 bit errors)
 *   k = n - deg(g(x)) (message bits, determined by generator polynomial)
 *
 * This is the fuzzy commitment engine from Spec Section 3. The BCH code
 * is what lets BBID tolerate behavioral noise between sessions. If your
 * typing speed varies by a small amount, the SRP-LSH hash will flip a
 * few bits — but as long as <= t bits flip, BCH snaps you back to
 * your exact canonical identity codeword.
 */

// --- GF(2^7) parameters ---
const M = 7;
const N = (1 << M) - 1; // 127
const T = 10;

/** Primitive polynomial for GF(2^7): x^7 + x^3 + 1 */
const PRIM_POLY = (1 << 7) | (1 << 3) | 1; // 137

// --- GF(2^7) arithmetic via lookup tables ---

const gfExp = new Int32Array(N * 2); // alpha^i -> element
const gfLog = new Int32Array(N + 1); // element -> log_alpha

(function initGF() {
  let x = 1;
  for (let i = 0; i < N; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x >= (1 << M)) x ^= PRIM_POLY;
  }
  for (let i = N; i < N * 2; i++) gfExp[i] = gfExp[i - N];
  gfLog[0] = -1;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return gfExp[(gfLog[a] + gfLog[b]) % N];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF');
  if (a === 0) return 0;
  return gfExp[(gfLog[a] - gfLog[b] + N) % N];
}

function gfPow(a: number, p: number): number {
  if (a === 0) return 0;
  return gfExp[(gfLog[a] * ((p % N) + N)) % N];
}

function gfInv(a: number): number {
  if (a === 0) throw new Error('Cannot invert 0');
  return gfExp[(N - gfLog[a]) % N];
}

// --- Binary minimal polynomial computation ---

/**
 * Compute the minimal polynomial of alpha^i over GF(2).
 * The minimal polynomial has binary (0/1) coefficients.
 * Its roots are the conjugates: alpha^i, alpha^{2i}, alpha^{4i}, ...
 */
function minimalPoly(i: number): number[] {
  // Find all conjugates of alpha^i
  const conjugates: number[] = [];
  const seen = new Set<number>();
  let exp = i % N;
  while (!seen.has(exp)) {
    seen.add(exp);
    conjugates.push(exp);
    exp = (exp * 2) % N;
  }

  // Build polynomial from roots: product of (x + alpha^c) for each conjugate
  // We work in GF(2^7)[x] then verify coefficients are in GF(2)
  let poly = [1]; // start with "1"
  for (const c of conjugates) {
    const root = gfExp[c];
    const newPoly = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      newPoly[j + 1] ^= poly[j]; // multiply by x
      newPoly[j] ^= gfMul(poly[j], root); // multiply by root
    }
    poly = newPoly;
  }

  // Verify all coefficients are 0 or 1 (binary)
  const binary = poly.map(c => c & 1);
  return binary;
}

/**
 * Compute the generator polynomial g(x) for BCH(N, k, T).
 * g(x) = LCM of minimal polynomials of alpha^1 through alpha^{2T}.
 * Returns binary coefficients.
 */
function computeGenerator(): number[] {
  let gen = [1]; // g(x) = 1 initially

  const processedClasses = new Set<string>();

  for (let i = 1; i <= 2 * T; i++) {
    // Find the conjugacy class of alpha^i
    const classMembers: number[] = [];
    let exp = i % N;
    const classSet = new Set<number>();
    while (!classSet.has(exp)) {
      classSet.add(exp);
      classMembers.push(exp);
      exp = (exp * 2) % N;
    }

    // Create a canonical key for this class
    const classKey = [...classSet].sort((a, b) => a - b).join(',');
    if (processedClasses.has(classKey)) continue;
    processedClasses.add(classKey);

    // Get the minimal polynomial for this class
    const mp = minimalPoly(i);

    // Multiply gen by mp (polynomial multiplication over GF(2))
    const newGen = new Array(gen.length + mp.length - 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      if (gen[j] === 0) continue;
      for (let k = 0; k < mp.length; k++) {
        if (mp[k] === 0) continue;
        newGen[j + k] ^= 1;
      }
    }
    gen = newGen;
  }

  return gen;
}

const GENERATOR = computeGenerator();
const PARITY_LEN = GENERATOR.length - 1;
const ACTUAL_K = N - PARITY_LEN;

// --- Encoding ---

/**
 * Systematic BCH encoding.
 * Input: ACTUAL_K message bits
 * Output: N codeword bits (message + parity)
 *
 * Computes: codeword = message * x^(n-k) + (message * x^(n-k) mod g(x))
 */
export function bchEncode(message: Uint8Array): Uint8Array {
  if (message.length < ACTUAL_K) {
    // Pad with zeros
    const padded = new Uint8Array(ACTUAL_K);
    padded.set(message);
    return bchEncodeInternal(padded);
  }
  return bchEncodeInternal(message.slice(0, ACTUAL_K));
}

function bchEncodeInternal(msgBits: Uint8Array): Uint8Array {
  // Shift message by parity length: m(x) * x^(n-k)
  const shifted = new Uint8Array(N);
  for (let i = 0; i < ACTUAL_K; i++) {
    shifted[i] = msgBits[i];
  }

  // Compute remainder: shifted mod g(x) using synthetic division
  const reg = new Uint8Array(PARITY_LEN);
  for (let i = 0; i < ACTUAL_K; i++) {
    const feedback = shifted[i] ^ reg[0];
    // Shift register
    for (let j = 0; j < PARITY_LEN - 1; j++) {
      reg[j] = reg[j + 1] ^ (feedback & GENERATOR[j + 1]);
    }
    reg[PARITY_LEN - 1] = feedback & GENERATOR[PARITY_LEN];
  }

  // Codeword = message bits followed by parity bits
  const codeword = new Uint8Array(N);
  for (let i = 0; i < ACTUAL_K; i++) codeword[i] = msgBits[i];
  for (let i = 0; i < PARITY_LEN; i++) codeword[ACTUAL_K + i] = reg[i];

  return codeword;
}

// --- Syndrome computation ---

/**
 * Compute syndromes S_1 through S_{2T}.
 * S_i = r(alpha^i), where r(x) is the received polynomial.
 */
function computeSyndromes(received: Uint8Array): number[] {
  const syndromes: number[] = [0]; // S[0] unused; S[1]..S[2T]
  for (let i = 1; i <= 2 * T; i++) {
    let s = 0;
    for (let j = 0; j < N; j++) {
      if (received[j]) {
        s ^= gfExp[(i * j) % N];
      }
    }
    syndromes.push(s);
  }
  return syndromes;
}

// --- Berlekamp-Massey algorithm ---

/**
 * Find error locator polynomial sigma(x) using Berlekamp-Massey.
 */
function berlekampMassey(syndromes: number[]): number[] {
  const n2t = 2 * T;
  // sigma = current LFSR connection polynomial
  let sigma = new Array(n2t + 2).fill(0);
  let prev = new Array(n2t + 2).fill(0);
  sigma[0] = 1;
  prev[0] = 1;

  let L = 0;
  let m = 1;
  let b = 1; // previous discrepancy

  for (let r = 1; r <= n2t; r++) {
    // Compute discrepancy d_r
    let d = syndromes[r];
    for (let i = 1; i <= L; i++) {
      d ^= gfMul(sigma[i], syndromes[r - i]);
    }

    if (d === 0) {
      m++;
      continue;
    }

    // Temp copy
    const temp = [...sigma];
    const coeff = gfDiv(d, b);

    for (let i = m; i <= n2t; i++) {
      sigma[i] ^= gfMul(coeff, prev[i - m]);
    }

    if (2 * L <= r - 1) {
      L = r - L;
      prev = temp;
      b = d;
      m = 1;
    } else {
      m++;
    }
  }

  // Trim trailing zeros to get the actual degree
  let deg = 0;
  for (let i = sigma.length - 1; i >= 0; i--) {
    if (sigma[i] !== 0) { deg = i; break; }
  }
  return sigma.slice(0, deg + 1);
}

// --- Chien search ---

/**
 * Find error positions using Chien search.
 * We evaluate sigma(alpha^{-j}) for j = 0..N-1.
 * If sigma(alpha^{-j}) = 0, then position j has an error.
 */
function chienSearch(sigma: number[]): number[] {
  const positions: number[] = [];
  const deg = sigma.length - 1;

  for (let j = 0; j < N; j++) {
    // Evaluate sigma at alpha^{-j} = alpha^{N-j}
    let val = sigma[0]; // = 1
    for (let i = 1; i <= deg; i++) {
      if (sigma[i] !== 0) {
        val ^= gfMul(sigma[i], gfExp[((N - j) * i) % N]);
      }
    }
    if (val === 0) {
      positions.push(j);
    }
  }

  return positions;
}

// --- Decoding ---

/**
 * Decode a (possibly corrupted) BCH codeword.
 *
 * Returns corrected message bits (first ACTUAL_K bits) or failure.
 */
export function bchDecode(received: Uint8Array): { success: true; corrected: Uint8Array; errorCount: number } | { success: false } {
  if (received.length !== N) return { success: false };

  // Step 1: Syndromes
  const syndromes = computeSyndromes(received);

  let allZero = true;
  for (let i = 1; i <= 2 * T; i++) {
    if (syndromes[i] !== 0) { allZero = false; break; }
  }
  if (allZero) {
    return { success: true, corrected: received.slice(0, ACTUAL_K), errorCount: 0 };
  }

  // Step 2: Berlekamp-Massey
  const sigma = berlekampMassey(syndromes);
  const numErrors = sigma.length - 1;

  if (numErrors > T) return { success: false };

  // Step 3: Chien search
  const errorPositions = chienSearch(sigma);

  if (errorPositions.length !== numErrors) return { success: false };

  // Step 4: Correct
  const corrected = new Uint8Array(received);
  for (const pos of errorPositions) {
    if (pos >= 0 && pos < N) corrected[pos] ^= 1;
  }

  // Step 5: Verify
  const checkSyndromes = computeSyndromes(corrected);
  for (let i = 1; i <= 2 * T; i++) {
    if (checkSyndromes[i] !== 0) return { success: false };
  }

  return { success: true, corrected: corrected.slice(0, ACTUAL_K), errorCount: numErrors };
}

// --- Bit/byte conversion ---

export function bytesToBits(bytes: Uint8Array, numBits: number): Uint8Array {
  const bits = new Uint8Array(numBits);
  for (let i = 0; i < numBits; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    if (byteIdx < bytes.length) {
      bits[i] = (bytes[byteIdx] >> bitIdx) & 1;
    }
  }
  return bits;
}

export function bitsToBytes(bits: Uint8Array): Uint8Array {
  const numBytes = Math.ceil(bits.length / 8);
  const bytes = new Uint8Array(numBytes);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      bytes[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }
  return bytes;
}

export function xorBits(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < result.length; i++) {
    result[i] = (a[i] || 0) ^ (b[i] || 0);
  }
  return result;
}

// --- Public API ---

export const BCH_N = N;
export const BCH_K = ACTUAL_K;
export const BCH_T = T;

/**
 * Generate a random codeword from the BCH codebook.
 */
export function generateCodeword(randomBytes: Uint8Array): { codeword: Uint8Array; message: Uint8Array } {
  const message = bytesToBits(randomBytes, ACTUAL_K);
  const codeword = bchEncode(message);
  return { codeword, message };
}

/**
 * Create commitment: delta = w XOR c (Spec Section 3.3 step 3)
 */
export function createCommitment(biometricHash: Uint8Array, codeword: Uint8Array): Uint8Array {
  const wBits = bytesToBits(biometricHash, N);
  return xorBits(wBits, codeword);
}

/**
 * Open commitment: recover codeword from new hash + stored delta (Spec Section 3.4)
 */
export function openCommitment(biometricHash: Uint8Array, delta: Uint8Array): ReturnType<typeof bchDecode> {
  const wBits = bytesToBits(biometricHash, N);
  const noisyCodeword = xorBits(wBits, delta);
  return bchDecode(noisyCodeword);
}
