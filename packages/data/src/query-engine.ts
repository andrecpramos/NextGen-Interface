import type { DatabaseSync } from 'node:sqlite';
import type { CurrencyCode } from './money.ts';

/**
 * The query engine (Rule 3).
 *
 * **The model never emits SQL.** It selects a capability id and typed slots; this
 * maps that pair onto one of a fixed, named, fully parameterised set of queries.
 * There is no code path from an utterance to a database that builds a string, so
 * injected text in a transaction memo cannot become a query no matter what it
 * says.
 *
 * Adding a query means adding a member to `QUERIES` and a case here. That is
 * deliberately more friction than string-building, and it is the point: the set
 * of things the AI can ask the database is a reviewable list.
 *
 * Every aggregate takes a currency and filters by it. There is no overload that
 * omits it, because a sum across currencies is not a number (ADR-010 §4).
 */

export interface DataRef {
  readonly table: string;
  readonly rowCount: number;
  readonly from?: string;
  readonly to?: string;
}

export interface QueryOutcome<T> {
  readonly rows: readonly T[];
  /** For the trace. "What data did you use?" is answered from this record. */
  readonly dataRead: readonly DataRef[];
}

export interface PeriodParams {
  readonly from: string;
  readonly to: string;
  readonly currency: CurrencyCode;
}

/**
 * Category roll-up.
 *
 * "food" must aggregate "groceries", "restaurants", "coffee" and "takeaway"
 * (design.md). The tree is arbitrary-depth, so this is a recursive CTE rather
 * than a join to a fixed number of levels — a two-level join works on today's
 * taxonomy and silently under-reports the moment anyone nests a category deeper.
 *
 * `UNION` rather than `UNION ALL`: a cycle in the tree (which the schema does not
 * prevent) would otherwise recurse forever. This terminates and returns the
 * reachable set.
 */
const DESCENDANTS_CTE = `
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM categories WHERE id = ?
    UNION
    SELECT c.id FROM categories c JOIN descendants d ON c.parentId = d.id
  )
`;

export const QUERIES = [
  'spending.total',
  'spending.byCategory',
  'spending.trend',
  'transactions.list',
  'transactions.search',
  'account.balance',
  'accounts.list',
  'budget.status',
  'categories.list',
] as const;

export type QueryName = (typeof QUERIES)[number];

export interface CategoryTotal {
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly totalMinor: number;
  readonly transactionCount: number;
}

export interface MonthTotal {
  readonly month: string;
  readonly totalMinor: number;
}

