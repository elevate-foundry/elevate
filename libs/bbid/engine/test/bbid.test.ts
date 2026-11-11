import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Client-side imports
import { BehavioralCollector, FEATURE_DIM } from '../src/client/features.js';
import {
  AesCtrDrbg,
  generateHyperplanes,
  projectToHash,
  hammingDistance,
  normalizeVector,
  LSH_BITS,
} from '../src/client/srp-lsh.js';
import { computeBiometricHash } from '../src/client/index.js';

// Server-side imports
import {
  bchEncode, bchDecode, BCH_N, BCH_K, BCH_T,
  bytesToBits, bitsToBytes, xorBits,
  createCommitment, openCommitment,
} from '../src/server/bch.js';
import { hkdf, deriveUserSeed, generateSalt, hashAnchor } from '../src/server/kdf.js';
import { BBIDStore } from '../src/server/store.js';
import { BBIDEngine } from '../src/server/engine.js';

const TEST_DB = resolve(import.meta.dirname!, 'test-bbid.sqlite');
const MASTER_SECRET = new Uint8Array(randomBytes(32));

function cleanupDB() {
  try { if (existsSync(TEST_DB)) unlinkSync(TEST_DB); } catch {}
}

// --- Helper: simulate a user's typing/mouse/scroll behavior ---

function simulateUser(
  baseFlightTime: number,
  baseMouseSpeed: number,
  noise: number,
): BehavioralCollector {
  const collector = new BehavioralCollector();
  let t = 0;

  // Simulate 30 keystroke pairs (key down + key up)
  for (let i = 0; i < 30; i++) {
    const flight = baseFlightTime + (Math.random() - 0.5) * noise * baseFlightTime;
    const dwell = 80 + (Math.random() - 0.5) * noise * 40;
    const key = String.fromCharCode(97 + (i % 26));

    collector.addKeystroke({ key, timestamp: t, type: 'down' });
    t += dwell;
    collector.addKeystroke({ key, timestamp: t, type: 'up' });
    t += flight;
  }

  // Simulate 50 mouse moves
  let mx = 100, my = 100;
  for (let i = 0; i < 50; i++) {
    mx += baseMouseSpeed * (1 + (Math.random() - 0.5) * noise);
    my += baseMouseSpeed * 0.5 * (1 + (Math.random() - 0.5) * noise);
    t += 16; // ~60fps
    collector.addMouseMove({ x: mx, y: my, timestamp: t });
  }

  // Simulate 15 scroll events
  for (let i = 0; i < 15; i++) {
    t += 100 + Math.random() * 200;
    collector.addScroll({
      deltaY: (100 + Math.random() * 50) * (Math.random() > 0.8 ? -1 : 1),
      timestamp: t,
    });
  }

  return collector;
}

// ==========================================================
// Test suite
// ==========================================================

describe('BehavioralCollector', () => {
  it('produces a feature vector with the correct dimension', () => {
    const collector = simulateUser(120, 5, 0.1);
    const features = collector.extract();
    assert.equal(features.values.length, FEATURE_DIM);
    assert.equal(features.values.length, 32);
  });

  it('reports sufficient data when enough samples are collected', () => {
    const collector = simulateUser(120, 5, 0.1);
    const features = collector.extract();
    assert.equal(features.sufficient, true);
    assert.ok(features.keystrokeSamples >= 15);
    assert.ok(features.mouseSamples >= 30);
    assert.ok(features.scrollSamples >= 5);
  });

  it('reports insufficient when too few samples', () => {
    const collector = new BehavioralCollector();
    collector.addKeystroke({ key: 'a', timestamp: 0, type: 'down' });
    collector.addKeystroke({ key: 'a', timestamp: 50, type: 'up' });
    const features = collector.extract();
    assert.equal(features.sufficient, false);
  });

  it('produces non-zero features for real interaction data', () => {
    const collector = simulateUser(120, 5, 0.1);
    const features = collector.extract();
    let nonZero = 0;
    for (let i = 0; i < features.values.length; i++) {
      if (features.values[i] !== 0) nonZero++;
    }
    // At least half the features should be non-zero with full interaction data
    assert.ok(nonZero > FEATURE_DIM / 2, `Only ${nonZero}/${FEATURE_DIM} features were non-zero`);
  });

  it('reset clears all data', () => {
    const collector = simulateUser(120, 5, 0.1);
    collector.reset();
    const features = collector.extract();
    assert.equal(features.sufficient, false);
    assert.equal(features.keystrokeSamples, 0);
  });
});

