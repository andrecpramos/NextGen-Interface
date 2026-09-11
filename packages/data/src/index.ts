// @nextgen/data
//
// Persistence for the finance domain: schema, migrations, repositories, the
// fixed query set, the undo journal, and seeded fixtures.
//
// The device is the source of truth (ADR-008), so SQLite is the shipping
// dialect and Postgres exists to hold the same shape, not to be on the critical
// path. Money is signed integer minor units and never converts (ADR-010).

export {
  assertMinorUnits, addMoney, formatMoney, fromMajorUnits, isCurrencyCode, money, signed,
  CurrencyMismatchError,
  type CurrencyCode, type Direction, type Money,
} from './money.ts';

export {
  MIGRATIONS, LATEST_VERSION, migrate, migrateFileWithBackup, currentVersion, openMemoryDatabase,
  type Migration, type MigrateResult,
} from './migrate.ts';

export {
  SqliteAccountRepository, SqliteBudgetRepository, SqliteCategoryRepository, SqliteTransactionRepository,
  SqliteModuleCategoryRepository, SqliteModuleRepository, SqliteModuleEntryRepository,
  isAccountType, isModuleEntryKind, isModuleSourceType,
  type AccountRecord, type AccountRepository, type AccountType,
  type BudgetRecord, type BudgetRepository,
  type CategoryRecord, type CategoryRepository,
  type TransactionRecord, type TransactionRepository,
  type ModuleCategoryRecord, type ModuleCategoryRepository,
  type ModuleRecord, type ModuleRepository,
  type ModuleEntryRecord, type ModuleEntryRepository, type ModuleEntryKind, type ModuleSourceType,
} from './repositories.ts';

export {
  SqliteQueryEngine, QUERIES,
  type BudgetStatus, type CategoryTotal, type DataRef, type MonthTotal,
  type PeriodParams, type QueryName, type QueryOutcome,
} from './query-engine.ts';

export {
  SqliteUndoJournal,
  canUndo,
  REVERSIBLE_CAPABILITIES,
  type UndoEntry,
  type UndoOutcome,
} from './undo.ts';

export { seed, CATEGORY_TREE, type SeedOptions, type SeedSummary } from './fixtures.ts';

export { TABLES, moneyColumns, untrustedColumns, type ColumnSpec, type TableSpec } from './schema/spec.ts';
export * as sqliteSchema from './schema/sqlite.ts';
export * as postgresSchema from './schema/postgres.ts';
