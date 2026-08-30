import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRegistry } from '@nextgen/core-capability';
import {
  openMemoryDatabase,
  SqliteAccountRepository,
  SqliteBudgetRepository,
  SqliteCategoryRepository,
  SqliteQueryEngine,
  SqliteTransactionRepository,
} from '@nextgen/data';

import { boundary, capabilities, registry } from './capabilities.ts';
import { EventBus } from './events.ts';
import {
  createAccount,
  createTransaction,
  deleteBudget,
  deleteTransaction,
  setBudget,
  updateTransaction,
  watchBudgets,
  type UseCaseDeps,
} from './use-cases.ts';
import type {
  AccountRepository,
  BudgetRepository,
  CategoryRepository,
  Repositories,
  TransactionRepository,
} from './entities.ts';

// ------------------------------------------------------------ the ports fit --

/**
 * The port/adapter fit, asserted at compile time.
 *
 * TypeScript is structural, so `@nextgen/data`'s classes satisfy the domain's
 * ports without either package importing the other's version. That is worth more
 * than the usual arrangement: a port the adapter imports is a port the adapter
 * can quietly widen, and this one cannot drift without these lines failing.
 */
const _accounts: AccountRepository = new SqliteAccountRepository(openMemoryDatabase());
const _categories: CategoryRepository = new SqliteCategoryRepository(openMemoryDatabase());
const _transactions: TransactionRepository = new SqliteTransactionRepository(openMemoryDatabase());
const _budgets: BudgetRepository = new SqliteBudgetRepository(openMemoryDatabase());
void [_accounts, _categories, _transactions, _budgets];

// --------------------------------------------------------------- fixtures --

function setup() {
  const db = openMemoryDatabase();
  const repositories: Repositories = {
    accounts: new SqliteAccountRepository(db),
    categories: new SqliteCategoryRepository(db),
    transactions: new SqliteTransactionRepository(db),
    budgets: new SqliteBudgetRepository(db),
  };
  const events = new EventBus();
  let n = 0;
  const deps: UseCaseDeps = {
    repositories,
    events,
    now: () => new Date('2026-08-29T12:00:00.000Z'),
    newId: (p) => `${p}_${++n}`,
  };

  repositories.accounts.insert({
    id: 'acc1', name: 'Everyday', type: 'current', currency: 'EUR',
    openingMinor: 100000, createdAt: '2026-01-01T00:00:00.000Z',
  });
  repositories.categories.insert({ id: 'food', name: 'Food', parentId: null, icon: null, kind: 'expense' });
  repositories.categories.insert({ id: 'coffee', name: 'Coffee', parentId: 'food', icon: null, kind: 'expense' });
  repositories.categories.insert({ id: 'income', name: 'Income', parentId: null, icon: null, kind: 'income' });
  repositories.categories.insert({ id: 'salary', name: 'Salary', parentId: 'income', icon: null, kind: 'income' });

  return { db, deps, events, repositories };
}

// ------------------------------------------------------------- Rule 1 ------

describe('Rule 1 — no core-* package imports domain-finance', () => {
  /**
   * The architecture's central claim, checked mechanically rather than trusted.
   *
   * The real test of this project is how little code domain #2 requires. If any
   * `core-*` package reaches into the finance domain, that test is already
   * failed and nobody would notice until the second domain was attempted.
   */
  const repoRoot = join(import.meta.dirname, '..', '..', '..');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (entry.endsWith('.ts') || entry.endsWith('.js')) out.push(full);
    }
    return out;
  }

  const corePackages = readdirSync(join(repoRoot, 'packages')).filter((p) => p.startsWith('core-'));

  it('finds the core packages it is meant to be checking', () => {
    expect(corePackages.length).toBeGreaterThanOrEqual(5);
  });

  for (const pkg of corePackages) {
    it(`${pkg} does not import domain-finance`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(join(repoRoot, 'packages', pkg))) {
        const text = readFileSync(file, 'utf8');
        if (/domain-finance|domain_finance/.test(text)) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    });

    it(`${pkg} does not declare domain-finance as a dependency`, () => {
      // Some scaffold package.json files were written with a BOM.
      const raw = readFileSync(join(repoRoot, 'packages', pkg, 'package.json'), 'utf8').replace(/^﻿/, '');
      const pkgJson = JSON.parse(raw);
      const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      expect(Object.keys(deps)).not.toContain('@nextgen/domain-finance');
    });
  }
});

// -------------------------------------------------------- the registry ------

