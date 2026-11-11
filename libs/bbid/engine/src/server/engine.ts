/**
 * BBID Authentication Engine
 *
 * The complete enrollment and authentication pipeline from the formal spec.
 *
 * Enrollment (first visit, Spec Section 3.3):
 *   1. Client captures behavioral vector X, computes biometric hash w
 *   2. Server generates random codeword c from BCH codebook
 *   3. Server computes blinding factor delta = w XOR c
 *   4. Server stores delta, salt, version, H(c) in SQLite
 *   5. Neither X nor w ever touch the server's disk
 *
 * Authentication (returning visit, Spec Section 3.4):
 *   1. Client captures new behavioral vector X', computes hash w'
 *   2. Server retrieves delta and computes c' = w' XOR delta
 *   3. BCH decoder corrects noise: c_hat = Decode_BCH(c')
 *   4. If d_H(c', c) <= t, decoder recovers exact c, server verifies H(c_hat) = H(c)
 *   5. Identity confirmed without storing or comparing raw biometrics
 *
 * The magic: two sessions from the same person produce similar-but-not-identical
 * biometric hashes. The BCH code corrects the difference. Two different people
 * produce hashes that differ in ~50% of bits — far beyond the correction threshold.
 */

import { BBIDStore, type EnrollmentRecord } from './store.js';
import { deriveUserSeed, generateSalt, generateRandomKey, hashAnchor } from './kdf.js';
import {
  bchEncode, bchDecode, createCommitment, openCommitment,
  BCH_N, BCH_K, BCH_T,
  bytesToBits, bitsToBytes, xorBits,
} from './bch.js';

// --- Result types ---

export interface EnrollResult {
  success: true;
  userId: string;
  /** The user-specific seed to send to the client (over TLS). Client uses this to generate hyperplanes. */
  seed: Uint8Array;
  /** Braille-encoded identity signature (BBES, Spec Section 4) */
  brailleSignature: string;
}

export interface AuthResult {
  success: boolean;
  userId: string;
  /** Number of bit errors corrected (0 = exact match) */
  errorCount?: number;
  /** Braille-encoded identity signature */
  brailleSignature?: string;
  /** Whether silent re-enrollment was triggered (Spec Section 8.3.1) */
  reEnrolled?: boolean;
  /** Reason for failure */
  reason?: string;
}

export interface SeedRequest {
  userId: string;
  /** The seed for hyperplane generation — ephemeral, not stored client-side */
  seed: Uint8Array;
  /** Whether this is a new enrollment */
  isEnrollment: boolean;
}

// --- BBES Braille encoding (Spec Section 4) ---

/**
 * Map a byte array to Unicode Braille characters.
 * Each byte maps to U+2800 + byte_value (Spec Section 4.4).
 */
function toBraille(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCodePoint(0x2800 + bytes[i]);
  }
  return result;
}

// --- Engine ---

export class BBIDEngine {
  private store: BBIDStore;
  private masterSecret: Uint8Array;

  /**
   * @param masterSecret The system master secret M_sys (32+ bytes).
   *   In production: from env var or TEE. For testing: any 32 bytes.
   * @param dbPath Path to SQLite database (default: ./bbid.sqlite)
   */
  constructor(masterSecret: Uint8Array, dbPath?: string) {
    if (masterSecret.length < 32) {
      throw new Error('Master secret must be at least 32 bytes');
    }
    this.masterSecret = masterSecret;
    this.store = new BBIDStore(dbPath);
  }

  /**
   * Step 1 of any flow: client requests a seed for hyperplane generation.
   *
   * For new users: generates salt, derives seed, returns it.
   * For returning users: looks up salt + version, re-derives the same seed.
   *
   * The seed is ephemeral — client expands it to hyperplanes, projects
   * the behavioral vector, then zeros it out (Spec Section 6.4.4).
   */
  getSeed(userId: string): SeedRequest {
    const existing = this.store.lookup(userId);

    if (existing) {
      const seed = deriveUserSeed(
        this.masterSecret, userId, new Uint8Array(existing.salt), existing.version,
      );
      return { userId, seed, isEnrollment: false };
    } else {
      const salt = generateSalt();
      const seed = deriveUserSeed(this.masterSecret, userId, salt, 1);
      // Store salt temporarily — will be committed during enrollment
      // For now, just return the seed. The salt gets stored on enroll().
      return { userId, seed, isEnrollment: true, };
    }
  }

