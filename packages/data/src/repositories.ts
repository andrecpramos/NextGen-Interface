import type { DatabaseSync } from 'node:sqlite';
import {
  assertMinorUnits,
  CurrencyMismatchError,
  isCurrencyCode,
  type CurrencyCode,
} from './money.ts';

/**
 * Repositories.
 *
 * The interfaces are declared by the domain; these are the SQLite
 * implementations. Every invariant that ADR-010 states is enforced *here*,
 * at the boundary, rather than trusted to callers — a repository is the last
 * place a bad amount can be stopped before it becomes history.
 */

export interface AccountRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly currency: CurrencyCode;
  readonly openingMinor: number;
  readonly createdAt: string;
}

export interface CategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly icon: string | null;
  readonly kind: 'expense' | 'income';
}

export interface TransactionRecord {
  readonly id: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  /** SIGNED minor units. Negative leaves the account (ADR-010). */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly occurredAt: string;
  readonly memo: string | null;
  readonly merchant: string | null;
  readonly createdAt: string;
}

export interface BudgetRecord {
  readonly id: string;
  readonly categoryId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly limitMinor: number;
  readonly currency: CurrencyCode;
}

export interface TransactionRepository {
  insert(t: TransactionRecord): void;
  get(id: string): TransactionRecord | null;
  delete(id: string): TransactionRecord | null;
  update(id: string, patch: Partial<Pick<TransactionRecord, 'amountMinor' | 'categoryId' | 'memo' | 'occurredAt'>>): TransactionRecord | null;
}

export interface AccountRepository {
  insert(a: AccountRecord): void;
  get(id: string): AccountRecord | null;
  list(): readonly AccountRecord[];
}

export interface CategoryRepository {
  insert(c: CategoryRecord): void;
  get(id: string): CategoryRecord | null;
  list(): readonly CategoryRecord[];
}

export interface BudgetRepository {
  insert(b: BudgetRecord): void;
  get(id: string): BudgetRecord | null;
  delete(id: string): BudgetRecord | null;
}

// ---------------------------------------------------------------- accounts --

export class SqliteAccountRepository implements AccountRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  insert(a: AccountRecord): void {
    assertMinorUnits(a.openingMinor, `account ${a.id} openingMinor`);
    if (!isCurrencyCode(a.currency)) {
      throw new TypeError(`account ${a.id} has unsupported currency "${a.currency}"`);
    }
    this.#db
      .prepare(
        `INSERT INTO accounts (id, name, type, currency, openingMinor, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.name, a.type, a.currency, a.openingMinor, a.createdAt);
  }

  get(id: string): AccountRecord | null {
    return (this.#db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as AccountRecord) ?? null;
  }

  list(): readonly AccountRecord[] {
    return this.#db.prepare('SELECT * FROM accounts ORDER BY name').all() as unknown as AccountRecord[];
  }
}

// -------------------------------------------------------------- categories --

export class SqliteCategoryRepository implements CategoryRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  insert(c: CategoryRecord): void {
    if (c.parentId === c.id) {
      // A self-parent makes the roll-up CTE return only itself, which reads as
      // "this category has no children" rather than as an error.
      throw new TypeError(`category ${c.id} cannot be its own parent`);
    }
    this.#db
      .prepare('INSERT INTO categories (id, name, parentId, icon, kind) VALUES (?, ?, ?, ?, ?)')
      .run(c.id, c.name, c.parentId, c.icon, c.kind);
  }

  get(id: string): CategoryRecord | null {
    return (this.#db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as unknown as CategoryRecord) ?? null;
  }

  list(): readonly CategoryRecord[] {
    return this.#db.prepare('SELECT * FROM categories ORDER BY name').all() as unknown as CategoryRecord[];
  }
}

// ------------------------------------------------------------ transactions --

export class SqliteTransactionRepository implements TransactionRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /**
   * Insert, enforcing every money invariant ADR-010 states.
   *
   * The currency check is the important one. There is no conversion in this
   * system, so a transaction whose currency disagrees with its account is not a
   * thing to coerce — it is a question for the user.
   */
  insert(t: TransactionRecord): void {
    assertMinorUnits(t.amountMinor, `transaction ${t.id} amountMinor`);

    const account = this.#db.prepare('SELECT currency FROM accounts WHERE id = ?').get(t.accountId) as
      | { currency: string }
      | undefined;
    if (!account) throw new TypeError(`transaction ${t.id} references unknown account "${t.accountId}"`);
    if (account.currency !== t.currency) {
      throw new CurrencyMismatchError(
        account.currency as CurrencyCode,
        t.currency,
        `transaction ${t.id} on account ${t.accountId}`,
      );
    }
    if (!t.occurredAt.endsWith('Z')) {
      // Rule: all timestamps UTC. A local timestamp sorts and groups wrongly and
      // nothing downstream can tell.
      throw new TypeError(`transaction ${t.id} occurredAt "${t.occurredAt}" must be UTC (ending in Z)`);
    }

    this.#db
      .prepare(
        `INSERT INTO transactions
           (id, accountId, categoryId, amountMinor, currency, occurredAt, memo, merchant, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id, t.accountId, t.categoryId, t.amountMinor, t.currency,
        t.occurredAt, t.memo, t.merchant, t.createdAt,
      );
  }

  get(id: string): TransactionRecord | null {
    return (this.#db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as unknown as TransactionRecord) ?? null;
  }

  /** Returns the deleted row so the undo journal can put it back. */
  delete(id: string): TransactionRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.#db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    return existing;
  }

  update(
    id: string,
    patch: Partial<Pick<TransactionRecord, 'amountMinor' | 'categoryId' | 'memo' | 'occurredAt'>>,
  ): TransactionRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    if (patch.amountMinor !== undefined) {
      assertMinorUnits(patch.amountMinor, `transaction ${id} amountMinor`);
    }
    const next = { ...existing, ...patch };
    this.#db
      .prepare(
        'UPDATE transactions SET amountMinor = ?, categoryId = ?, memo = ?, occurredAt = ? WHERE id = ?',
      )
      .run(next.amountMinor, next.categoryId, next.memo, next.occurredAt, id);
    return next;
  }
}

// ----------------------------------------------------------------- budgets --

export class SqliteBudgetRepository implements BudgetRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  insert(b: BudgetRecord): void {
    assertMinorUnits(b.limitMinor, `budget ${b.id} limitMinor`);
    if (b.limitMinor < 0) {
      // A budget is a cap, not a movement, so it carries no sign (ADR-010).
      throw new TypeError(`budget ${b.id} limitMinor must be a positive magnitude, got ${b.limitMinor}`);
    }
    if (b.periodEnd < b.periodStart) {
      throw new TypeError(`budget ${b.id} ends (${b.periodEnd}) before it starts (${b.periodStart})`);
    }
    this.#db
      .prepare(
        `INSERT INTO budgets (id, categoryId, periodStart, periodEnd, limitMinor, currency)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(b.id, b.categoryId, b.periodStart, b.periodEnd, b.limitMinor, b.currency);
  }

  get(id: string): BudgetRecord | null {
    return (this.#db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as unknown as BudgetRecord) ?? null;
  }

  delete(id: string): BudgetRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.#db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
    return existing;
  }
}
