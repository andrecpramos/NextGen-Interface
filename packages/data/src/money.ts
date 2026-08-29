/**
 * Money (ADR-010).
 *
 * Signed integer minor units, currency bound to the amount, no floats anywhere.
 * Negative is money leaving the account; positive is money arriving.
 *
 * There is no conversion in this file and there must never be one. Converting
 * needs a rate; a rate has a date and a source; a wrong rate silently corrupts
 * every historical aggregate that touched it.
 */

export type CurrencyCode = 'EUR' | 'USD' | 'GBP';

const MINOR_UNITS: Readonly<Record<CurrencyCode, number>> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
};

export interface Money {
  /** Signed. Negative = outflow. Always an integer. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export function isCurrencyCode(code: string): code is CurrencyCode {
  return code in MINOR_UNITS;
}

/**
 * The invariant, as a function. Called on every write path.
 *
 * Rule 6 is "money is integer minor units, never float, not once". A float that
 * reaches storage does not announce itself — it shows up months later as a
 * balance that is off by a cent and a reconciliation nobody can explain.
 */
export function assertMinorUnits(amountMinor: number, context = 'amount'): void {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      `${context} must be integer minor units, got ${amountMinor}. ` +
        'Money is never a float (ADR-007, ADR-010).',
    );
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`${context} ${amountMinor} exceeds the safe integer range`);
  }
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertMinorUnits(amountMinor);
  return { amountMinor, currency };
}

/**
 * Parse a major-unit decimal into minor units, rounding half-up.
 *
 * Half-up because it is what users expect; the alternative (banker's rounding)
 * is defensible but surprising on a personal-finance screen. Stated here because
 * WP-02 found the router silently *truncating* the third decimal, which was an
 * artefact of a capture regex rather than a decision anyone made.
 */
export function fromMajorUnits(major: number | string, currency: CurrencyCode): Money {
  const decimals = MINOR_UNITS[currency];

  // Parse the DECIMAL DIGITS, never `value * 100`.
  //
  // 1.005 * 100 is 100.49999999999999, so Math.round gives 100 — the amount is a
  // cent short and nothing announces it. Adding Number.EPSILON does not help:
  // EPSILON is relative to 1 and the error here is at the scale of 100.
  //
  // **Pass a string wherever the exact value matters.** A string is parsed
  // digit by digit and is exact. A number has already been through binary
  // floating point before this function sees it: the literal `1.005` *is*
  // 1.00499999999999989, so rounding it to 1.00 is correct for the value that
  // actually arrived — the cent was lost at the call site, not here.
  const text = typeof major === 'string' ? major.trim() : null;

  if (text !== null && /^[+-]?\d*\.?\d*$/.test(text) && /\d/.test(text)) {
    const negative = text.startsWith('-');
    const unsigned = text.replace(/^[+-]/, '');
    const [whole = '0', fraction = ''] = unsigned.split('.');

    const kept = fraction.slice(0, decimals).padEnd(decimals, '0');
    const nextDigit = fraction.charCodeAt(decimals) - 48; // NaN when absent
    // Half-up on the magnitude, so -0.005 and 0.005 move the same distance from
    // zero rather than in the same direction.
    const carry = nextDigit >= 5 ? 1 : 0;

    const magnitude = Number(whole || '0') * 10 ** decimals + Number(kept || '0') + carry;
    const signedValue = negative ? -magnitude : magnitude;
    return money(signedValue === 0 ? 0 : signedValue, currency);
  }

  const n = typeof major === 'number' ? major : Number(major);
  if (!Number.isFinite(n)) throw new TypeError(`cannot parse "${major}" as an amount`);
  // toFixed rounds the true stored value correctly; that value may already have
  // drifted, which is exactly why the string path above exists.
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole = '0', fraction = ''] = fixed.split('.');
  const magnitude = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0');
  const signedValue = negative ? -magnitude : magnitude;
  return money(signedValue === 0 ? 0 : signedValue, currency);
}

/** Format for display. Never used to compute anything. */
export function formatMoney(m: Money, locale = 'en-IE'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency })
    .format(m.amountMinor / 10 ** MINOR_UNITS[m.currency]);
}

export class CurrencyMismatchError extends Error {
  readonly expected: CurrencyCode;
  readonly actual: string;

  constructor(expected: CurrencyCode, actual: string, context: string) {
    super(`${context}: expected ${expected}, got ${actual}. This system never converts (ADR-010).`);
    this.name = 'CurrencyMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Add amounts that are known to share a currency.
 *
 * Refuses rather than converting. A mixed-currency sum is not a number, and
 * returning one anyway is how a multi-currency account set produces a
 * confidently wrong net worth.
 */
export function addMoney(...amounts: readonly Money[]): Money {
  if (amounts.length === 0) throw new TypeError('addMoney needs at least one amount');
  const currency = amounts[0]!.currency;
  let total = 0;
  for (const a of amounts) {
    if (a.currency !== currency) {
      throw new CurrencyMismatchError(currency, a.currency, 'cannot add mixed currencies');
    }
    total += a.amountMinor;
  }
  return money(total, currency);
}

/** Direction, for the domain to apply. The parser never decides this (ADR-010 §2). */
export type Direction = 'outflow' | 'inflow';

/**
 * Apply a direction to an unsigned magnitude.
 *
 * `resolveMoney` in the router returns a magnitude on purpose: "twenty euros"
 * and "minus twenty euros" both mean the quantity 20, and which way it moves is
 * a property of the capability that received it, not of the sentence.
 */
export function signed(magnitudeMinor: number, direction: Direction, currency: CurrencyCode): Money {
  assertMinorUnits(magnitudeMinor);
  const magnitude = Math.abs(magnitudeMinor);
  return money(direction === 'outflow' ? -magnitude : magnitude, currency);
}
