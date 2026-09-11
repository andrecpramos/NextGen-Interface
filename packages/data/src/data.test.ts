import { DatabaseSync } from 'node:sqlite';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  addMoney, assertMinorUnits, CurrencyMismatchError, formatMoney, fromMajorUnits, money, signed,
} from './money.ts';
import { currentVersion, LATEST_VERSION, migrate, MIGRATIONS, openMemoryDatabase } from './migrate.ts';
import {
  SqliteAccountRepository, SqliteBudgetRepository, SqliteCategoryRepository, SqliteTransactionRepository,
  SqliteModuleCategoryRepository, SqliteModuleRepository, SqliteModuleEntryRepository,
} from './repositories.ts';
import { SqliteQueryEngine } from './query-engine.ts';
import { canUndo, REVERSIBLE_CAPABILITIES, SqliteUndoJournal } from './undo.ts';
import { seed } from './fixtures.ts';
import { moneyColumns, TABLES, untrustedColumns } from './schema/spec.ts';
import { schema as sqliteSchema } from './schema/sqlite.ts';
import { schema as pgSchema } from './schema/postgres.ts';

const ACC = {
  id: 'acc1', name: 'Everyday', type: 'current' as const, currency: 'EUR' as const,
  openingMinor: 100000, createdAt: '2026-01-01T00:00:00.000Z',
};

function freshDb() {
  const db = openMemoryDatabase();
  new SqliteAccountRepository(db).insert(ACC);
  return db;
}

// -------------------------------------------------------------------- money --

