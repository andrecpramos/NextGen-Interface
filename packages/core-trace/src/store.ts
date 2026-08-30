import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { assertNoModelProse, type TurnTrace } from './types.ts';

/**
 * Trace storage: encrypted at rest, capped by a ring buffer, exportable.
 *
 * Traces are the most sensitive thing this application holds. They contain the
 * user's own words, and the transcript of someone asking about their money is
 * more revealing than the transactions themselves — the transactions say what
 * happened, the transcripts say what they were worried about.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface TraceCrypto {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

/**
 * AES-256-GCM. GCM rather than CBC because it authenticates: a tampered trace
 * fails to decrypt rather than decoding into something plausible, and the whole
 * value of a trace is that it is a faithful record.
 *
 * Key management is not solved here — it belongs to the platform keystore
 * (WP-09 / WP-10). This takes a key and says so.
 */
export function aesTraceCrypto(key: Buffer): TraceCrypto {
  if (key.length !== 32) throw new TypeError(`trace key must be 32 bytes, got ${key.length}`);
  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
    },
    decrypt(payload: string): string {
      const [ivB64, tagB64, bodyB64] = payload.split('.');
      if (!ivB64 || !tagB64 || !bodyB64) throw new Error('malformed encrypted trace');
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}

/** Plaintext passthrough, for tests and for a dev database nobody ships. */
export const plaintextTraceCrypto: TraceCrypto = {
  encrypt: (s) => s,
  decrypt: (s) => s,
};

export interface TraceStoreOptions {
  readonly crypto?: TraceCrypto;
  /** Ring buffer size. Oldest traces are dropped past this. */
  readonly capacity?: number;
}

export class SqliteTraceStore {
  readonly #db: DatabaseSync;
  readonly #crypto: TraceCrypto;
  readonly #capacity: number;

  constructor(db: DatabaseSync, options: TraceStoreOptions = {}) {
    this.#db = db;
    this.#crypto = options.crypto ?? plaintextTraceCrypto;
    this.#capacity = options.capacity ?? 500;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        turnId    TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        payload   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS traces_created_idx ON traces(createdAt);
    `);
  }

  /**
   * Persist a trace.
   *
   * The prose check runs here rather than only at construction: a trace crosses
   * this boundary as a plain object, and a type cannot follow it across.
   */
  put(trace: TurnTrace): void {
    assertNoModelProse(trace as unknown as Record<string, unknown>);
    this.#db
      .prepare('INSERT OR REPLACE INTO traces (turnId, createdAt, payload) VALUES (?, ?, ?)')
      .run(trace.turnId, trace.createdAt, this.#crypto.encrypt(JSON.stringify(trace)));
    this.#prune();
  }

  get(turnId: string): TurnTrace | null {
    const row = this.#db.prepare('SELECT payload FROM traces WHERE turnId = ?').get(turnId) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(this.#crypto.decrypt(row.payload)) as TurnTrace) : null;
  }

  /** Most recent first — which is the order a user asking "why?" wants. */
  recent(limit = 20): readonly TurnTrace[] {
    const rows = this.#db
      .prepare('SELECT payload FROM traces ORDER BY createdAt DESC, rowid DESC LIMIT ?')
      .all(Math.min(Math.max(limit, 1), this.#capacity)) as unknown as { payload: string }[];
    return rows.map((r) => JSON.parse(this.#crypto.decrypt(r.payload)) as TurnTrace);
  }

  /** The last turn. "Why did you do that?" almost always means this one. */
  latest(): TurnTrace | null {
    return this.recent(1)[0] ?? null;
  }

  count(): number {
    return (this.#db.prepare('SELECT COUNT(*) AS n FROM traces').get() as { n: number }).n;
  }

  /**
   * Export, for the user. Their record, and the offline eval corpus.
   *
   * Decrypted on the way out on purpose: an export the user cannot read is not
   * an export. Where it then goes is their decision.
   */
  export(): readonly TurnTrace[] {
    const rows = this.#db
      .prepare('SELECT payload FROM traces ORDER BY createdAt ASC, rowid ASC')
      .all() as unknown as { payload: string }[];
    return rows.map((r) => JSON.parse(this.#crypto.decrypt(r.payload)) as TurnTrace);
  }

  /** Delete everything. The user's right, and it must actually delete. */
  clear(): void {
    this.#db.exec('DELETE FROM traces');
  }

  #prune(): void {
    // rowid keeps the order stable when several traces share a timestamp, which
    // they do whenever a turn is fast.
    this.#db
      .prepare(
        `DELETE FROM traces WHERE turnId IN (
           SELECT turnId FROM traces ORDER BY createdAt DESC, rowid DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(this.#capacity);
  }
}

export function newTurnId(): string {
  return `turn_${randomUUID()}`;
}