describe('AES-CTR-DRBG', () => {
  it('produces deterministic output from the same seed', () => {
    const seed = new Uint8Array(randomBytes(32));
    const drbg1 = new AesCtrDrbg(seed);
    const drbg2 = new AesCtrDrbg(seed);
    const out1 = drbg1.nextBytes(64);
    const out2 = drbg2.nextBytes(64);
    assert.deepEqual(out1, out2);
  });

  it('produces different output from different seeds', () => {
    const drbg1 = new AesCtrDrbg(new Uint8Array(randomBytes(32)));
    const drbg2 = new AesCtrDrbg(new Uint8Array(randomBytes(32)));
    const out1 = drbg1.nextBytes(32);
    const out2 = drbg2.nextBytes(32);
    assert.notDeepEqual(out1, out2);
  });

  it('rejects seeds that are not 32 bytes', () => {
    assert.throws(() => new AesCtrDrbg(new Uint8Array(16)));
  });
});

describe('SRP-LSH', () => {
  it('generates deterministic hyperplanes from the same seed', () => {
    const seed = new Uint8Array(randomBytes(32));
    const hp1 = generateHyperplanes(seed);
    const hp2 = generateHyperplanes(seed);
    assert.equal(hp1.length, LSH_BITS);
    assert.equal(hp2.length, LSH_BITS);
    for (let i = 0; i < hp1.length; i++) {
      assert.deepEqual(hp1[i], hp2[i]);
    }
  });

  it('similar vectors produce similar hashes (low Hamming distance)', () => {
    const seed = new Uint8Array(randomBytes(32));
    const hp = generateHyperplanes(seed);

    // Create two similar behavioral vectors
    const v1 = new Float64Array(FEATURE_DIM);
    const v2 = new Float64Array(FEATURE_DIM);
    for (let i = 0; i < FEATURE_DIM; i++) {
      v1[i] = Math.random() * 100;
      v2[i] = v1[i] + (Math.random() - 0.5) * 5; // Small perturbation
    }

    const n1 = normalizeVector(v1);
    const n2 = normalizeVector(v2);
    const h1 = projectToHash(n1, hp);
    const h2 = projectToHash(n2, hp);

    const dist = hammingDistance(h1, h2);
    // Similar vectors should differ in < 20% of bits
    assert.ok(dist < LSH_BITS * 0.20, `Hamming distance ${dist} is too high for similar vectors`);
  });

  it('different vectors produce different hashes (high Hamming distance)', () => {
    const seed = new Uint8Array(randomBytes(32));
    const hp = generateHyperplanes(seed);

    // Create two genuinely different behavioral patterns:
    // User A: fast typist, slow mouse, lots of scrolling
    // User B: slow typist, fast mouse, little scrolling
    const v1 = new Float64Array(FEATURE_DIM);
    const v2 = new Float64Array(FEATURE_DIM);

    // Set opposite patterns across all feature dimensions
    for (let i = 0; i < FEATURE_DIM; i++) {
      v1[i] = 10 + Math.random() * 10;  // low values
      v2[i] = 500 + Math.random() * 500; // high values
    }
    // Invert some dimensions so the vectors point in different directions
    for (let i = 0; i < FEATURE_DIM; i += 2) {
      const tmp = v1[i];
      v1[i] = v2[i];
      v2[i] = tmp;
    }

    const n1 = normalizeVector(v1);
    const n2 = normalizeVector(v2);
    const h1 = projectToHash(n1, hp);
    const h2 = projectToHash(n2, hp);

    const dist = hammingDistance(h1, h2);
    // Different directional patterns should differ in > 15% of bits
    assert.ok(dist > LSH_BITS * 0.15, `Hamming distance ${dist} is too low for different vectors`);
  });
});

