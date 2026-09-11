import type { DatabaseSync } from 'node:sqlite';
import {
  SqliteModuleRepository,
  SqliteTransactionRepository,
  type ModuleRecord,
  type TransactionRecord,
} from './repositories.ts';

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

/**
 * The capabilities this journal can actually reverse.
 *
 * **Declared, so that a surface can ask instead of assume.** Until WP-18
 * (2026-09-11) this held only the two `domain-finance` capabilities, while the
 * *registered* reference application is `domain-modules` — so every destructive
 * action the shipping app offered was irreversible, and the CLI's confirmation
 * prompt used to promise otherwise. `module.delete` and `module.revert` now have
 * real restore paths below, and this set says so because the switch does.
 *
 * Keep this in step with the switch in `undo()`. It exists precisely so the
 * claim a user reads is derived from the code that would have to honour it, and
 * a test asserts the two agree in both directions.
 */
export const REVERSIBLE_CAPABILITIES: ReadonlySet<string> = new Set([
  'transaction.delete',
  'budget.delete',
  'module.delete',
  'module.revert',
]);

/** Can this action be taken back once it has run? */
export function canUndo(capabilityId: string): boolean {
  return REVERSIBLE_CAPABILITIES.has(capabilityId);
}

/**
 * A module row captured before the action, or a precise reason it was not.
 *
 * The composition root captures the row with `modules.get(target)`, which is
 * `null` when the target did not exist — the action would have failed too, but
 * the journal entry is written first, so a null payload is a real state and has
 * to produce a readable refusal rather than an insert of `null` columns.
 */
function modulePayload(payload: unknown): ModuleRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const m = payload as Partial<ModuleRecord>;
  return typeof m.id === 'string' && typeof m.body === 'string' ? (payload as ModuleRecord) : null;
}

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
          const col = (k: string) => b[k] ?? null;
          this.#db
            .prepare(
              `INSERT INTO budgets (id, categoryId, periodStart, periodEnd, limitMinor, currency)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(col('id'), col('categoryId'), col('periodStart'), col('periodEnd'), col('limitMinor'), col('currency'));
          break;
        }
        case 'module.delete': {
          // WP-18. The whole row was captured before the delete, so putting it
          // back is an insert of exactly what was there — same id, same
          // timestamps, so anything that referred to it still resolves.
          const m = modulePayload(entry.payload);
          if (!m) {
            this.#db.exec('ROLLBACK');
            return { ok: false, reason: 'nothing was captured to restore — the module did not exist when it was deleted' };
          }
          new SqliteModuleRepository(this.#db).insert(m);
          break;
        }
        case 'module.revert': {
          // WP-18. A revert overwrites the current body with the last merge
          // snapshot, so undoing it means putting back the body that was there
          // *before the revert* — which is what the payload captured. `updatedAt`
          // moves forward rather than back: the content returns, but this is a
          // new change and the timestamp should say so.
          //
          // The `revert` entry stays in the module's log. That log is
          // append-only history of what happened, and the revert did happen.
          const m = modulePayload(entry.payload);
          if (!m) {
            this.#db.exec('ROLLBACK');
            return { ok: false, reason: 'nothing was captured to restore — the module did not exist when it was reverted' };
          }
          const restored = new SqliteModuleRepository(this.#db).update(m.id, {
            body: m.body,
            summary: m.summary,
            updatedAt: at,
          });
          if (!restored) {
            this.#db.exec('ROLLBACK');
            return { ok: false, reason: `module "${m.id}" no longer exists, so its revert cannot be undone` };
          }
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
