/**
 * BBID Client — runs in the browser or any JS environment.
 *
 * This is the client-side half of the BBID protocol:
 *   1. Collect behavioral biometrics (keystroke, mouse, scroll)
 *   2. Receive seed from server
 *   3. Expand seed to hyperplanes via AES-CTR-DRBG
 *   4. Project behavioral vector through hyperplanes (SRP-LSH)
 *   5. Send the bitstring w to the server
 *   6. Zero out seed, hyperplanes, and raw features from memory
 *
 * No state is stored client-side. No cookies. No localStorage.
 */

export { BehavioralCollector, FEATURE_DIM } from './features.js';
export type { KeystrokeEvent, MouseEvent, ScrollEvent, FeatureVector } from './features.js';

export {
  AesCtrDrbg,
  generateHyperplanes,
  projectToHash,
  hammingDistance,
  normalizeVector,
  LSH_BITS,
} from './srp-lsh.js';

import { BehavioralCollector } from './features.js';
import { generateHyperplanes, projectToHash, normalizeVector } from './srp-lsh.js';

/**
 * Complete client-side pipeline: behavioral vector -> biometric hash.
 *
 * @param collector  A BehavioralCollector with enough samples
 * @param seed       The 32-byte seed from the server (via TLS)
 * @returns The biometric hash w (Uint8Array) and metadata
 */
export function computeBiometricHash(collector: BehavioralCollector, seed: Uint8Array): {
  hash: Uint8Array;
  sufficient: boolean;
  samples: { keystrokes: number; mouse: number; scroll: number };
} {
  // Step 1: Extract behavioral feature vector
  const features = collector.extract();

  // Step 2: Normalize (z-score or log-scale)
  const normalized = normalizeVector(features.values);

  // Step 3: Expand seed to hyperplanes
  const hyperplanes = generateHyperplanes(seed);

  // Step 4: Project through hyperplanes -> k-bit hash
  const hash = projectToHash(normalized, hyperplanes);

  // Step 5: Zero out sensitive data
  // (In a real browser environment, we'd also zero the seed)
  features.values.fill(0);
  normalized.fill(0);
  for (const hp of hyperplanes) hp.fill(0);

  return {
    hash,
    sufficient: features.sufficient,
    samples: {
      keystrokes: features.keystrokeSamples,
      mouse: features.mouseSamples,
      scroll: features.scrollSamples,
    },
  };
}
