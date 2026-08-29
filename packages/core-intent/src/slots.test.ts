import { describe, expect, it } from 'vitest';

import { buildEnumIndex, resolveDateRange, resolveEnum, resolveMoney, resolveSlots } from './slots.ts';
import {
  deterministicParams,
  isCapabilityKind,
  mergeParams,
  modelParams,
  type Capability,
  type ScreenContext,
} from './types.ts';

/**
 * Unit tests for the deterministic resolvers.
 *
 * These were the only part of the engine with no isolated coverage: the golden
 * set exercises them, but only through the whole cascade and only on the inputs
 * that happen to appear in 200 utterances. Everything below that is marked
 * DECISION OWED is real measured behaviour that nobody has chosen yet — the
 * test pins it so it cannot change silently, not because it is right.
 */

const ctx = (today: string): ScreenContext => ({ route: '/', today });

// ------------------------------------------------------------------- dates --

describe('resolveDateRange — month boundaries', () => {
  it('crosses the year boundary going back from January', () => {
    expect(resolveDateRange('last month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('clamps to the short month, not to the same day number', () => {
    // The bug this guards: naive month arithmetic from the 31st lands on
    // 2026-03-03. A spending report for "last month" that includes March is
    // wrong in a way the user will not notice.
    expect(resolveDateRange('last month', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('returns the whole current month even when asked on its last day', () => {
    expect(resolveDateRange('this month', '2026-01-31')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('resolves a bare month name to its most recent occurrence', () => {
    // October is in the future relative to August, so it means last October.
    expect(resolveDateRange('in october', '2026-08-29')).toEqual({
      from: '2025-10-01',
      to: '2025-10-31',
    });
    expect(resolveDateRange('in march', '2026-08-29')).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
    });
  });
});

describe('resolveDateRange — leap years', () => {
  it('ends February on the 29th in a leap year', () => {
    expect(resolveDateRange('this month', '2024-02-10')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });

  it('ends February on the 28th in a common year', () => {
    expect(resolveDateRange('this month', '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('spans a full leap year for "last year"', () => {
    expect(resolveDateRange('last year', '2025-06-01')).toEqual({
      from: '2024-01-01',
      to: '2024-12-31',
    });
  });

  it('handles the leap day itself as "today"', () => {
    expect(resolveDateRange('today', '2024-02-29')).toEqual({
      from: '2024-02-29',
      to: '2024-02-29',
    });
    expect(resolveDateRange('yesterday', '2024-03-01')).toEqual({
      from: '2024-02-29',
      to: '2024-02-29',
    });
  });
});

describe('resolveDateRange — DST transitions', () => {
  /**
   * Every date path goes through Date.UTC deliberately. With local-time
   * arithmetic, a day that is 23 or 25 hours long shifts the result by one day
   * roughly twice a year — and a date range that is silently one day short is
   * not a bug anyone reports as a routing failure. These pin the UTC choice.
   */
  it('is unaffected by the spring-forward transition', () => {
    // 2026-03-29: EU clocks go forward. 2026-03-08: US clocks go forward.
    expect(resolveDateRange('yesterday', '2026-03-29')).toEqual({
      from: '2026-03-28',
      to: '2026-03-28',
    });
    expect(resolveDateRange('yesterday', '2026-03-08')).toEqual({
      from: '2026-03-07',
      to: '2026-03-07',
    });
  });

  it('is unaffected by the autumn fall-back transition', () => {
    // 2026-10-25: EU clocks go back. 2026-11-01: US clocks go back.
    expect(resolveDateRange('yesterday', '2026-10-25')).toEqual({
      from: '2026-10-24',
      to: '2026-10-24',
    });
    expect(resolveDateRange('yesterday', '2026-11-01')).toEqual({
      from: '2026-10-31',
      to: '2026-10-31',
    });
  });

  it('keeps a 7-day window exactly 7 days across a transition', () => {
    const r = resolveDateRange('last 7 days', '2026-03-29')!;
    expect(r).toEqual({ from: '2026-03-23', to: '2026-03-29' });
    const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;
    expect(days).toBe(7);
  });

  it('starts ISO weeks on Monday across a transition', () => {
    // 2026-03-29 is a Sunday; its ISO week began Monday 2026-03-23.
    expect(resolveDateRange('this week', '2026-03-29')).toEqual({
      from: '2026-03-23',
      to: '2026-03-29',
    });
  });
});

describe('resolveDateRange — no match', () => {
  it('returns null rather than guessing', () => {
    expect(resolveDateRange('how much did I spend on food', '2026-08-29')).toBeNull();
    expect(resolveDateRange('', '2026-08-29')).toBeNull();
  });
});

// ------------------------------------------------------------------- money --

describe('resolveMoney — number words', () => {
  // Speech-to-text emits these constantly; digits are the exception, not the rule.
  it('parses simple number words', () => {
    expect(resolveMoney('twelve euros')).toEqual({ amountMinor: 1200, currency: 'EUR' });
  });

  it('sums compound tens and units', () => {
    expect(resolveMoney('twenty five')).toEqual({ amountMinor: 2500, currency: null });
  });

  it('multiplies for hundreds and thousands', () => {
    expect(resolveMoney('one hundred dollars')).toEqual({ amountMinor: 10_000, currency: 'USD' });
    expect(resolveMoney('two thousand')).toEqual({ amountMinor: 200_000, currency: null });
  });

  it('handles "a hundred and fifty" without a leading digit word', () => {
    expect(resolveMoney('a hundred and fifty euros')).toEqual({
      amountMinor: 15_000,
      currency: 'EUR',
    });
  });

  it('prefers digits over number words when both are present', () => {
    // "add 20 for the two coffees" must be 20, not 22.
    expect(resolveMoney('add 20 for the two coffees')).toEqual({
      amountMinor: 2000,
      currency: null,
    });
  });
});

describe('resolveMoney — integer minor units', () => {
  // Rule 6: money is integer minor units. A float here is a defect, not a style.
  it('never returns a fractional minor unit', () => {
    for (const t of ['0.1', '12.50', '19.99', '1,200', '45', 'twelve euros']) {
      const m = resolveMoney(t)!;
      expect(Number.isInteger(m.amountMinor)).toBe(true);
    }
  });

  it('parses decimals and thousands separators', () => {
    expect(resolveMoney('12.50')?.amountMinor).toBe(1250);
    expect(resolveMoney('0.1')?.amountMinor).toBe(10);
    expect(resolveMoney('1,200')?.amountMinor).toBe(120_000);
  });

  it('truncates beyond two decimals rather than rounding — DECISION OWED', () => {
    // 12.345 becomes 1234, not 1235: the regex only captures two decimal
    // places, so the third digit is discarded before any rounding happens.
    // Sub-cent input is not meaningful for this domain, but "truncate" and
    // "round" are different answers and nobody has picked one.
    expect(resolveMoney('12.345')?.amountMinor).toBe(1234);
  });

  it('returns null when there is no amount at all', () => {
    expect(resolveMoney('show my spending on food')).toBeNull();
  });
});

describe('resolveMoney — currency', () => {
  it('reads symbols and words', () => {
    expect(resolveMoney('50 euros')?.currency).toBe('EUR');
    expect(resolveMoney('spend 20 dollars')?.currency).toBe('USD');
    expect(resolveMoney('£30')?.currency).toBe('GBP');
  });

  it('returns null currency when none is named, rather than assuming one', () => {
    // Correct: the account's currency is not this function's business, and
    // guessing it is how you book a EUR expense against a GBP account.
    expect(resolveMoney('45')).toEqual({ amountMinor: 4500, currency: null });
  });

  it('silently picks the first currency when two are named — DECISION OWED', () => {
    // "convert 50 euros to dollars" yields EUR because EUR is tested first.
    // The utterance is genuinely ambiguous about which currency the 50 is in,
    // and the resolver resolves it by declaration order with no signal to the
    // caller. A currency mismatch should probably force a Clarify; that is a
    // domain decision (WP-04 / WP-07), not one for a domain-agnostic router.
    expect(resolveMoney('convert 50 euros to dollars')).toEqual({
      amountMinor: 5000,
      currency: 'EUR',
    });
  });
});

describe('resolveMoney — negative amounts', () => {
  /**
   * DECISION OWED, and the sharpest of the three.
   *
   * The sign is discarded silently: the digit regex never captures a leading
   * minus, and "minus" is not a number word. Every one of these returns a
   * POSITIVE amount.
   *
   * Whether that is wrong depends on a decision nobody has made. In this
   * registry the sign is carried by the category (income vs expense), not by
   * the amount, so a positive magnitude may well be correct. What is not
   * defensible is doing it silently on a financial write path — "-50" and "50"
   * must not be indistinguishable to the caller.
   *
   * Owed by WP-04 (which defines the money column) and WP-07 (which defines
   * what a transaction amount means). Pinned here so the behaviour cannot drift
   * before then.
   */
  it('drops a leading minus sign', () => {
    expect(resolveMoney('-50')).toEqual({ amountMinor: 5000, currency: null });
  });

  it('ignores the word "minus"', () => {
    expect(resolveMoney('minus 50 euros')).toEqual({ amountMinor: 5000, currency: 'EUR' });
  });

  it('does not distinguish a refund from a charge', () => {
    expect(resolveMoney('a refund of -20')?.amountMinor).toBe(2000);
    expect(resolveMoney('a charge of 20')?.amountMinor).toBe(2000);
  });
});

// ------------------------------------------------------------------- enums --

describe('buildEnumIndex / resolveEnum', () => {
  const categories = buildEnumIndex({
    tree: {
      food: ['groceries', 'restaurants', 'coffee'],
      transport: ['fuel', 'public_transport', 'taxi'],
    },
    aliases: { groceries: ['supermarket', 'grocery shopping'], food: ['eating out'] },
  });

  it('indexes parents and children, and records the roll-up', () => {
    expect(resolveEnum('spending on groceries', categories)).toBe('groceries');
    expect(categories.rollup.get('groceries')).toBe('food');
    expect(categories.rollup.get('food')).toBeUndefined();
  });

  it('resolves aliases to the canonical value', () => {
    expect(resolveEnum('what did I spend at the supermarket', categories)).toBe('groceries');
    expect(resolveEnum('how much on eating out', categories)).toBe('food');
  });

  it('matches an underscored canonical in its spoken, spaced form', () => {
    expect(resolveEnum('how much on public transport', categories)).toBe('public_transport');
  });

  it('prefers the longest surface form', () => {
    // "public transport" must beat the bare "transport", or the roll-up is wrong.
    expect(resolveEnum('public transport costs', categories)).toBe('public_transport');
  });

  it('matches whole words only', () => {
    // "foodie" must not match "food" — substring matching here would route a
    // restaurant review to a spending query.
    expect(resolveEnum('foodie recommendations', categories)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(resolveEnum('show me everything', categories)).toBeNull();
  });
});

// ------------------------------------------------------------------- slots --

describe('resolveSlots', () => {
  const spendingByCategory: Capability = {
    id: 'spending.by_category',
    kind: 'read',
    route: '/spending',
    title: 'Spending by category',
    description: 'Break spending down by category over a period',
    params: {
      category: { type: 'enum:Category', required: true },
      from: { type: 'date', required: true },
      to: { type: 'date', required: true },
    },
  };

  const enums = {
    Category: buildEnumIndex({ tree: { food: ['groceries', 'coffee'] } }),
  };

  it('fills date and enum slots from one utterance', () => {
    const { params, missing } = resolveSlots(
      spendingByCategory,
      'how much did I spend on food last month',
      ctx('2026-08-29'),
      enums,
    );
    expect(params.values).toEqual({ category: 'food', from: '2026-07-01', to: '2026-07-31' });
    expect(missing).toEqual([]);
  });

  it('reports required slots it could not fill', () => {
    const { params, missing } = resolveSlots(
      spendingByCategory,
      'how much did I spend on food',
      ctx('2026-08-29'),
      enums,
    );
    expect(params.values).toEqual({ category: 'food' });
    // This is the escalation signal: unfilled required slots are what stage 3 is for.
    expect([...missing].sort()).toEqual(['from', 'to']);
  });

  it('leaves a free-text param unresolved — no resolver can invent it', () => {
    const search: Capability = {
      id: 'search.transactions',
      kind: 'read',
      route: '/search',
      title: 'Search',
      description: 'Search transactions',
      params: { query: { type: 'string', required: true } },
    };
    const { params, missing } = resolveSlots(search, 'find my coffee spend', ctx('2026-08-29'), enums);
    expect(params.values).toEqual({});
    expect(missing).toEqual(['query']);
  });

  it('does not report optional params as missing', () => {
    const optional: Capability = {
      id: 'x',
      kind: 'read',
      route: '/x',
      title: 'X',
      description: 'X',
      params: { from: { type: 'date' } },
    };
    expect(resolveSlots(optional, 'show me x', ctx('2026-08-29'), enums).missing).toEqual([]);
  });
});

// ------------------------------------------------------ rules, as functions --

describe('Rule 11 — deterministic params always win', () => {
  it('lets the deterministic value overwrite the model value', () => {
    // The real regression: asked for "last month" the model answered with 30
    // days back and, with the spread the wrong way round, overwrote the correct
    // calendar month. That cost 44 points of param exactness (FINDINGS 3).
    const fromModel = modelParams({ from: '2026-07-29', to: '2026-08-29', note: 'model' });
    const fromCode = deterministicParams({ from: '2026-07-01', to: '2026-07-31' });

    expect(mergeParams(fromModel, fromCode).values).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
      note: 'model',
    });
  });

  it('keeps model params for slots no resolver could fill', () => {
    const merged = mergeParams(modelParams({ query: 'coffee' }), deterministicParams({}));
    expect(merged.values).toEqual({ query: 'coffee' });
  });

  // The other direction is not tested at runtime because it cannot be written:
  // mergeParams(deterministic, model) is a compile error. That is the point of
  // the branded types — the rule is enforced by tsc, not by this file.
});

describe('Rule 5 — unclassified kinds fail closed', () => {
  it('accepts exactly the four kinds in the ADR-004 policy table', () => {
    expect(['navigate', 'read', 'write', 'destructive'].every(isCapabilityKind)).toBe(true);
  });

  it('rejects anything else, including plausible near-misses', () => {
    for (const k of ['', 'Read', 'READ', 'query', 'delete', 'admin', 'unknown']) {
      expect(isCapabilityKind(k)).toBe(false);
    }
  });
});
