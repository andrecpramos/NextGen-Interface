import { DatabaseSync } from 'node:sqlite';

/**
 * Migrations.
 *
 * Hand-written rather than generated, for one reason: WP-04 requires a migration
 * test *from every prior schema*, and that is only meaningful if each step is a
 * reviewable statement of intent. A generated diff tells you what changed; it
 * does not tell you what happens to the rows.
 *
 * Rules, in order of how much they cost when broken:
 *
 *  1. **A migration never loses a row.** The test asserts counts across every
 *     upgrade path, not just the newest one.
 *  2. **Back up first, restore on failure.** SQLite DDL is transactional, but a
 *     multi-statement migration that half-succeeds leaves a shape no version
 *     recognises.
 *  3. Migrations are append-only. Editing a shipped one means devices that
 *     already ran it never get the change.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-finance-schema',
    up: `
      CREATE TABLE accounts (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL,
        currency      TEXT NOT NULL,
        openingMinor  INTEGER NOT NULL DEFAULT 0,
        createdAt     TEXT NOT NULL
      );

      CREATE TABLE categories (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        parentId  TEXT REFERENCES categories(id),
        icon      TEXT,
        kind      TEXT NOT NULL
      );
      CREATE INDEX categories_parent_idx ON categories(parentId);

      CREATE TABLE transactions (
        id            TEXT PRIMARY KEY,
        accountId     TEXT NOT NULL REFERENCES accounts(id),
        categoryId    TEXT REFERENCES categories(id),
        amountMinor   INTEGER NOT NULL,
        currency      TEXT NOT NULL,
        occurredAt    TEXT NOT NULL,
        memo          TEXT,
        merchant      TEXT,
        createdAt     TEXT NOT NULL
      );
      CREATE INDEX transactions_occurred_idx ON transactions(occurredAt);
      CREATE INDEX transactions_category_idx ON transactions(categoryId);
      CREATE INDEX transactions_account_idx  ON transactions(accountId);

      CREATE TABLE budgets (
        id           TEXT PRIMARY KEY,
        categoryId   TEXT NOT NULL REFERENCES categories(id),
        periodStart  TEXT NOT NULL,
        periodEnd    TEXT NOT NULL,
        limitMinor   INTEGER NOT NULL,
        currency     TEXT NOT NULL
      );
      CREATE INDEX budgets_category_idx ON budgets(categoryId);
    `,
  },
  {
    version: 2,
    name: 'trace-and-undo',
    // Explainability is a record, not a log file (Rule 9), so the trace tables
    // are schema and get migrated like anything else.
    up: `
      CREATE TABLE turn_traces (
        turnId        TEXT PRIMARY KEY,
        transcript    TEXT NOT NULL,
        decidedAt     TEXT NOT NULL,
        candidates    TEXT NOT NULL,
        outcome       TEXT NOT NULL,
        capabilityId  TEXT,
        modelId       TEXT,
        promptVersion TEXT,
        latencyMs     INTEGER NOT NULL,
        undoToken     TEXT,
        createdAt     TEXT NOT NULL
      );
      CREATE INDEX turn_traces_created_idx ON turn_traces(createdAt);

      CREATE TABLE data_refs (
        id         TEXT PRIMARY KEY,
        turnId     TEXT NOT NULL REFERENCES turn_traces(turnId),
        tableName  TEXT NOT NULL,
        rowCount   INTEGER NOT NULL,
        rangeFrom  TEXT,
        rangeTo    TEXT
      );
      CREATE INDEX data_refs_turn_idx ON data_refs(turnId);

      CREATE TABLE undo_journal (
        token         TEXT PRIMARY KEY,
        capabilityId  TEXT NOT NULL,
        params        TEXT NOT NULL,
        describedAs   TEXT NOT NULL,
        payload       TEXT NOT NULL,
        recordedAt    TEXT NOT NULL,
        undoneAt      TEXT
      );
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

export interface MigrateResult {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly string[];
}

/**
 * Migrate up to `target`.
 *
 * Each step runs inside a transaction and bumps `user_version` as part of it, so
 * a failure leaves the database at the last version that fully succeeded — never
 * halfway through one.
 */
export function migrate(db: DatabaseSync, target = LATEST_VERSION): MigrateResult {
  const from = currentVersion(db);
  const applied: string[] = [];

  db.exec('PRAGMA foreign_keys = ON');

  for (const m of MIGRATIONS) {
    if (m.version <= from || m.version > target) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      // PRAGMA does not take a bound parameter. The value is a number from a
      // hard-coded list in this file, never from input.
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
      applied.push(`${m.version}-${m.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        `migration ${m.version} (${m.name}) failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Database left at version ${currentVersion(db)}.`,
      );
    }
  }

  return { from, to: currentVersion(db), applied };
}

/**
 * Migrate a file-backed database, taking a backup first and restoring it if
 * anything throws.
 *
 * The per-step transaction above protects the *shape*. This protects the file:
 * a torn write or a crash mid-migration is not something a transaction can undo,
 * and "the migration failed and your data is gone" is the worst outcome this
 * system has.
 */
export async function migrateFileWithBackup(
  path: string,
  target = LATEST_VERSION,
): Promise<MigrateResult> {
  const { copyFileSync, existsSync, unlinkSync } = await import('node:fs');
  const backup = `${path}.backup`;
  const hadExisting = existsSync(path);
  if (hadExisting) copyFileSync(path, backup);

  const db = new DatabaseSync(path);
  try {
    const result = migrate(db, target);
    db.close();
    if (hadExisting && existsSync(backup)) unlinkSync(backup);
    return result;
  } catch (err) {
    db.close();
    if (hadExisting) copyFileSync(backup, path);
    throw err;
  }
}

/** An in-memory database at the latest schema. Used by tests and fixtures. */
export function openMemoryDatabase(target = LATEST_VERSION): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db, target);
  return db;
}