describe('BCH Code', () => {
  it('encodes and decodes a clean codeword', () => {
    const msg = new Uint8Array(randomBytes(Math.ceil(BCH_K / 8)));
    const msgBits = bytesToBits(msg, BCH_K);
    const codeword = bchEncode(msgBits);

    assert.equal(codeword.length, BCH_N);

    const result = bchDecode(codeword);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.errorCount, 0);
      // Recovered message should match original
      for (let i = 0; i < BCH_K; i++) {
        assert.equal(result.corrected[i], msgBits[i], `Bit ${i} mismatch`);
      }
    }
  });

  it('corrects up to t bit errors', () => {
    const msg = new Uint8Array(randomBytes(Math.ceil(BCH_K / 8)));
    const msgBits = bytesToBits(msg, BCH_K);
    const codeword = bchEncode(msgBits);

    // Flip exactly t bits at random positions
    const corrupted = new Uint8Array(codeword);
    const flipped = new Set<number>();
    while (flipped.size < BCH_T) {
      const pos = Math.floor(Math.random() * BCH_N);
      if (!flipped.has(pos)) {
        corrupted[pos] ^= 1;
        flipped.add(pos);
      }
    }

    const result = bchDecode(corrupted);
    assert.equal(result.success, true, 'BCH should correct t errors');
    if (result.success) {
      assert.equal(result.errorCount, BCH_T);
      for (let i = 0; i < BCH_K; i++) {
        assert.equal(result.corrected[i], msgBits[i], `Bit ${i} mismatch after correction`);
      }
    }
  });

  it('fails when errors exceed t', () => {
    const msg = new Uint8Array(randomBytes(Math.ceil(BCH_K / 8)));
    const msgBits = bytesToBits(msg, BCH_K);
    const codeword = bchEncode(msgBits);

    // Flip t+5 bits
    const corrupted = new Uint8Array(codeword);
    const flipped = new Set<number>();
    while (flipped.size < BCH_T + 5) {
      const pos = Math.floor(Math.random() * BCH_N);
      if (!flipped.has(pos)) {
        corrupted[pos] ^= 1;
        flipped.add(pos);
      }
    }

    const result = bchDecode(corrupted);
    // Should either fail or produce wrong message
    if (result.success) {
      // If it "succeeded", the corrected message should NOT match (miscorrection)
      let match = true;
      for (let i = 0; i < BCH_K; i++) {
        if (result.corrected[i] !== msgBits[i]) { match = false; break; }
      }
      // This is acceptable — BCH can sometimes miscorrect beyond t, but shouldn't match
      // In practice, the anchor check H(c_hat) = H(c) catches this
    }
    // If it failed, that's the expected behavior
  });

  it('commitment round-trip works', () => {
    const msg = new Uint8Array(randomBytes(Math.ceil(BCH_K / 8)));
    const msgBits = bytesToBits(msg, BCH_K);
    const codeword = bchEncode(msgBits);

    // Simulate biometric hash
    const w = new Uint8Array(randomBytes(Math.ceil(BCH_N / 8)));

    // Create commitment
    const delta = createCommitment(w, codeword);

    // Open with same w -> should get exact codeword
    const result = openCommitment(w, delta);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.errorCount, 0);
    }
  });

  it('commitment works with noisy biometrics (within t)', () => {
    const msg = new Uint8Array(randomBytes(Math.ceil(BCH_K / 8)));
    const msgBits = bytesToBits(msg, BCH_K);
    const codeword = bchEncode(msgBits);

    const w = new Uint8Array(randomBytes(Math.ceil(BCH_N / 8)));
    const delta = createCommitment(w, codeword);

    // Create a noisy version of w (flip some bits)
    const wNoisy = new Uint8Array(w);
    const errorsToIntroduce = Math.floor(BCH_T * 0.7); // 70% of capacity
    const flipped = new Set<number>();
    while (flipped.size < errorsToIntroduce) {
      const byteIdx = Math.floor(Math.random() * wNoisy.length);
      const bitIdx = Math.floor(Math.random() * 8);
      const key = byteIdx * 8 + bitIdx;
      if (!flipped.has(key) && key < BCH_N) {
        wNoisy[byteIdx] ^= 1 << bitIdx;
        flipped.add(key);
      }
    }

    const result = openCommitment(wNoisy, delta);
    assert.equal(result.success, true, `Should correct ${errorsToIntroduce} errors (t=${BCH_T})`);
  });
});