export interface BudgetStatus {
  readonly budgetId: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly limitMinor: number;
  readonly spentMinor: number;
  readonly remainingMinor: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export class SqliteQueryEngine {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /**
   * Total spent in a period.
   *
   * "Spending" is the sum of the *outflows*, so this filters to negative amounts
   * and returns a positive magnitude. Written once, here, because ADR-010's
   * signed-amount choice makes this the one place it is easy to get wrong.
   */
  spendingTotal(p: PeriodParams): QueryOutcome<{ totalMinor: number; transactionCount: number }> {
    const row = this.#db
      .prepare(
        `SELECT COALESCE(-SUM(amountMinor), 0) AS totalMinor, COUNT(*) AS transactionCount
           FROM transactions
          WHERE amountMinor < 0
            AND currency = ?
            AND occurredAt >= ? AND occurredAt <= ?`,
      )
      .get(p.currency, p.from, endOfDay(p.to)) as { totalMinor: number; transactionCount: number };

    return {
      rows: [row],
      dataRead: [{ table: 'transactions', rowCount: row.transactionCount, from: p.from, to: p.to }],
    };
  }

  /** Spending in one category, including every descendant of it. */
  spendingInCategory(
    p: PeriodParams & { categoryId: string },
  ): QueryOutcome<{ totalMinor: number; transactionCount: number }> {
    const row = this.#db
      .prepare(
        `${DESCENDANTS_CTE}
         SELECT COALESCE(-SUM(t.amountMinor), 0) AS totalMinor, COUNT(*) AS transactionCount
           FROM transactions t
          WHERE t.categoryId IN (SELECT id FROM descendants)
            AND t.amountMinor < 0
            AND t.currency = ?
            AND t.occurredAt >= ? AND t.occurredAt <= ?`,
      )
      .get(p.categoryId, p.currency, p.from, endOfDay(p.to)) as {
      totalMinor: number;
      transactionCount: number;
    };

    return {
      rows: [row],
      dataRead: [{ table: 'transactions', rowCount: row.transactionCount, from: p.from, to: p.to }],
    };
  }

  /** Spending broken down by top-level category, with descendants rolled up. */
  spendingByCategory(p: PeriodParams): QueryOutcome<CategoryTotal> {
    const rows = this.#db
      .prepare(
        `WITH RECURSIVE roots(leaf, root) AS (
           SELECT id, id FROM categories WHERE parentId IS NULL
           UNION
           SELECT c.id, r.root FROM categories c JOIN roots r ON c.parentId = r.leaf
         )
         SELECT r.root AS categoryId,
                cat.name AS categoryName,
                -SUM(t.amountMinor) AS totalMinor,
                COUNT(*) AS transactionCount
           FROM transactions t
           JOIN roots r ON t.categoryId = r.leaf
           JOIN categories cat ON cat.id = r.root
          WHERE t.amountMinor < 0
            AND t.currency = ?
            AND t.occurredAt >= ? AND t.occurredAt <= ?
          GROUP BY r.root, cat.name
          ORDER BY totalMinor DESC`,
      )
      .all(p.currency, p.from, endOfDay(p.to)) as unknown as CategoryTotal[];

    const total = rows.reduce((n, r) => n + r.transactionCount, 0);
    return {
      rows,
      dataRead: [{ table: 'transactions', rowCount: total, from: p.from, to: p.to }],
    };
  }

  /** Monthly outflow totals, for a trend. */
  spendingTrend(p: PeriodParams): QueryOutcome<MonthTotal> {
    const rows = this.#db
      .prepare(
        `SELECT substr(occurredAt, 1, 7) AS month,
                -SUM(amountMinor) AS totalMinor
           FROM transactions
          WHERE amountMinor < 0
            AND currency = ?
            AND occurredAt >= ? AND occurredAt <= ?
          GROUP BY month
          ORDER BY month`,
      )
      .all(p.currency, p.from, endOfDay(p.to)) as unknown as MonthTotal[];

    return { rows, dataRead: [{ table: 'transactions', rowCount: rows.length, from: p.from, to: p.to }] };
  }

  listTransactions(p: {
    from?: string;
    to?: string;
    categoryId?: string;
    accountId?: string;
    limit?: number;
  }): QueryOutcome<Record<string, unknown>> {
    // The predicate set is fixed and each branch binds a parameter. Note what is
    // NOT here: no column names, table names, operators or ordering come from
    // the caller. Slots choose *which* fixed predicate runs, never its text.
    const where: string[] = [];
    const args: (string | number)[] = [];

    if (p.categoryId) {
      where.push('t.categoryId IN (SELECT id FROM descendants)');
      args.push(p.categoryId);
    }
    if (p.from) {
      where.push('t.occurredAt >= ?');
      args.push(p.from);
    }
    if (p.to) {
      where.push('t.occurredAt <= ?');
      args.push(endOfDay(p.to));
    }
    if (p.accountId) {
      where.push('t.accountId = ?');
      args.push(p.accountId);
    }

    const cte = p.categoryId ? DESCENDANTS_CTE : '';
    // The category argument binds inside the CTE, so it has to come first.
    const bound = p.categoryId ? [args[0]!, ...args.slice(1)] : args;
    const limit = Math.min(Math.max(p.limit ?? 100, 1), 500);

    const rows = this.#db
      .prepare(
        `${cte}
         SELECT t.*, c.name AS categoryName, a.name AS accountName
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.categoryId
           LEFT JOIN accounts a ON a.id = t.accountId
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY t.occurredAt DESC
          LIMIT ${limit}`,
      )
      .all(...bound) as unknown as Record<string, unknown>[];

    return {
      rows,
      dataRead: [
        {
          table: 'transactions',
          rowCount: rows.length,
          ...(p.from ? { from: p.from } : {}),
          ...(p.to ? { to: p.to } : {}),
        },
      ],
    };
  }

  /**
   * Free-text search over memo and merchant.
   *
   * The needle is bound, never interpolated, and the LIKE wildcards are added
   * here rather than taken from the caller. Both columns are marked UNTRUSTED in
   * the spec: this reads them, and anything that later puts them in a prompt has
   * to fence them (security.md).
   */
  searchTransactions(p: { query: string; limit?: number }): QueryOutcome<Record<string, unknown>> {
    const limit = Math.min(Math.max(p.limit ?? 50, 1), 500);
    const needle = `%${p.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = this.#db
      .prepare(
        `SELECT t.*, c.name AS categoryName
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.categoryId
          WHERE (t.memo LIKE ? ESCAPE '\\' OR t.merchant LIKE ? ESCAPE '\\')
          ORDER BY t.occurredAt DESC
          LIMIT ${limit}`,
      )
      .all(needle, needle) as unknown as Record<string, unknown>[];

    return { rows, dataRead: [{ table: 'transactions', rowCount: rows.length }] };
  }

  /** Balance = opening + every movement. Signed amounts make this a plain SUM. */
  accountBalance(p: { accountId: string }): QueryOutcome<{ balanceMinor: number; currency: string }> {
    const row = this.#db
      .prepare(
        `SELECT a.currency AS currency,
                a.openingMinor + COALESCE((
                  SELECT SUM(t.amountMinor) FROM transactions t WHERE t.accountId = a.id
                ), 0) AS balanceMinor
           FROM accounts a
          WHERE a.id = ?`,
      )
      .get(p.accountId) as { balanceMinor: number; currency: string } | undefined;

    return {
      rows: row ? [row] : [],
      dataRead: [{ table: 'transactions', rowCount: row ? 1 : 0 }],
    };
  }

  listAccounts(): QueryOutcome<Record<string, unknown>> {
    const rows = this.#db
      .prepare(
        `SELECT a.*,
                a.openingMinor + COALESCE((
                  SELECT SUM(t.amountMinor) FROM transactions t WHERE t.accountId = a.id
                ), 0) AS balanceMinor
           FROM accounts a ORDER BY a.name`,
      )
      .all() as unknown as Record<string, unknown>[];
    return { rows, dataRead: [{ table: 'accounts', rowCount: rows.length }] };
  }

  listCategories(): QueryOutcome<Record<string, unknown>> {
    const rows = this.#db
      .prepare('SELECT * FROM categories ORDER BY COALESCE(parentId, id), name')
      .all() as unknown as Record<string, unknown>[];
    return { rows, dataRead: [{ table: 'categories', rowCount: rows.length }] };
  }

  /** Budget vs actual, with category descendants rolled up into "spent". */
  budgetStatus(p: { currency: CurrencyCode; on?: string }): QueryOutcome<BudgetStatus> {
    const on = p.on ?? new Date().toISOString().slice(0, 10);
    const rows = this.#db
      .prepare(
        `WITH RECURSIVE roots(leaf, root) AS (
           SELECT id, id FROM categories
           UNION
           SELECT c.id, r.root FROM categories c JOIN roots r ON c.parentId = r.leaf
         )
         SELECT b.id AS budgetId,
                b.categoryId AS categoryId,
                cat.name AS categoryName,
                b.limitMinor AS limitMinor,
                COALESCE((
                  SELECT -SUM(t.amountMinor) FROM transactions t
                   WHERE t.categoryId IN (SELECT leaf FROM roots WHERE root = b.categoryId)
                     AND t.amountMinor < 0
                     AND t.currency = b.currency
                     AND t.occurredAt >= b.periodStart AND t.occurredAt <= ?
                ), 0) AS spentMinor,
                b.periodStart AS periodStart,
                b.periodEnd AS periodEnd
           FROM budgets b
           JOIN categories cat ON cat.id = b.categoryId
          WHERE b.currency = ? AND b.periodStart <= ? AND b.periodEnd >= ?
          ORDER BY cat.name`,
      )
      .all(endOfDay(on), p.currency, on, on) as unknown as Omit<BudgetStatus, 'remainingMinor'>[];

    const withRemaining = rows.map((r) => ({ ...r, remainingMinor: r.limitMinor - r.spentMinor }));
    return { rows: withRemaining, dataRead: [{ table: 'budgets', rowCount: rows.length }] };
  }
}

/**
 * Timestamps are stored as ISO-8601 UTC strings, so a date-only bound like
 * "2026-07-31" would exclude everything that happened that day. Extending to the
 * end of the day is the kind of off-by-one that produces a monthly total quietly
 * missing its last day.
 */
function endOfDay(date: string): string {
  return date.length === 10 ? `${date}T23:59:59.999Z` : date;
}
