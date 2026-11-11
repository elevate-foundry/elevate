/**
 * @elevate/bbid — Braille Binary Identity for the Elevate ecosystem.
 *
 * BBID is a braille-encoded identity system providing:
 *   - Unique 8-cell braille identity (64 bits of entropy)
 *   - HMAC-SHA256 cryptographic signatures (braille-encoded)
 *   - Haptic patterns for accessibility
 *   - Visit tracking and persistence
 *
 * Unified from Sal's bbid.js and sal-auth/bbid.py.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BRAILLE_BASE = 0x2800;

function brailleFromByte(byte: number): string {
  return String.fromCodePoint(BRAILLE_BASE + (byte & 0xFF));
}

function brailleEncode(data: Uint8Array | Buffer): string {
  return [...data].map(b => brailleFromByte(b)).join('');
}

function brailleDotCount(char: string): number {
  const cp = (char.codePointAt(0) ?? 0) - BRAILLE_BASE;
  let count = 0;
  let n = cp;
  while (n) { count++; n &= n - 1; }
  return count;
}

// Default prefix: braille for "SAL" + underscore
export const BBID_PREFIX = '\u2820\u280e\u2801\u2807_'; // ⠠⠎⠁⠇_

export interface BBIDIdentity {
  bbid: string;       // prefix + braille
  braille: string;    // raw 8-cell braille
  userId: string;
  createdAt: string;
  signature: string;  // HMAC signature as braille
  hapticPattern: HapticStep[];
  modalities: string[];
}

export interface HapticStep {
  duration: number;
  intensity?: number;
  type?: 'vibration' | 'pause';
}

export interface VisitInfo {
  bbid: string;
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  isFirstVisit: boolean;
}

export interface BBIDServiceOptions {
  encryptionKey?: string;
  prefix?: string;
  registryPath?: string;
  now?: () => Date;
}

export class BBIDService {
  private readonly key: Buffer;
  private readonly prefix: string;
  private readonly registryPath: string;
  private readonly now: () => Date;

  constructor(options: BBIDServiceOptions = {}) {
    const keyStr = options.encryptionKey
      ?? process.env.ELEVATE_BBID_HMAC_KEY
      ?? process.env.BBID_ENCRYPTION_KEY
      ?? randomBytes(32).toString('hex');
    this.key = Buffer.from(keyStr, 'utf-8');
    this.prefix = options.prefix ?? BBID_PREFIX;
    this.registryPath = options.registryPath ?? join(process.cwd(), 'data', 'bbid-visits.json');
    this.now = options.now ?? (() => new Date());

    mkdirSync(dirname(this.registryPath), { recursive: true });
  }

  generate(opts: { userId: string; username: string }): BBIDIdentity {
    const seed = `${opts.userId}:${opts.username}:${randomBytes(8).toString('hex')}`;
    const hashBytes = createHash('sha256').update(seed).digest();
    const braille = brailleEncode(hashBytes.subarray(0, 8));
    const signature = this.sign(braille, opts.userId);
    const display = `${this.prefix}${braille}`;

    return {
      bbid: display,
      braille,
      userId: opts.userId,
      createdAt: this.now().toISOString(),
      signature,
      hapticPattern: this.hapticPattern(braille),
      modalities: ['voice', 'text', 'braille', 'haptic'],
    };
  }

  verify(identity: BBIDIdentity): boolean {
    const expected = this.sign(identity.braille, identity.userId);
    try {
      return timingSafeEqual(
        Buffer.from(expected, 'utf-8'),
        Buffer.from(identity.signature, 'utf-8'),
      );
    } catch {
      return false;
    }
  }

  private sign(braille: string, userId: string): string {
    const message = `${braille}:${userId}`;
    const sigHex = createHmac('sha256', this.key).update(message).digest('hex');
    // First 8 bytes of HMAC -> 8 braille characters
    const sigBytes = Buffer.from(sigHex.slice(0, 16), 'hex');
    return brailleEncode(sigBytes);
  }

  hapticPattern(braille: string): HapticStep[] {
    const steps: HapticStep[] = [];
    for (const char of braille) {
      const dots = brailleDotCount(char);
      steps.push({
        type: 'vibration',
        duration: 50 + dots * 20,
        intensity: Math.round((0.3 + dots * 0.1) * 100) / 100,
      });
      steps.push({ type: 'pause', duration: 100 });
    }
    return steps;
  }

  identify(display: string): VisitInfo {
    const registry = this.loadRegistry();
    const now = this.now().toISOString();
    let entry = registry[display];

    if (!entry) {
      entry = {
        bbid: display,
        firstSeenAt: now,
        lastSeenAt: now,
        visitCount: 1,
        isFirstVisit: true,
      };
    } else {
      entry.lastSeenAt = now;
      entry.visitCount += 1;
      entry.isFirstVisit = false;
    }

    registry[display] = entry;
    this.saveRegistry(registry);
    return entry;
  }

  tokenClaims(identity: BBIDIdentity): Record<string, unknown> {
    return {
      bbid: identity.bbid,
      bbidRaw: identity.braille,
      bbidSig: identity.signature,
      bbidCreated: identity.createdAt,
      modalities: identity.modalities,
    };
  }

  private loadRegistry(): Record<string, VisitInfo> {
    if (!existsSync(this.registryPath)) return {};
    try {
      return JSON.parse(readFileSync(this.registryPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private saveRegistry(data: Record<string, VisitInfo>): void {
    writeFileSync(this.registryPath, JSON.stringify(data, null, 2));
  }
}