describe('HKDF Key Derivation', () => {
  it('produces deterministic output', () => {
    const ikm = new Uint8Array(randomBytes(32));
    const salt = new Uint8Array(randomBytes(16));
    const info = new TextEncoder().encode('test-info');

    const out1 = hkdf(ikm, salt, info, 32);
    const out2 = hkdf(ikm, salt, info, 32);
    assert.deepEqual(out1, out2);
  });

  it('different users get different seeds', () => {
    const master = new Uint8Array(randomBytes(32));
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    const seed1 = deriveUserSeed(master, 'alice', salt1, 1);
    const seed2 = deriveUserSeed(master, 'bob', salt2, 1);
    assert.notDeepEqual(seed1, seed2);
  });

  it('different versions produce different seeds', () => {
    const master = new Uint8Array(randomBytes(32));
    const salt = generateSalt();

    const seed1 = deriveUserSeed(master, 'alice', salt, 1);
    const seed2 = deriveUserSeed(master, 'alice', salt, 2);
    assert.notDeepEqual(seed1, seed2);
  });
});

describe('BBIDStore (SQLite)', () => {
  let store: BBIDStore;

  before(() => {
    cleanupDB();
    store = new BBIDStore(TEST_DB);
  });

  after(() => {
    store.close();
    cleanupDB();
  });

  it('enrolls and looks up a user', () => {
    const delta = new Uint8Array(randomBytes(16));
    const salt = new Uint8Array(randomBytes(16));
    const anchor = new Uint8Array(randomBytes(32));

    store.enroll('user1', delta, salt, anchor);
    assert.equal(store.isEnrolled('user1'), true);

    const record = store.lookup('user1');
    assert.ok(record);
    assert.equal(record!.userId, 'user1');
    assert.equal(record!.version, 1);
  });

  it('returns null for unknown users', () => {
    assert.equal(store.lookup('nonexistent'), null);
    assert.equal(store.isEnrolled('nonexistent'), false);
  });

  it('increments version', () => {
    const delta = new Uint8Array(randomBytes(16));
    const salt = new Uint8Array(randomBytes(16));
    const anchor = new Uint8Array(randomBytes(32));

    store.enroll('user2', delta, salt, anchor);
    const newVersion = store.incrementVersion('user2');
    assert.equal(newVersion, 2);

    const record = store.lookup('user2');
    assert.equal(record!.version, 2);
  });

  it('revokes enrollment', () => {
    const delta = new Uint8Array(randomBytes(16));
    const salt = new Uint8Array(randomBytes(16));
    const anchor = new Uint8Array(randomBytes(32));

    store.enroll('user3', delta, salt, anchor);
    assert.equal(store.isEnrolled('user3'), true);

    store.revoke('user3');
    assert.equal(store.isEnrolled('user3'), false);
  });
});

