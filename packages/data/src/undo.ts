import type { DatabaseSync } from 'node:sqlite';
import { SqliteTransactionRepository, type TransactionRecord } from './repositories.ts';

/**
 * The undo journal (ADR-004).
 *
 * Two properties the ADR is explicit about, and both are structural rather than
 * conventional:
 *
 *  1. The entry is recorded **before** the action. `record()` returning a token
 *     is what permits the action to proceed — the dispatcher refuses a
 *     destructive capability when no journal is wired up, because losing the
 *     ability to undo is a reason not to act.
 *  2. Undo **survives navigation**. It is a row, not screen state.
 */

export interface UndoEntry {
  readonly capabilityId: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly describedAs: string;
  /** Everything needed to put it back. For a delete, the whole row. */
  readonly payload: unknown;
  readonly recordedAt: string;
}

export type UndoOutcome = { ok: true } | { ok: false; reason: string };

export class SqliteUndoJournal {
  private counter = 0;

  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  record(entry: UndoEntry): string {
    const token = `undo_${entry.recordedAt.replace(/[^0-9]/g, '')}_${++this.counter}`;
    this.#db
      .prepare(
        `INSERT INTO undo_journal (token, capabilityId, params, describedAs, payload, recordedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token,
        entry.capabilityId,
        JSON.stringify(entry.params),
        entry.describedAs,
        JSON.stringify(entry.payload),
        entry.recordedAt,
      );
    return token;
  }

  get(token: string): (UndoEntry & { token: string; undoneAt: string | null }) | null {
    const row = this.#db.prepare('SELECT * FROM undo_journal WHERE token = ?').get(token) as
      | Record<string, string | null>
      | undefined;
    if (!row) return null;
    return {
      token,
      capabilityId: row.capabilityId as string,
      params: JSON.parse(row.params as string),
      describedAs: row.describedAs as string,
      payload: JSON.parse(row.payload as string),
      recordedAt: row.recordedAt as string,
      undoneAt: row.undoneAt ?? null,
    };
  }

  /**
   * Reverse a recorded action.
   *
   * Marking the entry undone happens in the same transaction as the restore, so
   * a token can never be spent twice — a double-undo would otherwise reinsert a
   * row and leave a duplicate nobody asked for.
   */
  undo(token: string, at = new Date().toISOString()): UndoOutcome {
    const entry = this.get(token);
    if (!entry) return { ok: false, reason: `unknown undo token "${token}"` };
    if (entry.undoneAt) return { ok: false, reason: `"${token}" was already undone at ${entry.undoneAt}` };

    this.#db.exec('BEGIN');
    try {
      switch (entry.capabilityId) {
        case 'transaction.delete': {
          new SqliteTransactionRepository(this.#db).insert(entry.payload as TransactionRecord);
          break;
        }
        case 'budget.delete': {
          const b = entry.payload as Record<string, string | number>;
          const at = (k: string) => b[k] ?? null;
          this.#db
            .prepare(
              `INSERT INTO budgets (id, categoryId, periodStart, periodEnd, limitMinor, currency)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(at('id'), at('categoryId'), at('periodStart'), at('periodEnd'), at('limitMinor'), at('currency'));
          break;
        }
        default:
          this.#db.exec('ROLLBACK');
          return { ok: false, reason: `no undo is defined for "${entry.capabilityId}"` };
      }
      this.#db.prepare('UPDATE undo_journal SET undoneAt = ? WHERE token = ?').run(at, token);
      this.#db.exec('COMMIT');
      return { ok: true };
    } catch (err) {
      this.#db.exec('ROLLBACK');
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