describe('capability registry', () => {
  it('validates', () => {
    const result = validateRegistry(registry);
    expect(result.errors).toEqual([]);
  });

  it('classifies every capability and gives each at least three examples', () => {
    for (const c of registry.capabilities) {
      expect(['navigate', 'read', 'write', 'destructive', 'unsupported']).toContain(c.kind);
      expect((c.examples ?? []).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives every executable capability a route — reachable without the AI (Rule 7)', () => {
    for (const c of capabilities) {
      expect(c.route, `${c.id} has no route`).toBeTruthy();
      expect(c.route!.startsWith('/')).toBe(true);
    }
  });

  it('gives every declared limit a refusal and no route', () => {
    for (const b of boundary) {
      expect(b.refusal, `${b.id} has no refusal`).toBeTruthy();
      expect(b.route).toBeNull();
    }
  });

  it('covers MVP-1 CRUD', () => {
    const ids = new Set(capabilities.map((c) => c.id));
    for (const id of [
      'transactions.list', 'transaction.create', 'transaction.update', 'transaction.delete',
      'budget.view', 'budget.set', 'budget.delete',
      'accounts.list', 'account.create', 'account.balance',
      'categories.list', 'spending.total', 'spending.by_category',
    ]) {
      expect(ids, `missing ${id}`).toContain(id);
    }
  });
});

// ------------------------------------------------------------- use cases ----

describe('createTransaction', () => {
  it('applies the sign from the category, not from the number', () => {
    // ADR-010 §2: the parser returns a magnitude; direction belongs here.
    const { deps } = setup();
    const spend = createTransaction(deps, { accountId: 'acc1', amountMinor: 4500, categoryId: 'coffee' });
    const earn = createTransaction(deps, { accountId: 'acc1', amountMinor: 285000, categoryId: 'salary' });
    expect(spend.ok && spend.value.amountMinor).toBe(-4500);
    expect(earn.ok && earn.value.amountMinor).toBe(285000);
  });

  it('ignores a sign the caller supplied — the magnitude is all it reads', () => {
    const { deps } = setup();
    const r = createTransaction(deps, { accountId: 'acc1', amountMinor: -4500, categoryId: 'coffee' });
    expect(r.ok && r.value.amountMinor).toBe(-4500);
    const s = createTransaction(deps, { accountId: 'acc1', amountMinor: -285000, categoryId: 'salary' });
    expect(s.ok && s.value.amountMinor).toBe(285000);
  });

  it('takes the currency from the account, never from the caller', () => {
    const { deps } = setup();
    const r = createTransaction(deps, { accountId: 'acc1', amountMinor: 100, categoryId: 'coffee' });
    expect(r.ok && r.value.currency).toBe('EUR');
  });

  it('refuses rather than throwing when the account does not exist', () => {
    const { deps } = setup();
    const r = createTransaction(deps, { accountId: 'nope', amountMinor: 100, categoryId: 'coffee' });
    expect(r).toMatchObject({ ok: false });
  });

  it('refuses a zero transaction and a fractional amount', () => {
    const { deps } = setup();
    expect(createTransaction(deps, { accountId: 'acc1', amountMinor: 0, categoryId: 'coffee' }).ok).toBe(false);
    expect(createTransaction(deps, { accountId: 'acc1', amountMinor: 12.5, categoryId: 'coffee' }).ok).toBe(false);
  });

  it('emits an event rather than updating anything else', () => {
    const { deps, events } = setup();
    createTransaction(deps, { accountId: 'acc1', amountMinor: 4500, categoryId: 'coffee' });
    expect(events.recorded.map((e) => e.type)).toEqual(['transaction.created']);
  });
});

describe('setBudget', () => {
  it('replaces rather than duplicating for the same category and period', () => {
    // Two budgets for one month is a state nothing downstream can interpret.
    const { deps, events } = setup();
    const first = setBudget(deps, {
      categoryId: 'food', limitMinor: 40000, periodStart: '2026-08-01', periodEnd: '2026-08-31', currency: 'EUR',
    });
    const second = setBudget(deps, {
      categoryId: 'food', limitMinor: 50000, periodStart: '2026-08-01', periodEnd: '2026-08-31', currency: 'EUR',
    });
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.value.limitMinor).toBe(50000);
    const setEvents = events.recorded.filter((e) => e.type === 'budget.set');
    expect(setEvents).toHaveLength(2);
    expect(setEvents[1]).toMatchObject({ replaced: { limitMinor: 40000 } });
  });

  it('refuses to budget an income category', () => {
    const { deps } = setup();
    const r = setBudget(deps, {
      categoryId: 'income', limitMinor: 40000, periodStart: '2026-08-01', periodEnd: '2026-08-31', currency: 'EUR',
    });
    expect(r).toMatchObject({ ok: false });
  });

  it('refuses a negative or zero limit', () => {
    const { deps } = setup();
    for (const limitMinor of [0, -100]) {
      expect(setBudget(deps, {
        categoryId: 'food', limitMinor, periodStart: '2026-08-01', periodEnd: '2026-08-31', currency: 'EUR',
      }).ok).toBe(false);
    }
  });

  it('refuses a period that ends before it starts', () => {
    const { deps } = setup();
    expect(setBudget(deps, {
      categoryId: 'food', limitMinor: 100, periodStart: '2026-08-31', periodEnd: '2026-08-01', currency: 'EUR',
    }).ok).toBe(false);
  });
});

describe('update and delete', () => {
  it('emits before and after on update', () => {
    const { deps, events } = setup();
    const created = createTransaction(deps, { accountId: 'acc1', amountMinor: 4500, categoryId: 'coffee' });
    events.clear();
    const updated = updateTransaction(deps, created.ok ? created.value.id : '', { amountMinor: -5000 });
    expect(updated.ok).toBe(true);
    expect(events.recorded[0]).toMatchObject({
      type: 'transaction.updated',
      before: { amountMinor: -4500 },
      after: { amountMinor: -5000 },
    });
  });

  it('returns the deleted row so undo has something to restore', () => {
    const { deps } = setup();
    const created = createTransaction(deps, { accountId: 'acc1', amountMinor: 4500, categoryId: 'coffee' });
    const id = created.ok ? created.value.id : '';
    expect(deleteTransaction(deps, id)).toMatchObject({ ok: true, value: { id } });
    expect(deleteTransaction(deps, id).ok).toBe(false);
  });

  it('refuses to delete a budget that is not there', () => {
    const { deps } = setup();
    expect(deleteBudget(deps, 'bud_nope').ok).toBe(false);
  });
});

describe('createAccount', () => {
  it('creates one and refuses a blank name', () => {
    const { deps } = setup();
    expect(createAccount(deps, { name: 'Savings', type: 'savings', currency: 'EUR' }).ok).toBe(true);
    expect(createAccount(deps, { name: '   ', type: 'savings', currency: 'EUR' }).ok).toBe(false);
  });
});

// ----------------------------------------------------- events, not welding --

describe('budget watching is a subscriber, not a call from createTransaction', () => {
  it('raises budget.exceeded without createTransaction knowing budgets exist', () => {
    const { db, deps, events, repositories } = setup();
    setBudget(deps, {
      categoryId: 'food', limitMinor: 5000, periodStart: '2026-08-01', periodEnd: '2026-08-31', currency: 'EUR',
    });
    const query = new SqliteQueryEngine(db);
    watchBudgets(
      events,
      (categoryId, from, to, currency) =>
        query.spendingInCategory({ categoryId, from, to, currency }).rows[0]!.totalMinor,
      (categoryId) => {
        const b = repositories.budgets.get(`bud_${categoryId}_2026-08-01`);
        // "coffee" rolls up to "food", so a coffee spend counts against it.
        const parent = repositories.categories.get(categoryId)?.parentId;
        const p = parent ? repositories.budgets.get(`bud_${parent}_2026-08-01`) : null;
        return [b, p].filter((x): x is NonNullable<typeof x> => x !== null && x !== undefined);
      },
    );

    events.clear();
    createTransaction(deps, {
      accountId: 'acc1', amountMinor: 9000, categoryId: 'coffee',
      occurredAt: '2026-08-15T10:00:00.000Z',
    });

    expect(events.recorded.map((e) => e.type)).toEqual(['transaction.created', 'budget.exceeded']);
    expect(events.recorded[1]).toMatchObject({ spentMinor: 9000, limitMinor: 5000 });
  });

  it('does not let a throwing subscriber unmake what already happened', () => {
    const { deps, events, repositories } = setup();
    events.subscribe(() => {
      throw new Error('a listener blew up');
    });
    const r = createTransaction(deps, { accountId: 'acc1', amountMinor: 4500, categoryId: 'coffee' });
    expect(r.ok).toBe(true);
    expect(repositories.transactions.get(r.ok ? r.value.id : '')).not.toBeNull();
  });
});
