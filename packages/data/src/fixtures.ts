import type { DatabaseSync } from 'node:sqlite';
import {
  SqliteAccountRepository,
  SqliteBudgetRepository,
  SqliteCategoryRepository,
  SqliteTransactionRepository,
  type CategoryRecord,
} from './repositories.ts';
import type { CurrencyCode } from './money.ts';

/**
 * Seeded synthetic fixtures.
 *
 * ~500 transactions over 18 months from a **fixed seed**, so every run produces
 * byte-identical data. A fixture set that changes between runs turns an
 * aggregate assertion into a flake, and a flaky financial test gets deleted
 * rather than fixed.
 *
 * **No real financial data, including the author's own.** Everything below is
 * generated from the PRNG; the merchant names are invented.
 */

/** mulberry32 — small, fast, and identical everywhere. Not cryptographic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CATEGORY_TREE: readonly CategoryRecord[] = [
  { id: 'food', name: 'Food', parentId: null, icon: null, kind: 'expense' },
  { id: 'groceries', name: 'Groceries', parentId: 'food', icon: null, kind: 'expense' },
  { id: 'restaurants', name: 'Restaurants', parentId: 'food', icon: null, kind: 'expense' },
  { id: 'coffee', name: 'Coffee', parentId: 'food', icon: null, kind: 'expense' },
  { id: 'takeaway', name: 'Takeaway', parentId: 'food', icon: null, kind: 'expense' },

  { id: 'transport', name: 'Transport', parentId: null, icon: null, kind: 'expense' },
  { id: 'fuel', name: 'Fuel', parentId: 'transport', icon: null, kind: 'expense' },
  { id: 'public_transport', name: 'Public transport', parentId: 'transport', icon: null, kind: 'expense' },
  { id: 'taxi', name: 'Taxi', parentId: 'transport', icon: null, kind: 'expense' },
  { id: 'parking', name: 'Parking', parentId: 'transport', icon: null, kind: 'expense' },

  { id: 'housing', name: 'Housing', parentId: null, icon: null, kind: 'expense' },
  { id: 'rent', name: 'Rent', parentId: 'housing', icon: null, kind: 'expense' },
  { id: 'utilities', name: 'Utilities', parentId: 'housing', icon: null, kind: 'expense' },
  { id: 'internet', name: 'Internet', parentId: 'housing', icon: null, kind: 'expense' },

  { id: 'entertainment', name: 'Entertainment', parentId: null, icon: null, kind: 'expense' },
  { id: 'streaming', name: 'Streaming', parentId: 'entertainment', icon: null, kind: 'expense' },
  { id: 'games', name: 'Games', parentId: 'entertainment', icon: null, kind: 'expense' },

  { id: 'health', name: 'Health', parentId: null, icon: null, kind: 'expense' },
  { id: 'pharmacy', name: 'Pharmacy', parentId: 'health', icon: null, kind: 'expense' },
  { id: 'gym', name: 'Gym', parentId: 'health', icon: null, kind: 'expense' },

  { id: 'shopping', name: 'Shopping', parentId: null, icon: null, kind: 'expense' },
  { id: 'clothes', name: 'Clothes', parentId: 'shopping', icon: null, kind: 'expense' },
  { id: 'electronics', name: 'Electronics', parentId: 'shopping', icon: null, kind: 'expense' },

  { id: 'income', name: 'Income', parentId: null, icon: null, kind: 'income' },
  { id: 'salary', name: 'Salary', parentId: 'income', icon: null, kind: 'income' },
  { id: 'freelance', name: 'Freelance', parentId: 'income', icon: null, kind: 'income' },
  { id: 'refund', name: 'Refund', parentId: 'income', icon: null, kind: 'income' },
];

/** Leaf spend profiles: [category, minMinor, maxMinor, relative frequency]. */
const SPEND_PROFILE: readonly [string, number, number, number][] = [
  ['groceries', 1200, 9500, 22],
  ['restaurants', 1800, 7500, 10],
  ['coffee', 250, 650, 26],
  ['takeaway', 1100, 3400, 8],
  ['fuel', 3500, 8000, 6],
  ['public_transport', 200, 3000, 14],
  ['taxi', 700, 2600, 4],
  ['parking', 150, 900, 5],
  ['utilities', 4000, 12000, 3],
  ['internet', 3500, 3500, 2],
  ['streaming', 799, 1699, 4],
  ['games', 999, 5999, 2],
  ['pharmacy', 500, 4500, 4],
  ['gym', 2500, 4500, 2],
  ['clothes', 1500, 12000, 4],
  ['electronics', 2000, 45000, 1],
];

const MERCHANTS: Readonly<Record<string, readonly string[]>> = {
  groceries: ['Mercado Central', 'FreshCo', 'Corner Store'],
  restaurants: ['Trattoria Nove', 'The Blue Door', 'Casa Marisol'],
  coffee: ['Café Aurora', 'Bean & Bar', 'Morning Roast'],
  takeaway: ['Noodle Express', 'Pizza Rossa'],
  fuel: ['Via Fuel', 'Northgate Petrol'],
  public_transport: ['City Transit', 'Metro Card'],
  taxi: ['CityCab', 'RideNow'],
  parking: ['Central Parking'],
  utilities: ['Lumen Energy', 'AquaCity'],
  internet: ['Fibrenet'],
  streaming: ['Streamly', 'Cinemax Go'],
  games: ['PlayHub'],
  pharmacy: ['Farmácia Sol'],
  gym: ['Ironworks Gym'],
  clothes: ['Northline Apparel', 'Vestir'],
  electronics: ['TechPoint'],
};