  /**
   * Enrollment: register a new user's behavioral biometric.
   *
   * Spec Section 3.3:
   *   1. Client has already computed biometric hash w using the seed from getSeed()
   *   2. We generate a random BCH codeword c
   *   3. Compute delta = w XOR c
   *   4. Store delta, salt, version, H(c)
   *
   * @param userId   The user's public identifier
   * @param biometricHash  The k-bit hash w from client-side SRP-LSH projection
   * @param salt     The salt used for seed derivation (must match getSeed)
   */
  enroll(userId: string, biometricHash: Uint8Array, salt?: Uint8Array): EnrollResult {
    // Generate a random identity key
    const randomKey = generateRandomKey(Math.ceil(BCH_K / 8));

    // Encode into BCH codeword (the canonical codeword c)
    const messageBits = bytesToBits(randomKey, BCH_K);
    const codeword = bchEncode(messageBits);

    // Compute blinding factor: delta = w XOR c (as bit arrays)
    const delta = createCommitment(biometricHash, codeword);

    // Compute verification anchor: H(message_bits)
    const anchor = hashAnchor(bitsToBytes(messageBits));

    // Generate salt if not provided
    const userSalt = salt ?? generateSalt();

    // Store in SQLite
    this.store.enroll(userId, bitsToBytes(delta), userSalt, anchor);

    // Derive the seed for the client
    const seed = deriveUserSeed(this.masterSecret, userId, userSalt, 1);

    // Braille signature (Spec Section 4)
    const brailleSignature = toBraille(bitsToBytes(messageBits));

    return { success: true, userId, seed, brailleSignature };
  }

  /**
   * Authentication: verify a returning user's behavioral biometric.
   *
   * Spec Section 3.4:
   *   1. Retrieve delta from store
   *   2. Compute c' = w' XOR delta
   *   3. BCH decode c' -> c_hat
   *   4. Verify H(c_hat) = H(c)
   *
   * If the user's behavior has drifted slightly (Spec Section 8.3.1),
   * we do a silent re-enrollment with the widened tolerance.
   *
   * @param userId  The user's public identifier
   * @param biometricHash  The fresh hash w' from client-side SRP-LSH
   */
  authenticate(userId: string, biometricHash: Uint8Array): AuthResult {
    const record = this.store.lookup(userId);
    if (!record) {
      return { success: false, userId, reason: 'User not enrolled' };
    }

    // Open the commitment: c' = w' XOR delta, then BCH decode
    const result = openCommitment(biometricHash, new Uint8Array(record.delta));

    if (!result.success) {
      return {
        success: false,
        userId,
        reason: `Behavioral drift exceeds correction threshold (t=${BCH_T})`,
      };
    }

    // Verify the anchor: H(c_hat) must equal stored H(c)
    const recoveredAnchor = hashAnchor(bitsToBytes(result.corrected));
    const storedAnchor = new Uint8Array(record.anchor);

    if (!constantTimeEqual(recoveredAnchor, storedAnchor)) {
      return {
        success: false,
        userId,
        reason: 'Anchor verification failed — decoded codeword does not match enrollment',
      };
    }

    // Success — identity confirmed
    const brailleSignature = toBraille(bitsToBytes(result.corrected));

    // Silent re-enrollment if errors were corrected (Spec Section 8.3.1)
    let reEnrolled = false;
    if (result.errorCount > 0) {
      // Update delta to reflect the user's current behavioral baseline
      // delta_new = w' XOR c (using the now-verified codeword)
      const codeword = bchEncode(result.corrected);
      const newDelta = createCommitment(biometricHash, codeword);
      this.store.updateDelta(userId, bitsToBytes(newDelta));
      reEnrolled = true;
    }

    return {
      success: true,
      userId,
      errorCount: result.errorCount,
      brailleSignature,
      reEnrolled,
    };
  }

  /** Check if a user is enrolled. */
  isEnrolled(userId: string): boolean {
    return this.store.isEnrolled(userId);
  }

  /** Revoke a user's enrollment (Spec Section 6.4.2: increment version). */
  revoke(userId: string): void {
    this.store.revoke(userId);
  }

  /** Increment template version (derives new hyperplanes, old template invalid). */
  rotateTemplate(userId: string): SeedRequest | null {
    const newVersion = this.store.incrementVersion(userId);
    if (newVersion === 0) return null;

    const record = this.store.lookup(userId);
    if (!record) return null;

    const seed = deriveUserSeed(
      this.masterSecret, userId, new Uint8Array(record.salt), newVersion,
    );
    return { userId, seed, isEnrollment: true };
  }

  /** Close the store. */
  close(): void {
    this.store.close();
  }
}

/** Constant-time comparison to prevent timing attacks. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