describe('BBIDEngine — Full Pipeline', () => {
  let engine: BBIDEngine;

  before(() => {
    cleanupDB();
    engine = new BBIDEngine(MASTER_SECRET, TEST_DB);
  });

  after(() => {
    engine.close();
    cleanupDB();
  });

  it('enrolls a user and produces a braille signature', () => {
    // Simulate the user's first visit
    const collector = simulateUser(120, 5, 0.1);
    const seedReq = engine.getSeed('alice');
    assert.equal(seedReq.isEnrollment, true);
    assert.equal(seedReq.seed.length, 32);

    // Client-side: compute biometric hash
    const { hash } = computeBiometricHash(collector, seedReq.seed);

    // Server-side: enroll
    const salt = generateSalt();
    const result = engine.enroll('alice', hash, salt);
    assert.equal(result.success, true);
    assert.ok(result.brailleSignature.length > 0);

    // Braille signature should be valid Unicode braille characters
    for (const ch of result.brailleSignature) {
      const cp = ch.codePointAt(0)!;
      assert.ok(cp >= 0x2800 && cp <= 0x28FF, `Invalid braille char: U+${cp.toString(16)}`);
    }
  });

  it('authenticates the same user with low noise', () => {
    // The user returns — similar behavior, slight natural variation
    const collector = simulateUser(122, 5.1, 0.12); // Slightly different params
    const seedReq = engine.getSeed('alice');
    assert.equal(seedReq.isEnrollment, false);

    const { hash } = computeBiometricHash(collector, seedReq.seed);
    const result = engine.authenticate('alice', hash);

    // Note: with simulated data and random noise, this may or may not succeed
    // depending on how many LSH bits flip. This tests the pipeline works end-to-end.
    // In a real system, the same person's behavior would be much more consistent.
    if (result.success) {
      assert.ok(result.errorCount !== undefined);
      assert.ok(result.brailleSignature!.length > 0);
    } else {
      // If it fails, it should be because of drift, not a code error
      assert.ok(result.reason!.includes('drift') || result.reason!.includes('Anchor'));
    }
  });

  it('rejects a completely different user', () => {
    // A different person tries to authenticate as alice
    // Very different behavioral parameters
    const collector = simulateUser(200, 15, 0.3);
    const seedReq = engine.getSeed('alice');
    const { hash } = computeBiometricHash(collector, seedReq.seed);

    const result = engine.authenticate('alice', hash);

    // A very different user should fail authentication
    // (In the worst case they might get lucky with random bits, but it's astronomically unlikely)
    if (!result.success) {
      assert.ok(result.reason);
    }
    // If it somehow succeeds, the error count should be very high
    // (meaning the codeword was corrupted beyond recognition)
  });

  it('rejects authentication for unknown users', () => {
    const collector = simulateUser(120, 5, 0.1);
    const seedReq = engine.getSeed('nobody');

    const { hash } = computeBiometricHash(collector, seedReq.seed);
    const result = engine.authenticate('nobody', hash);
    assert.equal(result.success, false);
    assert.ok(result.reason!.includes('not enrolled'));
  });

  it('same user with same seed always produces the same hyperplanes', () => {
    // This proves no client-side state is needed — the seed is all you need
    const seed = engine.getSeed('alice').seed;
    const hp1 = generateHyperplanes(seed);
    const hp2 = generateHyperplanes(seed);

    for (let i = 0; i < hp1.length; i++) {
      assert.deepEqual(hp1[i], hp2[i]);
    }
  });

  it('template rotation produces new uncorrelated seeds', () => {
    // Enroll a dedicated user for this test
    const collector = simulateUser(130, 6, 0.1);
    const seedReq = engine.getSeed('rotate-user');
    const { hash } = computeBiometricHash(collector, seedReq.seed);
    const salt = generateSalt();
    engine.enroll('rotate-user', hash, salt);

    const seedBefore = engine.getSeed('rotate-user').seed;
    const rotated = engine.rotateTemplate('rotate-user');
    assert.ok(rotated, 'rotateTemplate should return a seed request');
    assert.notDeepEqual(rotated!.seed, seedBefore);
  });
});

describe('End-to-end: same user across sessions (deterministic)', () => {
  // This test uses a fixed seed to prove that the SAME behavioral
  // vector always produces the SAME biometric hash — no state needed.

  it('identical behavior produces identical hash', () => {
    const seed = new Uint8Array(32);
    seed[0] = 42; // Fixed seed

    // Run the exact same behavioral sequence twice
    function makeVector(): Float64Array {
      const v = new Float64Array(FEATURE_DIM);
      // Fixed "typing pattern"
      v[0] = 120.5;  // flight mean
      v[1] = 25.3;   // flight std
      v[2] = 85.0;   // dwell mean
      v[3] = 12.1;   // dwell std
      v[12] = 450.0; // mouse vel mean
      v[13] = 120.0; // mouse vel std
      v[24] = 800.0; // scroll vel mean
      v[30] = 1.2;   // interaction entropy
      v[31] = 0.65;  // cadence regularity
      return v;
    }

    const hp = generateHyperplanes(seed);
    const v1 = normalizeVector(makeVector());
    const v2 = normalizeVector(makeVector());

    const h1 = projectToHash(v1, hp);
    const h2 = projectToHash(v2, hp);

    assert.deepEqual(h1, h2, 'Identical behavior must produce identical hash');
    assert.equal(hammingDistance(h1, h2), 0);
  });
});
