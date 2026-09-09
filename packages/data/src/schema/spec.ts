/**
 * The table specification — the one place the entity model is written down.
 *
 * WP-04 requires that the same definitions compile for SQLite *and* Postgres.
 * Drizzle's dialect builders are different enough that writing the schema twice
 * is the obvious approach and the wrong one: two hand-maintained schemas drift,
 * and they drift silently until a migration runs against the wrong shape.
 *
 * So the shape lives here as data, both dialects are generated from it, and a
 * parity test asserts they never diverge.
 *
 * Entity model from [sdlc/design.md](../../../../.claude/sdlc/design.md).
 */

export type ColumnType =
  | 'text'
  | 'integer'
  /** Signed integer minor units. A distinct type so a float money column is impossible. */
  | 'money'
  /** ISO-8601 UTC string. Never a local timestamp, never a unix epoch. */
  | 'timestamp'
  /** ISO date, no time component. */
  | 'date'
  | 'boolean'
  | 'json';

export interface ColumnSpec {
  readonly type: ColumnType;
  readonly primaryKey?: boolean;
  readonly notNull?: boolean;
  readonly unique?: boolean;
  readonly references?: { readonly table: string; readonly column: string };
  readonly default?: string | number | boolean;
  /** Marks attacker-controllable text. See security.md — never interpolate unfenced. */
  readonly untrusted?: boolean;
  readonly comment?: string;
}

export interface TableSpec {
  readonly name: string;
  readonly columns: Readonly<Record<string, ColumnSpec>>;
  readonly indexes?: readonly { readonly name: string; readonly columns: readonly string[] }[];
  readonly comment?: string;
}

export const ACCOUNTS: TableSpec = {
  name: 'accounts',
  comment: 'An account holds a currency. Every transaction on it must agree (ADR-010).',
  columns: {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true, comment: 'current | savings | credit_card | cash' },
    currency: { type: 'text', notNull: true, comment: 'ISO 4217. Binds every amount on this account.' },
    openingMinor: { type: 'money', notNull: true, default: 0 },
    createdAt: { type: 'timestamp', notNull: true },
  },
};

export const CATEGORIES: TableSpec = {
  name: 'categories',
  comment: 'A tree. "food" must aggregate "groceries" and "restaurants" — see the recursive CTE in the query engine.',
  columns: {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    parentId: { type: 'text', references: { table: 'categories', column: 'id' } },
    icon: { type: 'text' },
    kind: { type: 'text', notNull: true, comment: 'expense | income. A classification, NOT the source of an amount\'s sign.' },
  },
  indexes: [{ name: 'categories_parent_idx', columns: ['parentId'] }],
};

export const TRANSACTIONS: TableSpec = {
  name: 'transactions',
  comment: 'amountMinor is SIGNED: negative leaves the account, positive arrives (ADR-010).',
  columns: {
    id: { type: 'text', primaryKey: true },
    accountId: { type: 'text', notNull: true, references: { table: 'accounts', column: 'id' } },
    categoryId: { type: 'text', references: { table: 'categories', column: 'id' } },
    amountMinor: { type: 'money', notNull: true },
    currency: { type: 'text', notNull: true, comment: 'Must equal the account currency. Refused, never converted.' },
    occurredAt: { type: 'timestamp', notNull: true, comment: 'UTC. When the money moved.' },
    memo: { type: 'text', untrusted: true, comment: 'UNTRUSTED. Attacker-controllable; fence before it reaches a prompt.' },
    merchant: { type: 'text', untrusted: true, comment: 'UNTRUSTED. Same.' },
    createdAt: { type: 'timestamp', notNull: true, comment: 'UTC. When we recorded it.' },
  },
  indexes: [
    { name: 'transactions_occurred_idx', columns: ['occurredAt'] },
    { name: 'transactions_category_idx', columns: ['categoryId'] },
    { name: 'transactions_account_idx', columns: ['accountId'] },
  ],
};

export const BUDGETS: TableSpec = {
  name: 'budgets',
  columns: {
    id: { type: 'text', primaryKey: true },
    categoryId: { type: 'text', notNull: true, references: { table: 'categories', column: 'id' } },
    periodStart: { type: 'date', notNull: true },
    periodEnd: { type: 'date', notNull: true },
    limitMinor: { type: 'money', notNull: true, comment: 'Positive magnitude: a spending cap, not a signed movement.' },
    currency: { type: 'text', notNull: true },
  },
  indexes: [{ name: 'budgets_category_idx', columns: ['categoryId'] }],
};