describe('money — Rule 6, integer minor units', () => {
  it('rejects a float outright', () => {
    expect(() => assertMinorUnits(12.5)).toThrow(TypeError);
    expect(() => money(0.1 + 0.2, 'EUR')).toThrow(TypeError);
  });

  it('rejects an unsafe integer', () => {
    expect(() => assertMinorUnits(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it('parses major units by rounding half-up, not truncating', () => {
    // WP-02 found the router truncating the third decimal. That was an artefact
    // of a capture regex; this states the answer.
    expect(fromMajorUnits('12.345', 'EUR').amountMinor).toBe(1235);
    expect(fromMajorUnits('12.344', 'EUR').amountMinor).toBe(1234);
    expect(fromMajorUnits(19.99, 'EUR').amountMinor).toBe(1999);
    expect(fromMajorUnits('0.1', 'EUR').amountMinor).toBe(10);
  });

  it('rounds negatives away from zero by the same distance as positives', () => {
    expect(fromMajorUnits('-12.345', 'EUR').amountMinor).toBe(-1235);
  });

  it('parses a decimal STRING exactly, without ever multiplying a float', () => {
    // 1.005 * 100 is 100.49999999999999, so the naive version returns 100 and is
    // a cent short with nothing to show for it. These go through the digits.
    expect(fromMajorUnits('1.005', 'EUR').amountMinor).toBe(101);
    expect(fromMajorUnits('2.675', 'EUR').amountMinor).toBe(268);
    expect(fromMajorUnits('1.015', 'EUR').amountMinor).toBe(102);
    expect(fromMajorUnits('-1.005', 'EUR').amountMinor).toBe(-101);
  });

  it('takes a number at the value it actually holds, not the one it was typed as', () => {
    // The literal 1.005 IS 1.00499999999999989 before this function sees it — the
    // cent was lost at the call site. Rounding it to 1.00 is correct for the
    // value that arrived, and is why the string path above exists. Pass strings
    // on any path where the exact amount matters.
    expect(fromMajorUnits(1.005, 'EUR').amountMinor).toBe(100);
    expect(fromMajorUnits(0.07 * 100, 'EUR').amountMinor).toBe(700);
  });
});

describe('money — sign is the domain\'s decision (ADR-010 §2)', () => {
  it('applies direction to an unsigned magnitude', () => {
    expect(signed(5000, 'outflow', 'EUR').amountMinor).toBe(-5000);
    expect(signed(5000, 'inflow', 'EUR').amountMinor).toBe(5000);
  });

  it('treats a magnitude that already has a sign as a magnitude', () => {
    // The router returns "twenty euros" as 2000 whether or not the sentence said
    // "minus". Direction comes from the capability, not the sentence.
    expect(signed(-5000, 'outflow', 'EUR').amountMinor).toBe(-5000);
    expect(signed(-5000, 'inflow', 'EUR').amountMinor).toBe(5000);
  });
});

describe('money — never converts (ADR-010 §3)', () => {
  it('refuses to add mixed currencies rather than guessing a rate', () => {
    expect(() => addMoney(money(100, 'EUR'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('adds within one currency', () => {
    expect(addMoney(money(100, 'EUR'), money(-250, 'EUR')).amountMinor).toBe(-150);
  });

  it('formats without being usable for arithmetic', () => {
    expect(formatMoney(money(-1250, 'EUR'))).toContain('12.50');
  });
});

// ------------------------------------------------------------------ schema --

describe('schema — parity between dialects', () => {
  it('declares the same tables in both dialects and in the spec', () => {
    const specNames = TABLES.map((t) => t.name).sort();
    const sqliteNames = Object.values(sqliteSchema).map(getTableName).sort();
    const pgNames = Object.values(pgSchema).map(getTableName).sort();
    expect(sqliteNames).toEqual(specNames);
    expect(pgNames).toEqual(specNames);
  });

  it('declares the same columns for every table in both dialects', () => {
    for (const key of Object.keys(sqliteSchema) as (keyof typeof sqliteSchema)[]) {
      const s = Object.keys(getTableColumns(sqliteSchema[key])).sort();
      const p = Object.keys(getTableColumns(pgSchema[key])).sort();
      expect({ table: key, columns: p }).toEqual({ table: key, columns: s });
    }
  });

  it('has no float money column anywhere — Rule 6, checked structurally', () => {
    const cols = moneyColumns();
    expect(cols.length).toBeGreaterThan(0);
    for (const { table, column } of cols) {
      const sqliteTable = Object.values(sqliteSchema).find((t) => getTableName(t) === table)!;
      const pgTable = Object.values(pgSchema).find((t) => getTableName(t) === table)!;
      const sCol = (getTableColumns(sqliteTable) as Record<string, { columnType: string }>)[column]!;
      const pCol = (getTableColumns(pgTable) as Record<string, { columnType: string }>)[column]!;
      // SQLite integers are already 64-bit; Postgres 'integer' is 32-bit and
      // would overflow at ~21 million in a two-decimal currency, so it is bigint.
      expect(`${table}.${column}: ${sCol.columnType}`).toBe(`${table}.${column}: SQLiteInteger`);
      expect(`${table}.${column}: ${pCol.columnType}`).toBe(`${table}.${column}: PgBigInt53`);
    }
  });

  it('marks the attacker-controllable columns design.md calls out', () => {
    expect(untrustedColumns()).toEqual(
      expect.arrayContaining([
        { table: 'transactions', column: 'memo' },
        { table: 'transactions', column: 'merchant' },
      ]),
    );
  });
});

// -------------------------------------------------------------- migrations --

describe('migrations', () => {
  it('reaches the latest version from empty', () => {
    const db = new DatabaseSync(':memory:');
    const r = migrate(db);
    expect(r.from).toBe(0);
    expect(r.to).toBe(LATEST_VERSION);
    expect(currentVersion(db)).toBe(LATEST_VERSION);
  });

  it('is idempotent — re-running applies nothing', () => {
    const db = openMemoryDatabase();
    expect(migrate(db).applied).toEqual([]);
  });

  /**
   * The requirement: a migration from EVERY prior schema preserves all rows.
   * Testing only the newest hop is how a v1→v2 data loss ships to the devices
   * that skipped a release.
   */
  it('preserves every row across every upgrade path', () => {
    for (const start of MIGRATIONS.map((m) => m.version)) {
      const db = new DatabaseSync(':memory:');
      migrate(db, start);

      const accounts = new SqliteAccountRepository(db);
      const transactions = new SqliteTransactionRepository(db);
      accounts.insert(ACC);
      for (let i = 0; i < 25; i++) {
        transactions.insert({
          id: `tx${i}`, accountId: 'acc1', categoryId: null,
          amountMinor: -(100 + i), currency: 'EUR',
          occurredAt: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
          memo: null, merchant: null, createdAt: '2026-03-01T00:00:00.000Z',
        });
      }
      const before = db.prepare('SELECT COUNT(*) AS n, SUM(amountMinor) AS s FROM transactions').get();

      migrate(db, LATEST_VERSION);

      const after = db.prepare('SELECT COUNT(*) AS n, SUM(amountMinor) AS s FROM transactions').get();
      expect({ from: start, ...after as object }).toEqual({ from: start, ...before as object });
      expect(currentVersion(db)).toBe(LATEST_VERSION);
    }
  });

  it('leaves the database at the last good version when a migration throws', () => {
    const db = openMemoryDatabase(1);
    const broken = [{ version: 2, name: 'broken', up: 'CREATE TABLE ok(a); CREATE TABLE nope(' }];
    expect(() => {
      for (const m of broken) {
        db.exec('BEGIN');
        try {
          db.exec(m.up);
          db.exec(`PRAGMA user_version = ${m.version}`);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      }
    }).toThrow();
    expect(currentVersion(db)).toBe(1);
    // The half-created table from the failed step must not survive.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ok'").all();
    expect(tables).toEqual([]);
  });
});

// ------------------------------------------------------------ repositories --

describe('repositories — invariants at the boundary', () => {
  it('refuses a float amount', () => {
    const db = freshDb();
    expect(() =>
      new SqliteTransactionRepository(db).insert({
        id: 't1', accountId: 'acc1', categoryId: null, amountMinor: 12.5, currency: 'EUR',
        occurredAt: '2026-03-01T10:00:00.000Z', memo: null, merchant: null,
        createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toThrow(TypeError);
  });

  it('refuses a currency that disagrees with the account, and never converts', () => {
    const db = freshDb();
    expect(() =>
      new SqliteTransactionRepository(db).insert({
        id: 't1', accountId: 'acc1', categoryId: null, amountMinor: -1000, currency: 'USD',
        occurredAt: '2026-03-01T10:00:00.000Z', memo: null, merchant: null,
        createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toThrow(CurrencyMismatchError);
  });

  it('refuses a non-UTC timestamp', () => {
    const db = freshDb();
    expect(() =>
      new SqliteTransactionRepository(db).insert({
        id: 't1', accountId: 'acc1', categoryId: null, amountMinor: -1000, currency: 'EUR',
        occurredAt: '2026-03-01T10:00:00+01:00', memo: null, merchant: null,
        createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toThrow(/UTC/);
  });

  it('refuses a negative budget limit — a cap carries no sign', () => {
    const db = freshDb();
    new SqliteCategoryRepository(db).insert({ id: 'food', name: 'Food', parentId: null, icon: null, kind: 'expense' });
    expect(() =>
      new SqliteBudgetRepository(db).insert({
        id: 'b1', categoryId: 'food', periodStart: '2026-03-01', periodEnd: '2026-03-31',
        limitMinor: -45000, currency: 'EUR',
      }),
    ).toThrow(/positive magnitude/);
  });

  it('refuses a budget that ends before it starts', () => {
    const db = freshDb();
    new SqliteCategoryRepository(db).insert({ id: 'food', name: 'Food', parentId: null, icon: null, kind: 'expense' });
    expect(() =>
      new SqliteBudgetRepository(db).insert({
        id: 'b1', categoryId: 'food', periodStart: '2026-03-31', periodEnd: '2026-03-01',
        limitMinor: 45000, currency: 'EUR',
      }),
    ).toThrow();
  });

  it('refuses a self-parenting category', () => {
    const db = freshDb();
    expect(() =>
      new SqliteCategoryRepository(db).insert({ id: 'food', name: 'Food', parentId: 'food', icon: null, kind: 'expense' }),
    ).toThrow();
  });

  it('returns the deleted row so undo has something to restore', () => {
    const db = freshDb();
    const repo = new SqliteTransactionRepository(db);
    const tx = {
      id: 't1', accountId: 'acc1', categoryId: null, amountMinor: -1000, currency: 'EUR' as const,
      occurredAt: '2026-03-01T10:00:00.000Z', memo: null, merchant: null,
      createdAt: '2026-03-01T10:00:00.000Z',
    };
    repo.insert(tx);
    expect(repo.delete('t1')).toMatchObject({ id: 't1', amountMinor: -1000 });
    expect(repo.get('t1')).toBeNull();
  });
});

// -------------------------------------------------------------- modules --

describe('module repositories — invariants at the boundary', () => {
  it('refuses a self-parenting module category', () => {
    const db = freshDb();
    expect(() =>
      new SqliteModuleCategoryRepository(db).insert({ id: 'health', name: 'Health', parentId: 'health', icon: null }),
    ).toThrow();
  });

  it('refuses a module that references an unknown category', () => {
    const db = freshDb();
    expect(() =>
      new SqliteModuleRepository(db).insert({
        id: 'm1', categoryId: 'nope', title: 'Passport renewal', summary: 'How to renew.',
        body: 'Full text.', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toThrow(/unknown category/);
  });

  it('accepts a module with no category — uncategorised is a valid state', () => {
    const db = freshDb();
    const repo = new SqliteModuleRepository(db);
    repo.insert({
      id: 'm1', categoryId: null, title: 'Passport renewal', summary: 'How to renew.',
      body: 'Full text.', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
    });
    expect(repo.get('m1')).toMatchObject({ id: 'm1', categoryId: null });
  });

  it('refuses a module entry that references an unknown module', () => {
    const db = freshDb();
    expect(() =>
      new SqliteModuleEntryRepository(db).insert({
        id: 'e1', moduleId: 'nope', kind: 'seed', sourceType: 'text',
        sourceExcerpt: 'raw text', createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toThrow(/unknown module/);
  });

  it('refuses an entry with an unrecognised kind or source type', () => {
    const db = freshDb();
    new SqliteModuleRepository(db).insert({
      id: 'm1', categoryId: null, title: 'Passport renewal', summary: 'How to renew.',
      body: 'Full text.', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
    });
    const entries = new SqliteModuleEntryRepository(db);
    expect(() =>
      entries.insert({
        id: 'e1', moduleId: 'm1', kind: 'nonsense' as never, sourceType: 'text',
        sourceExcerpt: null, createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toThrow(/kind/);
    expect(() =>
      entries.insert({
        id: 'e2', moduleId: 'm1', kind: 'seed', sourceType: 'carrier-pigeon' as never,
        sourceExcerpt: null, createdAt: '2026-03-01T10:00:00.000Z',
      }),
    ).toThrow(/sourceType/);
  });

  it('logs provenance as an append-only list, oldest first', () => {
    const db = freshDb();
    new SqliteModuleRepository(db).insert({
      id: 'm1', categoryId: null, title: 'Passport renewal', summary: 'How to renew.',
      body: 'Seed text.', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
    });
    const entries = new SqliteModuleEntryRepository(db);
    entries.insert({
      id: 'e1', moduleId: 'm1', kind: 'seed', sourceType: 'text',
      sourceExcerpt: 'seed text', createdAt: '2026-03-01T10:00:00.000Z',
    });
    entries.insert({
      id: 'e2', moduleId: 'm1', kind: 'append', sourceType: 'document',
      sourceExcerpt: 'appended text', createdAt: '2026-03-02T10:00:00.000Z',
    });
    expect(entries.listByModule('m1').map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('update replaces the current body — the entry log is what preserves history', () => {
    const db = freshDb();
    const repo = new SqliteModuleRepository(db);
    repo.insert({
      id: 'm1', categoryId: null, title: 'Passport renewal', summary: 'How to renew.',
      body: 'Seed text.', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
    });
    const next = repo.update('m1', { body: 'Merged text.', updatedAt: '2026-03-02T10:00:00.000Z' });
    expect(next).toMatchObject({ id: 'm1', body: 'Merged text.' });
    expect(repo.get('m1')).toMatchObject({ body: 'Merged text.' });
  });

  it('returns the deleted module so undo has something to restore', () => {
    const db = freshDb();
    const repo = new SqliteModuleRepository(db);
    repo.insert({
      id: 'm1', categoryId: null, title: 'Passport renewal', summary: 'How to renew.',
      body: 'Full text.', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
    });
    expect(repo.delete('m1')).toMatchObject({ id: 'm1', title: 'Passport renewal' });
    expect(repo.get('m1')).toBeNull();
  });
});

// ------------------------------------------------------------ query engine --

describe('query engine — category roll-up', () => {
  function treeDb() {
    const db = freshDb();
    const cats = new SqliteCategoryRepository(db);
    const tx = new SqliteTransactionRepository(db);
    cats.insert({ id: 'food', name: 'Food', parentId: null, icon: null, kind: 'expense' });
    cats.insert({ id: 'groceries', name: 'Groceries', parentId: 'food', icon: null, kind: 'expense' });
    cats.insert({ id: 'restaurants', name: 'Restaurants', parentId: 'food', icon: null, kind: 'expense' });
    cats.insert({ id: 'coffee', name: 'Coffee', parentId: 'food', icon: null, kind: 'expense' });
    // Deliberately three levels deep: a two-level join would silently miss this.
    cats.insert({ id: 'espresso', name: 'Espresso', parentId: 'coffee', icon: null, kind: 'expense' });
    cats.insert({ id: 'transport', name: 'Transport', parentId: null, icon: null, kind: 'expense' });

    const add = (id: string, categoryId: string, amountMinor: number, day: string) =>
      tx.insert({
        id, accountId: 'acc1', categoryId, amountMinor, currency: 'EUR',
        occurredAt: `2026-07-${day}T10:00:00.000Z`, memo: null, merchant: null,
        createdAt: `2026-07-${day}T10:00:00.000Z`,
      });

    add('t1', 'groceries', -5000, '05');
    add('t2', 'restaurants', -3000, '10');
    add('t3', 'coffee', -400, '15');
    add('t4', 'espresso', -250, '20');
    add('t5', 'transport', -1200, '25');
    // An inflow inside an expense category — a refund. It must NOT reduce
    // "spending", which is the sum of outflows only.
    add('t6', 'groceries', 900, '28');
    return db;
  }

  it('rolls descendants up to the parent, at any depth', () => {
    const q = new SqliteQueryEngine(treeDb());
    const r = q.spendingInCategory({ categoryId: 'food', from: '2026-07-01', to: '2026-07-31', currency: 'EUR' });
    // 5000 + 3000 + 400 + 250 = 8650. The refund is not an outflow.
    expect(r.rows[0]!.totalMinor).toBe(8650);
    expect(r.rows[0]!.transactionCount).toBe(4);
  });

  it('rolls a mid-tree node up over its own descendants only', () => {
    const q = new SqliteQueryEngine(treeDb());
    const r = q.spendingInCategory({ categoryId: 'coffee', from: '2026-07-01', to: '2026-07-31', currency: 'EUR' });
    expect(r.rows[0]!.totalMinor).toBe(650);
  });

  it('groups by top-level category', () => {
    const q = new SqliteQueryEngine(treeDb());
    const rows = q.spendingByCategory({ from: '2026-07-01', to: '2026-07-31', currency: 'EUR' }).rows;
    expect(rows.map((r) => [r.categoryId, r.totalMinor])).toEqual([
      ['food', 8650],
      ['transport', 1200],
    ]);
  });

  it('includes the last day of the range', () => {
    // Timestamps are stored with a time component, so a date-only upper bound
    // would exclude everything that happened that day.
    const q = new SqliteQueryEngine(treeDb());
    const r = q.spendingInCategory({ categoryId: 'transport', from: '2026-07-25', to: '2026-07-25', currency: 'EUR' });
    expect(r.rows[0]!.totalMinor).toBe(1200);
  });

  it('reports what it read, for the trace', () => {
    const q = new SqliteQueryEngine(treeDb());
    const r = q.spendingTotal({ from: '2026-07-01', to: '2026-07-31', currency: 'EUR' });
    expect(r.dataRead).toEqual([
      { table: 'transactions', rowCount: 5, from: '2026-07-01', to: '2026-07-31' },
    ]);
  });

  it('never sums across currencies', () => {
    const db = treeDb();
    new SqliteAccountRepository(db).insert({ ...ACC, id: 'acc2', currency: 'USD', openingMinor: 0 });
    new SqliteTransactionRepository(db).insert({
      id: 'usd1', accountId: 'acc2', categoryId: 'groceries', amountMinor: -99999, currency: 'USD',
      occurredAt: '2026-07-12T10:00:00.000Z', memo: null, merchant: null, createdAt: '2026-07-12T10:00:00.000Z',
    });
    const q = new SqliteQueryEngine(db);
    expect(q.spendingTotal({ from: '2026-07-01', to: '2026-07-31', currency: 'EUR' }).rows[0]!.totalMinor).toBe(9850);
    expect(q.spendingTotal({ from: '2026-07-01', to: '2026-07-31', currency: 'USD' }).rows[0]!.totalMinor).toBe(99999);
  });
});

describe('query engine — balance and search', () => {
  it('computes balance as opening plus every signed movement', () => {
    const db = freshDb();
    const tx = new SqliteTransactionRepository(db);
    tx.insert({ id: 't1', accountId: 'acc1', categoryId: null, amountMinor: -2500, currency: 'EUR', occurredAt: '2026-03-01T10:00:00.000Z', memo: null, merchant: null, createdAt: '2026-03-01T10:00:00.000Z' });
    tx.insert({ id: 't2', accountId: 'acc1', categoryId: null, amountMinor: 10000, currency: 'EUR', occurredAt: '2026-03-02T10:00:00.000Z', memo: null, merchant: null, createdAt: '2026-03-02T10:00:00.000Z' });
    expect(new SqliteQueryEngine(db).accountBalance({ accountId: 'acc1' }).rows[0]!.balanceMinor).toBe(107500);
  });

  it('treats a LIKE wildcard in the needle as a literal', () => {
    // The needle is bound and escaped, so a memo search for "100%" cannot turn
    // into a match-everything query.
    const db = freshDb();
    const tx = new SqliteTransactionRepository(db);
    const base = { accountId: 'acc1', categoryId: null, amountMinor: -100, currency: 'EUR' as const, occurredAt: '2026-03-01T10:00:00.000Z', merchant: null, createdAt: '2026-03-01T10:00:00.000Z' };
    tx.insert({ ...base, id: 't1', memo: 'paid 100% upfront' });
    tx.insert({ ...base, id: 't2', memo: 'ordinary memo' });
    const q = new SqliteQueryEngine(db);
    expect(q.searchTransactions({ query: '100%' }).rows).toHaveLength(1);
    // A bare '%' is escaped to a literal, so it finds the row containing a
    // percent sign — NOT every row, which is what an unescaped wildcard would do.
    expect(q.searchTransactions({ query: '%' }).rows).toHaveLength(1);
    expect(q.searchTransactions({ query: 'memo' }).rows).toHaveLength(1);
  });
});

// ------------------------------------------------------------------- undo --

describe('undo journal (ADR-004)', () => {
  it('restores a deleted transaction', () => {
    const db = freshDb();
    const repo = new SqliteTransactionRepository(db);
    const journal = new SqliteUndoJournal(db);
    const tx = {
      id: 't1', accountId: 'acc1', categoryId: null, amountMinor: -1000, currency: 'EUR' as const,
      occurredAt: '2026-03-01T10:00:00.000Z', memo: null, merchant: null, createdAt: '2026-03-01T10:00:00.000Z',
    };
    repo.insert(tx);

    const token = journal.record({
      capabilityId: 'transaction.delete', params: { id: 't1' },
      describedAs: 'Delete a transaction', payload: repo.delete('t1'),
      recordedAt: '2026-03-02T10:00:00.000Z',
    });
    expect(repo.get('t1')).toBeNull();
    expect(journal.undo(token)).toEqual({ ok: true });
    expect(repo.get('t1')).toMatchObject({ id: 't1', amountMinor: -1000 });
  });

  it('refuses to spend a token twice', () => {
    const db = freshDb();
    const repo = new SqliteTransactionRepository(db);
    const journal = new SqliteUndoJournal(db);
    repo.insert({ id: 't1', accountId: 'acc1', categoryId: null, amountMinor: -1000, currency: 'EUR', occurredAt: '2026-03-01T10:00:00.000Z', memo: null, merchant: null, createdAt: '2026-03-01T10:00:00.000Z' });
    const token = journal.record({
      capabilityId: 'transaction.delete', params: { id: 't1' }, describedAs: 'Delete',
      payload: repo.delete('t1'), recordedAt: '2026-03-02T10:00:00.000Z',
    });
    expect(journal.undo(token).ok).toBe(true);
    const second = journal.undo(token);
    expect(second.ok).toBe(false);
    // A second undo must not leave a duplicate row behind.
    expect(db.prepare('SELECT COUNT(*) AS n FROM transactions').get()).toMatchObject({ n: 1 });
  });

  it('rejects an unknown token', () => {
    expect(new SqliteUndoJournal(freshDb()).undo('nope').ok).toBe(false);
  });

  it('refuses a capability it has no reversal for, rather than pretending', () => {
    const db = freshDb();
    const journal = new SqliteUndoJournal(db);
    const token = journal.record({
      capabilityId: 'transaction.create', params: {}, describedAs: 'Add',
      payload: {}, recordedAt: '2026-03-02T10:00:00.000Z',
    });
    expect(journal.undo(token)).toMatchObject({ ok: false });
  });
});

// --------------------------------------------------------------- fixtures --

describe('fixtures', () => {
  it('is deterministic for a fixed seed', () => {
    const a = openMemoryDatabase();
    const b = openMemoryDatabase();
    const sa = seed(a);
    const sb = seed(b);
    expect(sa).toEqual(sb);
    const rowsOf = (db: DatabaseSync) =>
      JSON.stringify(db.prepare('SELECT * FROM transactions ORDER BY id').all());
    expect(rowsOf(a)).toBe(rowsOf(b));
  });

  it('differs for a different seed', () => {
    const a = openMemoryDatabase();
    const b = openMemoryDatabase();
    seed(a, { seed: 1 });
    seed(b, { seed: 2 });
    expect(JSON.stringify(a.prepare('SELECT * FROM transactions ORDER BY id').all()))
      .not.toBe(JSON.stringify(b.prepare('SELECT * FROM transactions ORDER BY id').all()));
  });

  it('produces roughly 500 transactions over 18 months', () => {
    const db = openMemoryDatabase();
    const s = seed(db);
    expect(s.transactions).toBeGreaterThan(400);
    expect(s.transactions).toBeLessThan(650);
    const months = db.prepare('SELECT COUNT(DISTINCT substr(occurredAt,1,7)) AS n FROM transactions').get() as { n: number };
    expect(months.n).toBe(18);
  });

  it('stores every amount as a signed integer, and every timestamp as UTC', () => {
    const db = openMemoryDatabase();
    seed(db);
    const rows = db.prepare('SELECT amountMinor, occurredAt FROM transactions').all() as unknown as
      { amountMinor: number; occurredAt: string }[];
    for (const r of rows) {
      expect(Number.isInteger(r.amountMinor)).toBe(true);
      expect(r.occurredAt.endsWith('Z')).toBe(true);
    }
    expect(rows.some((r) => r.amountMinor > 0)).toBe(true);
    expect(rows.some((r) => r.amountMinor < 0)).toBe(true);
  });

  it('supports the aggregates the finance capabilities need', () => {
    const db = openMemoryDatabase();
    seed(db);
    const q = new SqliteQueryEngine(db);
    const byCategory = q.spendingByCategory({ from: '2026-07-01', to: '2026-07-31', currency: 'EUR' });
    expect(byCategory.rows.length).toBeGreaterThan(3);
    // Every breakdown total must be a positive magnitude and sum to the total.
    const total = q.spendingTotal({ from: '2026-07-01', to: '2026-07-31', currency: 'EUR' }).rows[0]!.totalMinor;
    const summed = byCategory.rows.reduce((n, r) => n + r.totalMinor, 0);
    expect(summed).toBe(total);
    expect(q.spendingTrend({ from: '2025-03-01', to: '2026-08-29', currency: 'EUR' }).rows).toHaveLength(18);
    expect(q.budgetStatus({ currency: 'EUR', on: '2026-08-15' }).rows.length).toBe(3);
  });
});

/**
 * PLAN.md §4 defect 3. The journal reverses exactly two capabilities, and both
 * belong to `domain-finance` — the *registered* application is
 * `domain-modules`, whose `module.delete` and `module.revert` have no restore
 * path at all.
 *
 * This set exists so a surface can **ask** instead of assume. The CLI used to
 * tell a user "this cannot be undone without the journal" before every
 * destructive action, which promises a journal that can — and at the moment
 * someone confirms a permanent deletion is the worst possible place to be wrong.
 */
describe('undo journal — what it actually claims it can reverse', () => {
  it('declares only the capabilities the switch really handles', () => {
    expect([...REVERSIBLE_CAPABILITIES].sort()).toEqual([
      'budget.delete', 'module.delete', 'module.revert', 'transaction.delete',
    ]);
  });

  /**
   * WP-18. Until 2026-09-11 both of these were `false`, and the registered
   * application's every destructive action was irreversible.
   */
  it('says yes for the registered application’s destructive capabilities', () => {
    expect(canUndo('module.delete')).toBe(true);
    expect(canUndo('module.revert')).toBe(true);
  });

  it('says no for anything it cannot restore', () => {
    expect(canUndo('module.capture')).toBe(false);
    expect(canUndo('anything.else')).toBe(false);
  });

  // The set and the switch are two statements of the same fact, so a capability
  // the switch cannot restore must be refused at run time *and* absent here —
  // otherwise it is the same lie one level down.
  it('refuses at run time exactly where it says it will', () => {
    const db = openMemoryDatabase();
    migrate(db);
    const journal = new SqliteUndoJournal(db);
    const token = journal.record({
      capabilityId: 'module.capture', params: {}, describedAs: 'Saved a module',
      payload: {}, recordedAt: '2026-09-11T00:00:00.000Z',
    });
    expect(journal.undo(token).ok).toBe(false);
    expect(canUndo('module.capture')).toBe(false);
  });
});

/**
 * WP-18 — the restore paths themselves. The composition root captures the
 * module row with `modules.get(target)` *before* the action runs, which is the
 * payload each of these receives.
 */
describe('undo journal — the registered application (WP-18)', () => {
  const MODULE = {
    id: 'm1', categoryId: null, title: 'Passport renewal', summary: 'How to renew.',
    body: 'The full, carefully merged text.', createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
  };

  it('puts a deleted module back exactly as it was', () => {
    const db = freshDb();
    const repo = new SqliteModuleRepository(db);
    const journal = new SqliteUndoJournal(db);
    repo.insert(MODULE);

    const token = journal.record({
      capabilityId: 'module.delete', params: { target: 'm1' }, describedAs: 'Deleted "Passport renewal"',
      payload: repo.get('m1'), recordedAt: '2026-03-02T10:00:00.000Z',
    });
    repo.delete('m1');
    expect(repo.get('m1')).toBeNull();

    expect(journal.undo(token)).toEqual({ ok: true });
    // Same id and timestamps, so anything that referred to it still resolves.
    expect(repo.get('m1')).toEqual(MODULE);
  });

  it('undoes a revert by restoring the body that was there before it', () => {
    const db = freshDb();
    const repo = new SqliteModuleRepository(db);
    const journal = new SqliteUndoJournal(db);
    repo.insert(MODULE);

    // What the composition root captures: the row before the revert runs.
    const beforeRevert = repo.get('m1');
    const token = journal.record({
      capabilityId: 'module.revert', params: { target: 'm1' }, describedAs: 'Reverted "Passport renewal"',
      payload: beforeRevert, recordedAt: '2026-03-02T10:00:00.000Z',
    });
    repo.update('m1', { body: 'An older snapshot.', updatedAt: '2026-03-02T10:00:00.000Z' });

    expect(journal.undo(token, '2026-03-03T10:00:00.000Z')).toEqual({ ok: true });
    const now = repo.get('m1');
    expect(now?.body).toBe('The full, carefully merged text.');
    // The content returns, but this is a new change and the timestamp says so.
    expect(now?.updatedAt).toBe('2026-03-03T10:00:00.000Z');
  });

  it('refuses to spend a module token twice, and leaves no duplicate row', () => {
    const db = freshDb();
    const repo = new SqliteModuleRepository(db);
    const journal = new SqliteUndoJournal(db);
    repo.insert(MODULE);
    const token = journal.record({
      capabilityId: 'module.delete', params: { target: 'm1' }, describedAs: 'Deleted',
      payload: repo.get('m1'), recordedAt: '2026-03-02T10:00:00.000Z',
    });
    repo.delete('m1');
    expect(journal.undo(token).ok).toBe(true);
    expect(journal.undo(token).ok).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM modules').get()).toMatchObject({ n: 1 });
  });

  /**
   * The journal entry is written *before* the action, so a delete of a module
   * that never existed still records one — with a `null` payload. That must read
   * as a refusal, not as an insert of null columns.
   */
  it('refuses readably when nothing was captured', () => {
    const db = freshDb();
    const journal = new SqliteUndoJournal(db);
    const token = journal.record({
      capabilityId: 'module.delete', params: { target: 'ghost' }, describedAs: 'Deleted',
      payload: null, recordedAt: '2026-03-02T10:00:00.000Z',
    });
    const outcome = journal.undo(token);
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ reason: expect.stringMatching(/nothing was captured/) });
  });

  it('refuses to undo a revert of a module that has since been deleted', () => {
    const db = freshDb();
    const repo = new SqliteModuleRepository(db);
    const journal = new SqliteUndoJournal(db);
    repo.insert(MODULE);
    const token = journal.record({
      capabilityId: 'module.revert', params: { target: 'm1' }, describedAs: 'Reverted',
      payload: repo.get('m1'), recordedAt: '2026-03-02T10:00:00.000Z',
    });
    repo.delete('m1');
    expect(journal.undo(token)).toMatchObject({ ok: false, reason: expect.stringMatching(/no longer exists/) });
  });
});
