// Keyboard mashing, recognised without a model (ADR-039, Rule 18).
//
// "asdkj qwpeo zxmn" is not a question. In the first production integration it went matcher → stage 3 (a
// model call) → the app's assistant (another model call): seconds of GPU, and an answer that pretended to
// understand. It is recognised here from letter pairs: every language uses a small set of them for almost
// all of its text, and a mashed string is mostly pairs outside that set.
//
// The set is the application's own: the letter pairs of its registry — every screen's title, description,
// examples and translations, the words it is known by — computed in the browser from the registry it
// already has, once. No file is added to the bundle, and no language list is written into the engine
// (Rule 1): a registry in any language brings its own pairs.

import type { Registry } from './types.ts';

/** The share of letter-pair occurrences the common set covers. The first integration measured 99.7%. */
const COVERAGE = 0.997;
/** A message this short is never judged: "ok", "sim", "2", "hi". */
const MIN_PAIRS = 4;
/** At least this share of a message's pairs outside the common set makes it mashing. */
const RARE_SHARE = 0.5;

const pairCache = new WeakMap<Registry, ReadonlySet<string>>();

function lettersOnly(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

function pairsOf(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < word.length; i++) out.push(word.slice(i, i + 2));
  return out;
}

/** The smallest set of letter pairs covering `COVERAGE` of all pair occurrences in the registry's text. */
export function commonPairs(registry: Registry): ReadonlySet<string> {
  const cached = pairCache.get(registry);
  if (cached) return cached;
  const counts = new Map<string, number>();
  let total = 0;
  const texts: string[] = [...(registry.documents ?? [])];
  for (const cap of registry.capabilities) {
    for (const text of Object.values(cap.translations ?? {})) texts.push(Object.values(text).join(' '));
  }
  if (registry.domainDescription) texts.push(registry.domainDescription);
  for (const text of texts) {
    for (const word of lettersOnly(text)) {
      for (const pair of pairsOf(word)) {
        counts.set(pair, (counts.get(pair) ?? 0) + 1);
        total++;
      }
    }
  }
  const set = new Set<string>();
  let covered = 0;
  for (const [pair, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (covered >= total * COVERAGE) break;
    set.add(pair);
    covered += n;
  }
  pairCache.set(registry, set);
  return set;
}

/** "asdasdasd", "kjkjkjkj": a word that is one short unit, repeated. */
function repeatedUnit(word: string): boolean {
  if (word.length < 6) return false;
  for (let unit = 1; unit <= 3; unit++) {
    if (word.length < unit * 3) continue;
    if (word.slice(0, unit).repeat(Math.ceil(word.length / unit)).slice(0, word.length) === word) return true;
  }
  return false;
}

/**
 * Is this keyboard mashing rather than a question, in the language of this registry?
 *
 * Never judged: fewer than four letter pairs, or anything with a number in it (a code, a plate, an amount
 * the visitor is reading out). A registry with too little text to know its language judges nothing.
 */
export function isMashing(utterance: string, registry: Registry): boolean {
  if (/\p{N}/u.test(utterance)) return false;
  const words = lettersOnly(utterance);
  const pairs = words.flatMap(pairsOf);
  if (pairs.length < MIN_PAIRS) return false;
  const common = commonPairs(registry);
  if (common.size < 50) return false;
  const long = words.filter((w) => w.length >= 6);
  if (long.length > 0 && long.every(repeatedUnit)) return true;
  const rare = pairs.filter((p) => !common.has(p)).length;
  return rare / pairs.length >= RARE_SHARE;
}
