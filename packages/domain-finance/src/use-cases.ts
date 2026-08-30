import type { EventBus } from './events.ts';
import type {
  Account,
  Budget,
  CurrencyCode,
  Repositories,
  Transaction,
} from './entities.ts';

/**
 * Use cases.
 *
 * One thing each. Each validates its own preconditions, does the one write, and
 * emits an event — it does not reach into another aggregate to keep something
 * else up to date. Anything that needs to react, subscribes.
 *
 * Every one of these returns a `Result` rather than throwing. A use case
 * refusing is ordinary product behaviour ("that account doesn't exist", "those
 * currencies don't match"), and the caller has to turn it into a clarifying
 * question, not a stack trace.
 */

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(reason: string): Result<T> => ({ ok: false, reason });

export interface UseCaseDeps {
  readonly repositories: Repositories;
  readonly events: EventBus;
  /** Injected so a use case is deterministic under test. Never `new Date()` inline. */
  readonly now: () => Date;
  readonly newId: (prefix: string) => string;
}

// ------------------------------------------------------------ transactions --

export interface CreateTransactionInput {
  readonly accountId: string;
  /** Unsigned magnitude. The direction comes from the category (ADR-010 §2). */
  readonly amountMinor: number;
  readonly categoryId: string | null;
  readonly occurredAt?: string;
  readonly memo?: string | null;
  readonly merchant?: string | null;
}

/**
 * Record a transaction.
 *
 * The sign is applied **here**, from the category's kind, which is the piece
 * ADR-010 said belonged to the domain rather than to the parser. "twenty euros"
 * is the quantity 20; whether it leaves or arrives is a property of what it was
 * spent on.
 */