export const TURN_TRACES: TableSpec = {
  name: 'turn_traces',
  comment: 'A first-class entity, not a log file (Rule 9). Queried by the trace viewer, exported for eval sets.',
  columns: {
    turnId: { type: 'text', primaryKey: true },
    transcript: { type: 'text', notNull: true, untrusted: true },
    decidedAt: { type: 'text', notNull: true, comment: 'deterministic | embedding | llm | none' },
    candidates: { type: 'json', notNull: true, comment: 'Scored alternatives — what it considered and why not.' },
    outcome: { type: 'text', notNull: true },
    capabilityId: { type: 'text' },
    modelId: { type: 'text' },
    promptVersion: { type: 'text' },
    latencyMs: { type: 'integer', notNull: true },
    undoToken: { type: 'text' },
    createdAt: { type: 'timestamp', notNull: true },
  },
  indexes: [{ name: 'turn_traces_created_idx', columns: ['createdAt'] }],
};

export const DATA_REFS: TableSpec = {
  name: 'data_refs',
  comment: 'What a turn read. "What data did you use?" is answered from this, not by asking the model.',
  columns: {
    id: { type: 'text', primaryKey: true },
    turnId: { type: 'text', notNull: true, references: { table: 'turn_traces', column: 'turnId' } },
    tableName: { type: 'text', notNull: true },
    rowCount: { type: 'integer', notNull: true },
    rangeFrom: { type: 'date' },
    rangeTo: { type: 'date' },
  },
  indexes: [{ name: 'data_refs_turn_idx', columns: ['turnId'] }],
};

export const UNDO_JOURNAL: TableSpec = {
  name: 'undo_journal',
  comment: 'ADR-004: recorded BEFORE a destructive action, and it outlives the screen.',
  columns: {
    token: { type: 'text', primaryKey: true },
    capabilityId: { type: 'text', notNull: true },
    params: { type: 'json', notNull: true },
    describedAs: { type: 'text', notNull: true },
    payload: { type: 'json', notNull: true, comment: 'What is needed to put it back.' },
    recordedAt: { type: 'timestamp', notNull: true },
    undoneAt: { type: 'timestamp' },
  },
};

export const MODULE_CATEGORIES: TableSpec = {
  name: 'module_categories',
  comment: 'A tree, same shape as categories — but entirely user/AI-created at runtime. No seeded taxonomy.',
  columns: {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    parentId: { type: 'text', references: { table: 'module_categories', column: 'id' } },
    icon: { type: 'text' },
  },
  indexes: [{ name: 'module_categories_parent_idx', columns: ['parentId'] }],
};

export const MODULES: TableSpec = {
  name: 'modules',
  comment: 'What the user asked the AI to remember. body is the current canonical merged content — module_entries is the append-only log of what built it.',
  columns: {
    id: { type: 'text', primaryKey: true },
    categoryId: { type: 'text', references: { table: 'module_categories', column: 'id' } },
    title: { type: 'text', notNull: true },
    summary: { type: 'text', notNull: true, comment: 'Short text. What gets embedded for create-vs-append search — distinct from body.' },
    body: { type: 'text', notNull: true, untrusted: true, comment: 'UNTRUSTED. Model-consolidated prose; fence before it reaches a prompt.' },
    createdAt: { type: 'timestamp', notNull: true },
    updatedAt: { type: 'timestamp', notNull: true },
  },
  indexes: [{ name: 'modules_category_idx', columns: ['categoryId'] }],
};

export const MODULE_ENTRIES: TableSpec = {
  name: 'module_entries',
  comment: 'Append-only provenance log, never edited. Answers "what was this module built from" the way data_refs answers "what did this turn read".',
  columns: {
    id: { type: 'text', primaryKey: true },
    moduleId: { type: 'text', notNull: true, references: { table: 'modules', column: 'id' } },
    kind: { type: 'text', notNull: true, comment: 'seed | append | merge_snapshot | revert' },
    sourceType: { type: 'text', notNull: true, comment: 'text | image | document | voice' },
    sourceExcerpt: { type: 'text', untrusted: true, comment: 'UNTRUSTED. Raw extracted text that fed this entry, length-capped.' },
    createdAt: { type: 'timestamp', notNull: true },
  },
  indexes: [{ name: 'module_entries_module_idx', columns: ['moduleId'] }],
};

export const TABLES: readonly TableSpec[] = [
  ACCOUNTS,
  CATEGORIES,
  TRANSACTIONS,
  BUDGETS,
  TURN_TRACES,
  DATA_REFS,
  UNDO_JOURNAL,
  MODULE_CATEGORIES,
  MODULES,
  MODULE_ENTRIES,
];

/** Every money column in the model. The parity test asserts each is an integer. */
export function moneyColumns(): readonly { table: string; column: string }[] {
  return TABLES.flatMap((t) =>
    Object.entries(t.columns)
      .filter(([, c]) => c.type === 'money')
      .map(([column]) => ({ table: t.name, column })),
  );
}

/** Every attacker-controllable text column. security.md fencing applies to these. */
export function untrustedColumns(): readonly { table: string; column: string }[] {
  return TABLES.flatMap((t) =>
    Object.entries(t.columns)
      .filter(([, c]) => c.untrusted)
      .map(([column]) => ({ table: t.name, column })),
  );
}
