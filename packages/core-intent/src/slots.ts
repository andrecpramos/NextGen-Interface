import { normalize } from './text.ts';
import {
  deterministicParams,
  type Capability,
  type DeterministicParams,
  type EnumDefinition,
  type EnumIndex,
  type ScreenContext,
  type SlotValue,
} from './types.ts';

/**
 * Deterministic slot resolution — dates, money, enums.
 *
 * This file is why the cascade works. Every slot resolved here is a slot the
 * model does not have to extract, and slot extraction is what small models are
 * worst at. "last month" is a solved problem in 30 lines of date arithmetic;
 * asking a 1B model to compute it is asking for a wrong date range on a
 * financial report.
 *
 * Rule from coding-standards.md: money is integer minor units. Never float.
 */

const MONTHS: Readonly<Record<string, number>> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9,
  november: 10, nov: 10, december: 11, dec: 11,
};

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface Money {
  /** Integer minor units. Never a float, never a formatted string. */
  readonly amountMinor: number;
  readonly currency: string | null;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, day: number): Date => new Date(Date.UTC(y, m, day));

function monthRange(y: number, m: number): DateRange {
  return { from: iso(utc(y, m, 1)), to: iso(utc(y, m + 1, 0)) };
}

/** ISO weeks: Monday start. */
function weekRange(base: Date, offsetWeeks = 0): DateRange {
  const d = new Date(base.getTime());
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow + offsetWeeks * 7);
  const sunday = utc(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

/**
 * Resolve a date expression against a reference "today".
 * Returns { from, to } as ISO dates, or null if nothing matched.
 *
 * Every arithmetic path goes through Date.UTC. That is not a style choice: a
 * local-time Date around a DST boundary can shift a month range by a day, and
 * a financial report that silently loses 31 October is a defect nobody reports
 * as a routing bug.
 */
export function resolveDateRange(text: string, todayIso: string): DateRange | null {
  const t = normalize(text);
  const today = new Date(`${todayIso}T00:00:00Z`);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();

  if (/\btoday\b|\bso far today\b/.test(t)) return { from: todayIso, to: todayIso };
  if (/\byesterday\b/.test(t)) {
    const d = utc(y, m, today.getUTCDate() - 1);
    return { from: iso(d), to: iso(d) };
  }

  if (/\blast month\b|\bprevious month\b|\bpast month\b/.test(t)) {
    return m === 0 ? monthRange(y - 1, 11) : monthRange(y, m - 1);
  }
  if (/\bthis month\b|\bcurrent month\b|\bmonth to date\b/.test(t)) return monthRange(y, m);

  if (/\blast week\b|\bprevious week\b/.test(t)) return weekRange(today, -1);
  if (/\bthis week\b/.test(t)) return weekRange(today, 0);

  if (/\blast year\b|\bprevious year\b/.test(t)) {
    return { from: iso(utc(y - 1, 0, 1)), to: iso(utc(y - 1, 11, 31)) };
  }
  if (/\bthis year\b|\byear to date\b/.test(t)) {
    return { from: iso(utc(y, 0, 1)), to: iso(utc(y, 11, 31)) };
  }

  // "last 7 days", "past 3 months", "last six weeks"
  const rel = t.match(/\b(?:last|past)\s+(\d+|\w+)\s+(day|week|month|year)s?\b/);
  if (rel?.[1] && rel[2]) {
    const n = /^\d+$/.test(rel[1]) ? parseInt(rel[1], 10) : NUMBER_WORDS[rel[1]];
    if (n) {
      const unit = rel[2];
      let start: Date;
      if (unit === 'day') start = utc(y, m, today.getUTCDate() - n + 1);
      else if (unit === 'week') start = utc(y, m, today.getUTCDate() - n * 7 + 1);
      else if (unit === 'month') start = utc(y, m - n, today.getUTCDate());
      else start = utc(y - n, m, today.getUTCDate());
      return { from: iso(start), to: todayIso };
    }
  }

  // "since March" -> that month's start through today
  const since = t.match(/\bsince\s+(\w+)\b/);
  if (since?.[1] !== undefined && since[1] in MONTHS) {
    const mi = MONTHS[since[1]]!;
    const yr = mi > m ? y - 1 : y;
    return { from: iso(utc(yr, mi, 1)), to: todayIso };
  }

  // "in July" / bare "July" -> that whole month, most recent occurrence
  const named = t.match(/\b(?:in\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/);
  if (named?.[1]) {
    const mi = MONTHS[named[1]]!;
    const yr = mi > m ? y - 1 : y;
    return monthRange(yr, mi);
  }

  return null;
}

/**
 * Parse an amount into integer minor units.
 * Returns { amountMinor, currency } or null.
 */
export function resolveMoney(text: string): Money | null {
  const t = normalize(text);

  let currency: string | null = null;
  if (/€|\beuros?\b/.test(t)) currency = 'EUR';
  else if (/\$|\bdollars?\b|\busd\b/.test(t)) currency = 'USD';
  else if (/£|\bpounds?\b|\bgbp\b/.test(t)) currency = 'GBP';

  // Digits first: "12.50", "1,200", "€45"
  const digits = t.match(/(?:€|\$|£)?\s*(\d{1,3}(?:[, ]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (digits?.[1]) {
    const raw = digits[1].replace(/[, ]/g, '');
    const minor = Math.round(parseFloat(raw) * 100);
    if (Number.isFinite(minor)) return { amountMinor: minor, currency };
  }

  // Number words: STT emits these constantly. "twelve euros", "twenty five"
  const words = t.split(' ');
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    const n = NUMBER_WORDS[w];
    if (n === undefined) continue;
    seen = true;
    if (n === 100) current = (current || 1) * 100;
    else if (n === 1000) {
      total += (current || 1) * 1000;
      current = 0;
    } else current += n;
  }
  if (seen) {
    total += current;
    if (total > 0) return { amountMinor: total * 100, currency };
  }

  return null;
}

/** Build a flat lookup from the registry's category tree + aliases. */
export function buildEnumIndex(enumDef: EnumDefinition): EnumIndex {
  const index = new Map<string, string>(); // surface form -> canonical value
  const rollup = new Map<string, string>(); // leaf -> parent

  if (enumDef.tree) {
    for (const [parent, children] of Object.entries(enumDef.tree)) {
      index.set(parent, parent);
      for (const child of children) {
        index.set(child, child);
        rollup.set(child, parent);
      }
    }
  }
  if (enumDef.values) for (const v of enumDef.values) index.set(v, v);

  for (const [canonical, aliases] of Object.entries(enumDef.aliases ?? {})) {
    for (const alias of aliases) index.set(normalize(alias), canonical);
  }
  // Underscored canonicals also match their spaced form.
  for (const key of [...index.keys()]) {
    if (key.includes('_')) index.set(key.replace(/_/g, ' '), index.get(key)!);
  }
  return { index, rollup };
}

/**
 * Match an enum value inside free text. Longest surface form wins, so
 * "public transport" beats "transport".
 */
export function resolveEnum(text: string, enumIndex: EnumIndex): string | null {
  const t = ` ${normalize(text)} `;
  let best: { surface: string; value: string } | null = null;
  for (const [surface, canonical] of enumIndex.index) {
    if (t.includes(` ${surface} `) && (!best || surface.length > best.surface.length)) {
      best = { surface, value: canonical };
    }
  }
  return best ? best.value : null;
}

export interface SlotResolution {
  /** Branded, so these can only ever win a merge. See Rule 11 in types.ts. */
  readonly params: DeterministicParams;
  readonly missing: readonly string[];
}

/**
 * Fill every declared param it can, deterministically.
 * Anything left unresolved is what stage 3 is actually for.
 */
export function resolveSlots(
  capability: Capability,
  utterance: string,
  ctx: ScreenContext,
  enums: Readonly<Record<string, EnumIndex>>,
): SlotResolution {
  const params: Record<string, SlotValue> = {};
  const missing: string[] = [];

  for (const [name, spec] of Object.entries(capability.params ?? {})) {
    let value: SlotValue | null = null;

    if (spec.type === 'date') {
      const range = resolveDateRange(utterance, ctx.today);
      if (range) value = name === 'to' ? range.to : range.from;
    } else if (spec.type === 'money') {
      const money = resolveMoney(utterance);
      if (money) value = money.amountMinor;
    } else if (spec.type.startsWith('enum:')) {
      const enumName = spec.type.slice(5);
      const idx = enums[enumName];
      if (idx) value = resolveEnum(utterance, idx);
    } else if (spec.type === 'number') {
      const m = normalize(utterance).match(/\b(\d+)\b/);
      if (m?.[1]) value = parseInt(m[1], 10);
    }

    if (value !== null && value !== undefined) params[name] = value;
    else if (spec.required) missing.push(name);
  }

  return { params: deterministicParams(params), missing };
}