export interface SeedOptions {
  readonly seed?: number;
  readonly currency?: CurrencyCode;
  /** Last day covered. Fixed by default so fixtures do not drift with the clock. */
  readonly endDate?: string;
  readonly months?: number;
}

export interface SeedSummary {
  readonly accounts: number;
  readonly categories: number;
  readonly transactions: number;
  readonly budgets: number;
  readonly currency: CurrencyCode;
  readonly from: string;
  readonly to: string;
}

/**
 * Populate a migrated database.
 *
 * `endDate` defaults to a constant rather than today, because a fixture set
 * anchored to the clock produces tests that pass in August and fail in
 * September.
 */
export function seed(db: DatabaseSync, options: SeedOptions = {}): SeedSummary {
  const seedValue = options.seed ?? 20260829;
  const currency: CurrencyCode = options.currency ?? 'EUR';
  const endDate = options.endDate ?? '2026-08-29';
  const months = options.months ?? 18;
  const rand = mulberry32(seedValue);

  const accounts = new SqliteAccountRepository(db);
  const categories = new SqliteCategoryRepository(db);
  const transactions = new SqliteTransactionRepository(db);
  const budgets = new SqliteBudgetRepository(db);

  const createdAt = `${endDate}T00:00:00.000Z`;

  accounts.insert({
    id: 'acc_current', name: 'Everyday', type: 'current',
    currency, openingMinor: 250000, createdAt,
  });
  accounts.insert({
    id: 'acc_savings', name: 'Savings', type: 'savings',
    currency, openingMinor: 1200000, createdAt,
  });

  // Parents first — the FK is self-referential.
  for (const c of CATEGORY_TREE.filter((c) => c.parentId === null)) categories.insert(c);
  for (const c of CATEGORY_TREE.filter((c) => c.parentId !== null)) categories.insert(c);

  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  const startIso = start.toISOString().slice(0, 10);

  // Weighted pick table, built once.
  const bag: string[] = [];
  for (const [cat, , , freq] of SPEND_PROFILE) for (let i = 0; i < freq; i++) bag.push(cat);
  const profileOf = new Map(SPEND_PROFILE.map((p) => [p[0], p]));

  let n = 0;
  const pad = (x: number) => String(x).padStart(2, '0');

  // Monthly fixed costs, then a variable tail. Real spending has both, and an
  // all-random fixture makes budget assertions meaningless.
  for (let m = 0; m < months; m++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const iso = (day: number, hour: number) =>
      `${y}-${pad(mo + 1)}-${pad(Math.min(day, daysInMonth))}T${pad(hour)}:00:00.000Z`;

    const push = (
      categoryId: string, amountMinor: number, day: number, hour: number,
      merchant: string | null, accountId = 'acc_current',
    ) => {
      const occurredAt = iso(day, hour);
      if (occurredAt.slice(0, 10) > endDate) return;
      transactions.insert({
        id: `tx_${String(++n).padStart(4, '0')}`,
        accountId, categoryId, amountMinor, currency, occurredAt,
        memo: null, merchant, createdAt: occurredAt,
      });
    };

    // Income — positive, because it arrives (ADR-010).
    push('salary', 285000, 25, 9, 'Payroll');
    if (rand() < 0.35) push('freelance', 40000 + Math.floor(rand() * 120000), 12, 15, 'Client invoice');
    if (rand() < 0.15) push('refund', 1500 + Math.floor(rand() * 8000), 18, 11, 'Returns desk');

    // Fixed outflows — negative.
    push('rent', -95000, 1, 8, 'Landlord');
    push('internet', -3500, 3, 8, 'Fibrenet');
    push('streaming', -1299, 5, 8, 'Streamly');
    push('gym', -3500, 6, 8, 'Ironworks Gym');
    push('utilities', -(4000 + Math.floor(rand() * 6000)), 9, 8, 'Lumen Energy');

    // Variable outflows.
    const count = 16 + Math.floor(rand() * 8);
    for (let i = 0; i < count; i++) {
      const categoryId = bag[Math.floor(rand() * bag.length)]!;
      const [, min, max] = profileOf.get(categoryId)!;
      const amount = min + Math.floor(rand() * (max - min + 1));
      const merchants = MERCHANTS[categoryId] ?? ['Unknown'];
      push(
        categoryId,
        -amount,
        1 + Math.floor(rand() * daysInMonth),
        7 + Math.floor(rand() * 14),
        merchants[Math.floor(rand() * merchants.length)]!,
      );
    }
  }

  const budgetMonthStart = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-01`;
  const budgetMonthEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
  const budgetDefs: readonly [string, string, number][] = [
    ['bud_food', 'food', 45000],
    ['bud_transport', 'transport', 15000],
    ['bud_entertainment', 'entertainment', 8000],
  ];
  for (const [id, categoryId, limitMinor] of budgetDefs) {
    budgets.insert({ id, categoryId, periodStart: budgetMonthStart, periodEnd: budgetMonthEnd, limitMinor, currency });
  }

  return {
    accounts: 2,
    categories: CATEGORY_TREE.length,
    transactions: n,
    budgets: budgetDefs.length,
    currency,
    from: startIso,
    to: endDate,
  };
}
