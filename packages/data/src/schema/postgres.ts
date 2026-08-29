import { pgTable, index, bigint, integer, jsonb, text } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * The Postgres schema.
 *
 * The device is the source of truth ([ADR-008](../../../../.ai/decisions/ADR-008.md)) —
 * this exists because the backend must be able to hold the same shape, not
 * because anything reads from it on the critical path.
 *
 * Two dialect differences, both deliberate:
 *
 *  - `money` is **`bigint`**, not `integer`. SQLite integers are already 64-bit;
 *    Postgres `integer` is 32-bit and would overflow at ~21 million in a
 *    two-decimal currency. That is not a hypothetical for a lifetime balance in
 *    a minor unit.
 *  - JSON is `jsonb`, which is queryable, rather than SQLite's text-encoded JSON.
 *
 * Everything else matches column for column, and `schema.test.ts` asserts it.
 */

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  currency: text('currency').notNull(),
  openingMinor: bigint('openingMinor', { mode: 'number' }).notNull().default(0),
  createdAt: text('createdAt').notNull(),
});

export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    parentId: text('parentId').references((): AnyPgColumn => categories.id),
    icon: text('icon'),
    kind: text('kind').notNull(),
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull().references(() => accounts.id),
    categoryId: text('categoryId').references(() => categories.id),
    /** SIGNED minor units. Negative leaves the account (ADR-010). */
    amountMinor: bigint('amountMinor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    occurredAt: text('occurredAt').notNull(),
    /** UNTRUSTED. */
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

export const budgets = pgTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    categoryId: text('categoryId').notNull().references(() => categories.id),
    periodStart: text('periodStart').notNull(),
    periodEnd: text('periodEnd').notNull(),
    limitMinor: bigint('limitMinor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
  },
  (t) => [index('budgets_category_idx').on(t.categoryId)],
);

export const turnTraces = pgTable(
  'turn_traces',
  {
    turnId: text('turnId').primaryKey(),
    transcript: text('transcript').notNull(),
    decidedAt: text('decidedAt').notNull(),
    candidates: jsonb('candidates').notNull(),
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

export const dataRefs = pgTable(
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

export const undoJournal = pgTable('undo_journal', {
  token: text('token').primaryKey(),
  capabilityId: text('capabilityId').notNull(),
  params: jsonb('params').notNull(),
  describedAs: text('describedAs').notNull(),
  payload: jsonb('payload').notNull(),
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
