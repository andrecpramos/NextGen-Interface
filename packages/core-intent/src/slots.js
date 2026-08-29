import { normalize } from './text.js';

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

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9,
  november: 10, nov: 10, december: 11, dec: 11,
};

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, day) => new Date(Date.UTC(y, m, day));

function monthRange(y, m) {
  return { from: iso(utc(y, m, 1)), to: iso(utc(y, m + 1, 0)) };
}

/** ISO weeks: Monday start. */
function weekRange(base, offsetWeeks = 0) {
  const d = new Date(base.getTime());
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow + offsetWeeks * 7);
  const sunday = utc(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

/**
 * Resolve a date expression against a reference "today".
 * Returns { from, to } as ISO dates, or null if nothing matched.
 */
export function resolveDateRange(text, todayIso) {
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
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? parseInt(rel[1], 10) : NUMBER_WORDS[rel[1]];
    if (n) {
      const unit = rel[2];
      let start;
      if (unit === 'day') start = utc(y, m, today.getUTCDate() - n + 1);
      else if (unit === 'week') start = utc(y, m, today.getUTCDate() - n * 7 + 1);
      else if (unit === 'month') start = utc(y, m - n, today.getUTCDate());
      else start = utc(y - n, m, today.getUTCDate());
      return { from: iso(start), to: todayIso };
    }
  }

  // "since March" -> that month's start through today
  const since = t.match(/\bsince\s+(\w+)\b/);
  if (since && since[1] in MONTHS) {
    const mi = MONTHS[since[1]];
    const yr = mi > m ? y - 1 : y;
    return { from: iso(utc(yr, mi, 1)), to: todayIso };
  }

  // "in July" / bare "July" -> that whole month, most recent occurrence
  const named = t.match(/\b(?:in\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/);
  if (named) {
    const mi = MONTHS[named[1]];
    const yr = mi > m ? y - 1 : y;
    return monthRange(yr, mi);
  }

  return null;
}

/**
 * Parse an amount into integer minor units.
 * Returns { amountMinor, currency } or null.
 */
export function resolveMoney(text) {
  const t = normalize(text);

  let currency = null;
  if (/€|\beuros?\b/.test(t)) currency = 'EUR';
  else if (/\$|\bdollars?\b|\busd\b/.test(t)) currency = 'USD';
  else if (/£|\bpounds?\b|\bgbp\b/.test(t)) currency = 'GBP';

  // Digits first: "12.50", "1,200", "€45"
  const digits = t.match(/(?:€|\$|£)?\s*(\d{1,3}(?:[, ]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (digits) {
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
export function buildEnumIndex(enumDef) {
  const index = new Map(); // surface form -> canonical value
  const rollup = new Map(); // leaf -> parent

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

  for (const [canonical, aliases] of Object.entries(enumDef.aliases || {})) {
    for (const alias of aliases) index.set(normalize(alias), canonical);
  }
  // Underscored canonicals also match their spaced form.
  for (const key of [...index.keys()]) {
    if (key.includes('_')) index.set(key.replace(/_/g, ' '), index.get(key));
  }
  return { index, rollup };
}

/**
 * Match an enum value inside free text. Longest surface form wins, so
 * "public transport" beats "transport".
 */
export function resolveEnum(text, enumIndex) {
  const t = ` ${normalize(text)} `;
  let best = null;
  for (const [surface, canonical] of enumIndex.index) {
    if (t.includes(` ${surface} `) && (!best || surface.length > best.surface.length)) {
      best = { surface, value: canonical };
    }
  }
  return best ? best.value : null;
}

/**
 * Fill every declared param it can, deterministically.
 * Anything left unresolved is what stage 3 is actually for.
 */
export function resolveSlots(capability, utterance, ctx, enums) {
  const params = {};
  const missing = [];

  for (const [name, spec] of Object.entries(capability.params || {})) {
    let value = null;

    if (spec.type === 'date') {
      const range = resolveDateRange(utterance, ctx.today);
      if (range) value = name === 'to' ? range.to : range.from;
    } else if (spec.type === 'money') {
      const money = resolveMoney(utterance);
      if (money) value = money.amountMinor;
    } else if (spec.type?.startsWith('enum:')) {
      const enumName = spec.type.slice(5);
      if (enums[enumName]) value = resolveEnum(utterance, enums[enumName]);
    } else if (spec.type === 'number') {
      const m = normalize(utterance).match(/\b(\d+)\b/);
      if (m) value = parseInt(m[1], 10);
    }

    if (value !== null && value !== undefined) params[name] = value;
    else if (spec.required) missing.push(name);
  }

  return { params, missing };
}
