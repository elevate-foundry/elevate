/**
 * BBID Identity Store — SQLite replacement for Neo4j
 *
 * Stores per-user enrollment data (Spec Section 7.1):
 *   - delta: the public blinding factor (w XOR c)
 *   - salt: user-specific salt s_u for HKDF
 *   - version: template version v_u (for revocability)
 *   - anchor: SHA-256 hash of the canonical codeword H(c)
 *
 * What is NOT stored (by design):
 *   - Raw biometric vector X or B
 *   - Biometric bitstring w
 *   - Projection hyperplanes R_u
 *   - The seed or master secret
 *   - The canonical codeword c itself
 *
 * The spec called for Neo4j, but the actual data model is a flat
 * key-value lookup by user ID. SQLite is zero-config, local-first,
 * and handles this pattern perfectly.
 */

import Database from 'better-sqlite3';
import { resolve } from 'node:path';

export interface EnrollmentRecord {
  userId: string;
  delta: Buffer;       // Blinding factor (n bits, stored as bytes)
  salt: Buffer;        // User-specific salt s_u
  version: number;     // Template version v_u
  anchor: Buffer;      // H(c) — SHA-256 of canonical codeword
  enrolledAt: string;  // ISO timestamp
  updatedAt: string;   // ISO timestamp
}

export class BBIDStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? resolve(process.cwd(), 'bbid.sqlite');
    this.db = new Database(path);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enrollments (
        user_id     TEXT PRIMARY KEY,
        delta       BLOB NOT NULL,
        salt        BLOB NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        anchor      BLOB NOT NULL,
        enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
    `);
  }

  /** Store enrollment data for a new user. */
  enroll(userId: string, delta: Uint8Array, salt: Uint8Array, anchor: Uint8Array): void {
    const stmt = this.db.prepare(`
      INSERT INTO enrollments (user_id, delta, salt, version, anchor)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        delta = excluded.delta,
        salt = excluded.salt,
        version = version + 1,
        anchor = excluded.anchor,
        updated_at = datetime('now')
    `);
    stmt.run(userId, Buffer.from(delta), Buffer.from(salt), Buffer.from(anchor));
  }

  /** Look up enrollment data for authentication. */
  lookup(userId: string): EnrollmentRecord | null {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, delta, salt, version, anchor,
             enrolled_at as enrolledAt, updated_at as updatedAt
      FROM enrollments WHERE user_id = ?
    `);
    const row = stmt.get(userId) as EnrollmentRecord | undefined;
    return row ?? null;
  }

  /** Update the blinding factor (for re-enrollment after tolerance widening). */
  updateDelta(userId: string, delta: Uint8Array): void {
    const stmt = this.db.prepare(`
      UPDATE enrollments SET delta = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `);
    stmt.run(Buffer.from(delta), userId);
  }

  /** Increment version (revokes old template, Spec Section 6.4.2). */
  incrementVersion(userId: string): number {
    const stmt = this.db.prepare(`
      UPDATE enrollments SET version = version + 1, updated_at = datetime('now')
      WHERE user_id = ?
      RETURNING version
    `);
    const row = stmt.get(userId) as { version: number } | undefined;
    return row?.version ?? 0;
  }

  /** Delete a user's enrollment data. */
  revoke(userId: string): void {
    const stmt = this.db.prepare('DELETE FROM enrollments WHERE user_id = ?');
    stmt.run(userId);
  }

  /** Check if a user is enrolled. */
  isEnrolled(userId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? LIMIT 1');
    return stmt.get(userId) !== undefined;
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }
}
