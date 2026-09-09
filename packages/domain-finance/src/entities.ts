/**
 * Finance entities.
 *
 * Domain #1, not the product. What matters about this file is how little of the
 * engine had to know it exists: no `core-*` package imports anything from here,
 * and the boundary test asserts it.
 *
 * Money follows [ADR-010](../../../.claude/decisions/ADR-010.md): signed integer minor
 * units, currency bound to the amount, negative leaves the account.
 */

export type CurrencyCode = 'EUR' | 'USD' | 'GBP';

export type AccountType = 'current' | 'savings' | 'credit_card' | 'cash';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly openingMinor: number;
  readonly createdAt: string;
}

export type CategoryKind = 'expense' | 'income';

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly icon: string | null;
  readonly kind: CategoryKind;
}

export interface Transaction {
  readonly id: string;
  readonly accountId: string;
  readonly categoryId: string | null;
  /** SIGNED. Negative leaves the account (ADR-010). */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /** UTC ISO-8601. */
  readonly occurredAt: string;
  /** UNTRUSTED — attacker-controllable. Fence before this reaches a prompt. */
  readonly memo: string | null;
  /** UNTRUSTED. */
  readonly merchant: string | null;
  readonly createdAt: string;
}

export interface Budget {
  readonly id: string;
  readonly categoryId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** A positive magnitude: a cap, not a movement. */
  readonly limitMinor: number;
  readonly currency: CurrencyCode;
}

// ------------------------------------------------------------------- ports --

/**
 * The repository ports.
 *
 * Declared here, by the domain, and implemented in `@nextgen/data`. The
 * dependency edge runs **neither way**: TypeScript is structurally typed, so the
 * SQLite classes satisfy these without importing them and without this package
 * importing the SQLite classes. `ports.test.ts` asserts the fit at compile time.
 *
 * That is worth more than the usual arrangement. A port that the adapter has to
 * import is a port the adapter can quietly widen; this one cannot drift without
 * the assertion failing.
 */
export interface TransactionRepository {
  insert(t: Transaction): void;
  get(id: string): Transaction | null;
  delete(id: string): Transaction | null;
  update(
    id: string,
    patch: Partial<Pick<Transaction, 'amountMinor' | 'categoryId' | 'memo' | 'occurredAt'>>,
  ): Transaction | null;
}

export interface AccountRepository {
  insert(a: Account): void;
  get(id: string): Account | null;
  list(): readonly Account[];
}

export interface CategoryRepository {
  insert(c: Category): void;
  get(id: string): Category | null;
  list(): readonly Category[];
}

export interface BudgetRepository {
  insert(b: Budget): void;
  get(id: string): Budget | null;
  delete(id: string): Budget | null;
}

export interface Repositories {
  readonly accounts: AccountRepository;
  readonly categories: CategoryRepository;
  readonly transactions: TransactionRepository;
  readonly budgets: BudgetRepository;
}
