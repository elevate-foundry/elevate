/**
 * Key Derivation for ED-DUP (Edge-Derived Deterministic User-Specific Projection)
 *
 * Implements Spec Section 6.4.2: HKDF-SHA256 key derivation.
 *
 * The master secret M_sys is held server-side (env var or TEE).
 * For each user, a unique seed is derived:
 *
 *   seed_u = HKDF-SHA256(M_sys, info = ID_u || s_u || v_u)
 *
 * This seed deterministically generates the user's projection hyperplanes.
 * Because each user gets a unique seed, their projection spaces are
 * cryptographically isolated. Compromising one user's commitment data
 * tells you nothing about another user's biometrics.
 *
 * Revocability: increment v_u to derive an entirely new, uncorrelated
 * projection matrix. The old template becomes useless.
 */

import { createHmac, createHash, randomBytes } from 'node:crypto';

/**
 * HKDF-SHA256: Extract-then-Expand key derivation.
 *
 * RFC 5869, using SHA-256 as the underlying hash.
 *
 * @param ikm  Input keying material (the master secret)
 * @param salt Optional salt (random bytes, or empty for default)
 * @param info Context/application-specific info string
 * @param len  Output length in bytes (default 32)
 */
export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number = 32): Uint8Array {
  // Extract: PRK = HMAC-SHA256(salt, ikm)
  const prk = hmacSha256(salt.length > 0 ? salt : new Uint8Array(32), ikm);

  // Expand: output = T(1) || T(2) || ... truncated to len
  const hashLen = 32; // SHA-256 output
  const n = Math.ceil(len / hashLen);
  const okm = new Uint8Array(n * hashLen);
  let prev = new Uint8Array(0);

  for (let i = 0; i < n; i++) {
    const input = new Uint8Array(prev.length + info.length + 1);
    input.set(prev, 0);
    input.set(info, prev.length);
    input[prev.length + info.length] = i + 1;
    prev = hmacSha256(prk, input);
    okm.set(prev, i * hashLen);
  }

  return okm.slice(0, len);
}

/** HMAC-SHA256 */
function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const hmac = createHmac('sha256', key);
  hmac.update(data);
  return new Uint8Array(hmac.digest());
}

/**
 * Derive a user-specific 32-byte seed for hyperplane generation.
 *
 * Spec Section 6.4.2:
 *   seed_u = HKDF-SHA256(M_sys, info = ID_u || s_u || v_u)
 *
 * @param masterSecret The system master secret M_sys (32+ bytes)
 * @param userId       The user's public identifier
 * @param salt         The user-specific salt s_u (stored in DB)
 * @param version      The template version v_u (for revocability)
 */
export function deriveUserSeed(
  masterSecret: Uint8Array,
  userId: string,
  salt: Uint8Array,
  version: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(userId);
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, version, false);

  // info = ID_u || s_u || v_u
  const info = new Uint8Array(idBytes.length + salt.length + versionBytes.length);
  info.set(idBytes, 0);
  info.set(salt, idBytes.length);
  info.set(versionBytes, idBytes.length + salt.length);

  return hkdf(masterSecret, salt, info, 32);
}

/**
 * Generate a cryptographically random salt for a new user.
 */
export function generateSalt(len: number = 16): Uint8Array {
  return new Uint8Array(randomBytes(len));
}

/**
 * Generate random bytes for a BCH message (identity key).
 */
export function generateRandomKey(len: number = 8): Uint8Array {
  return new Uint8Array(randomBytes(len));
}

/**
 * SHA-256 hash of a codeword message — the verification anchor H(c).
 * Spec Section 3.3 step 5.
 */
export function hashAnchor(message: Uint8Array): Uint8Array {
  const hash = createHash('sha256');
  hash.update(message);
  return new Uint8Array(hash.digest());
}
