// @nextgen/domain-finance
//
// Domain #1, not the product. The engine underneath is the product, and the test
// of it is how little of this any core-* package had to know about — `Rule 1` is
// asserted mechanically in domain.test.ts.

export { capabilities, boundary, enums, registry } from './capabilities.ts';

export type {
  Account, AccountType, AccountRepository,
  Budget, BudgetRepository,
  Category, CategoryKind, CategoryRepository,
  CurrencyCode,
  Repositories,
  Transaction, TransactionRepository,
} from './entities.ts';

export { EventBus, type DomainEvent, type EventHandler } from './events.ts';

export {
  createAccount, createTransaction, deleteBudget, deleteTransaction,
  setBudget, updateTransaction, watchBudgets,
  type CreateAccountInput, type CreateTransactionInput, type Result,
  type SetBudgetInput, type UseCaseDeps,
} from './use-cases.ts';
