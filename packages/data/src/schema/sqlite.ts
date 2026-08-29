import { sqliteTable, index, integer, text } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * The SQLite schema — the shipping dialect (ADR-007, ADR-008: the device is the
 * source of truth).
 *
 * Written against the shapes in `spec.ts`, which the parity test checks this
 * against column by column. `money` is `integer` here and `bigint` in Postgres,
 * and in neither is it ever a float.
 */

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  currency: text('currency').notNull(),
  openingMinor: integer('openingMinor').notNull().default(0),
  createdAt: text('createdAt').notNull(),
});

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    // Self-reference needs the explicit return type or TS cannot infer it.
    parentId: text('parentId').references((): AnySQLiteColumn => categories.id),
    icon: text('icon'),
    kind: text('kind').notNull(),
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull().references(() => accounts.id),
    categoryId: text('categoryId').references(() => categories.id),
    /** SIGNED minor units. Negative leaves the account (ADR-010). */
    amountMinor: integer('amountMinor').notNull(),
    currency: text('currency').notNull(),
    occurredAt: text('occurredAt').notNull(),
    /** UNTRUSTED — attacker-controllable. Fence before this reaches a prompt. */
    memo: text('memo'),
    /** UNTRUSTED. */
    merchant: text('merchant'),
    createdAt: text('createdAt').notNull(),
  },
  (t) => [
    index('transactions_occurred_idx').on(t.occurredAt),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_account_idx').on(t.accountId),
  ],
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    categoryId: text('categoryId').notNull().references(() => categories.id),
    periodStart: text('periodStart').notNull(),
    periodEnd: text('periodEnd').notNull(),
    limitMinor: integer('limitMinor').notNull(),
    currency: text('currency').notNull(),
  },
  (t) => [index('budgets_category_idx').on(t.categoryId)],
);

export const turnTraces = sqliteTable(
  'turn_traces',
  {
    turnId: text('turnId').primaryKey(),
    transcript: text('transcript').notNull(),
    decidedAt: text('decidedAt').notNull(),
    candidates: text('candidates', { mode: 'json' }).notNull(),
    outcome: text('outcome').notNull(),
    capabilityId: text('capabilityId'),
    modelId: text('modelId'),
    promptVersion: text('promptVersion'),
    latencyMs: integer('latencyMs').notNull(),
    undoToken: text('undoToken'),
    createdAt: text('createdAt').notNull(),
  },
  (t) => [index('turn_traces_created_idx').on(t.createdAt)],
);

export const dataRefs = sqliteTable(
  'data_refs',
  {
    id: text('id').primaryKey(),
    turnId: text('turnId').notNull().references(() => turnTraces.turnId),
    tableName: text('tableName').notNull(),
    rowCount: integer('rowCount').notNull(),
    rangeFrom: text('rangeFrom'),
    rangeTo: text('rangeTo'),
  },
  (t) => [index('data_refs_turn_idx').on(t.turnId)],
);

export const undoJournal = sqliteTable('undo_journal', {
  token: text('token').primaryKey(),
  capabilityId: text('capabilityId').notNull(),
  params: text('params', { mode: 'json' }).notNull(),
  describedAs: text('describedAs').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  recordedAt: text('recordedAt').notNull(),
  undoneAt: text('undoneAt'),
});

export const schema = {
  accounts,
  categories,
  transactions,
  budgets,
  turnTraces,
  dataRefs,
  undoJournal,
};

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