export function createTransaction(
  deps: UseCaseDeps,
  input: CreateTransactionInput,
): Result<Transaction> {
  const { repositories: repos, events } = deps;

  const account = repos.accounts.get(input.accountId);
  if (!account) return fail(`no account "${input.accountId}"`);

  if (!Number.isInteger(input.amountMinor)) {
    return fail(`amount must be integer minor units, got ${input.amountMinor}`);
  }
  if (input.amountMinor === 0) return fail('a transaction of zero is not a transaction');

  let direction: 'outflow' | 'inflow' = 'outflow';
  if (input.categoryId !== null) {
    const category = repos.categories.get(input.categoryId);
    if (!category) return fail(`no category "${input.categoryId}"`);
    direction = category.kind === 'income' ? 'inflow' : 'outflow';
  }

  const magnitude = Math.abs(input.amountMinor);
  const transaction: Transaction = {
    id: deps.newId('tx'),
    accountId: account.id,
    categoryId: input.categoryId,
    amountMinor: direction === 'outflow' ? -magnitude : magnitude,
    currency: account.currency,
    occurredAt: input.occurredAt ?? deps.now().toISOString(),
    memo: input.memo ?? null,
    merchant: input.merchant ?? null,
    createdAt: deps.now().toISOString(),
  };

  try {
    repos.transactions.insert(transaction);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  events.emit({ type: 'transaction.created', transaction });
  return ok(transaction);
}

export function updateTransaction(
  deps: UseCaseDeps,
  id: string,
  patch: Partial<Pick<Transaction, 'amountMinor' | 'categoryId' | 'memo' | 'occurredAt'>>,
): Result<Transaction> {
  const before = deps.repositories.transactions.get(id);
  if (!before) return fail(`no transaction "${id}"`);

  const after = deps.repositories.transactions.update(id, patch);
  if (!after) return fail(`could not update "${id}"`);

  deps.events.emit({ type: 'transaction.updated', before, after });
  return ok(after);
}

export function deleteTransaction(deps: UseCaseDeps, id: string): Result<Transaction> {
  const transaction = deps.repositories.transactions.delete(id);
  if (!transaction) return fail(`no transaction "${id}"`);
  deps.events.emit({ type: 'transaction.deleted', transaction });
  return ok(transaction);
}

// ----------------------------------------------------------------- budgets --

export interface SetBudgetInput {
  readonly categoryId: string;
  readonly limitMinor: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: CurrencyCode;
}

/**
 * Set a budget for a category and period.
 *
 * "Set" rather than "create": saying it twice for the same category and period
 * replaces rather than duplicating, because that is what the user means and two
 * budgets for one month is a state nothing downstream can interpret.
 */
export function setBudget(deps: UseCaseDeps, input: SetBudgetInput): Result<Budget> {
  const category = deps.repositories.categories.get(input.categoryId);
  if (!category) return fail(`no category "${input.categoryId}"`);
  if (category.kind === 'income') return fail('a budget caps spending, and income is not spending');
  if (!Number.isInteger(input.limitMinor)) return fail('limit must be integer minor units');
  if (input.limitMinor <= 0) return fail('a budget limit must be a positive magnitude');
  if (input.periodEnd < input.periodStart) return fail('the period ends before it starts');

  const existing = deps.repositories.budgets.get(budgetIdFor(input));
  if (existing) deps.repositories.budgets.delete(existing.id);

  const budget: Budget = {
    id: budgetIdFor(input),
    categoryId: input.categoryId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    limitMinor: input.limitMinor,
    currency: input.currency,
  };

  try {
    deps.repositories.budgets.insert(budget);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  deps.events.emit({ type: 'budget.set', budget, replaced: existing });
  return ok(budget);
}

export function deleteBudget(deps: UseCaseDeps, id: string): Result<Budget> {
  const budget = deps.repositories.budgets.delete(id);
  if (!budget) return fail(`no budget "${id}"`);
  deps.events.emit({ type: 'budget.deleted', budget });
  return ok(budget);
}

/** Deterministic, so "set the food budget for August" twice is idempotent. */
function budgetIdFor(input: { categoryId: string; periodStart: string }): string {
  return `bud_${input.categoryId}_${input.periodStart}`;
}

// ---------------------------------------------------------------- accounts --

export interface CreateAccountInput {
  readonly name: string;
  readonly type: Account['type'];
  readonly currency: CurrencyCode;
  readonly openingMinor?: number;
}

export function createAccount(deps: UseCaseDeps, input: CreateAccountInput): Result<Account> {
  if (!input.name.trim()) return fail('an account needs a name');
  const opening = input.openingMinor ?? 0;
  if (!Number.isInteger(opening)) return fail('opening balance must be integer minor units');

  const account: Account = {
    id: deps.newId('acc'),
    name: input.name.trim(),
    type: input.type,
    currency: input.currency,
    openingMinor: opening,
    createdAt: deps.now().toISOString(),
  };

  try {
    deps.repositories.accounts.insert(account);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  return ok(account);
}

// ------------------------------------------------------------- projections --

/**
 * Watch for a budget being exceeded.
 *
 * A *subscriber*, not something `createTransaction` calls. This is the shape the
 * "reach sideways" rule is protecting: the moment recording a transaction also
 * recomputes budgets, the two aggregates are welded together and domain #2
 * inherits the weld.
 */
export function watchBudgets(
  events: EventBus,
  spentInCategory: (categoryId: string, from: string, to: string, currency: CurrencyCode) => number,
  budgetsFor: (categoryId: string) => readonly Budget[],
): () => void {
  return events.subscribe((event) => {
    if (event.type !== 'transaction.created') return;
    const { categoryId, currency } = event.transaction;
    if (categoryId === null) return;

    for (const budget of budgetsFor(categoryId)) {
      if (budget.currency !== currency) continue;
      const spentMinor = spentInCategory(budget.categoryId, budget.periodStart, budget.periodEnd, currency);
      if (spentMinor > budget.limitMinor) {
        events.emit({
          type: 'budget.exceeded',
          budgetId: budget.id,
          spentMinor,
          limitMinor: budget.limitMinor,
        });
      }
    }
  });
}
