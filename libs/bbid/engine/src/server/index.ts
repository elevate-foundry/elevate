/**
 * BBID Server — runs in Node.js.
 *
 * This is the server-side half of the BBID protocol:
 *   1. Derive per-user seeds via HKDF (ED-DUP)
 *   2. Store blinding factors, salts, versions, anchors in SQLite
 *   3. Enroll new users (generate codeword, compute commitment)
 *   4. Authenticate returning users (open commitment, BCH decode, verify anchor)
 *   5. Handle silent re-enrollment on behavioral drift
 *   6. Support template rotation (revocability)
 *
 * No raw biometrics are ever stored. The server holds only the
 * blinding factor (delta), salt, version, and H(c).
 */

export { BBIDEngine } from './engine.js';
export type { EnrollResult, AuthResult, SeedRequest } from './engine.js';

export { BBIDStore } from './store.js';
export type { EnrollmentRecord } from './store.js';

export { hkdf, deriveUserSeed, generateSalt, generateRandomKey, hashAnchor } from './kdf.js';

export {
  bchEncode, bchDecode,
  createCommitment, openCommitment,
  generateCodeword,
  bytesToBits, bitsToBytes, xorBits,
  BCH_N, BCH_K, BCH_T,
} from './bch.js';
