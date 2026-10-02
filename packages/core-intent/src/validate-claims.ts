// ADR-019, WP-53 — every claim the model's free-text prose makes about the application
// is checked against the registry the visitor actually received, before any of it is
// rendered. Rule 4 applied to prose: until now the only model-produced identifier was the
// selected capability id; free text produces identifiers too (screen names, routes), and
// they get the same treatment — retrieved and verified, never trusted.
//
// This is deliberately NOT an attempt to judge whether a sentence is "true" in general.
// It checks three narrow, mechanical things a sentence can state that this codebase can
// verify without a second model call:
//
//   1. Does it name a route that is not in this role's registry?
//   2. Does it read as a claim to have DONE something? (the widget has no dispatcher)
//   3. Does it state a number? (Rule 2 — the model has no data and no arithmetic to draw
//      one from, so any number in free text is unverifiable by construction)
//
// A sentence failing any check is dropped whole, never edited — editing a sentence risks
// producing something the model never actually wrote and would be a new way to be wrong.
// Dropping is the same "when unsure, offer rather than guess" instinct the rest of the
// cascade already holds (Rule 11).

import type { ProseRemoval, Registry } from './types.ts';

export interface ValidatedProse {
  /** The surviving sentences, rejoined with a single space; `null` if none survived. */
  readonly text: string | null;
  readonly removed: readonly ProseRemoval[];
}

/**
 * A deliberately simple splitter: break on `.`, `!` or `?` followed by whitespace or the
 * end of the string, keeping the punctuation. It does not know about abbreviations or
 * decimal points inside a sentence — a false split just means two shorter sentences get
 * checked instead of one, which changes nothing about what survives. What it must not do
 * is silently swallow anything, so a string with no sentence-ending punctuation at all is
 * still returned, as one sentence.
 */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return (trimmed.match(/[^.!?]+[.!?]*/g) ?? [trimmed]).map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * Path-like tokens: a leading slash, then word characters, hyphens or further slashes.
 * Stops at anything that is not part of a path — punctuation, quotes, whitespace — so a
 * route mentioned mid-sentence ("go to /settings now") is captured without its trailing
 * words. Global, so a sentence naming more than one route is checked on every one of them.
 */
const ROUTE_TOKEN = /\/[a-zA-Z0-9][\w-]*(?:\/[\w-]+)*/g;

/**
 * Completion-claim vocabulary, English and Portuguese: first-person and passive forms of
 * the same concepts `action.ts`'s ACTION_CONCEPTS names for a REQUEST (imperative,
 * infinitive). This is the opposite direction — the assistant claiming to have already
 * done one — so the surface forms are different tenses, not the same words.
 *
 * Split in two, and the split is load-bearing, found by asking what an ordinary
 * DESCRIPTIVE sentence could accidentally contain:
 *
 * - `QUALIFIED_EN` — English past participles that are common, ordinary words on their
 *   own ("called", "added", "updated", "changed", "sent"). *"This screen is called
 *   Settings"* or *"shows recently added players"* are completely normal explanatory
 *   sentences, not action claims — a bare-word match here would strip safe answers for
 *   exactly the reason WP-53's Stop-if exists. These only count inside a first-person
 *   perfect frame ("I've/I have/I just/I already ___") or an explicit passive-perfect
 *   ("has/have/is/are/was/were been ___"), both of which are genuinely rare outside a
 *   claim of completion.
 * - `STANDALONE` — Portuguese first-person preterite forms ("marquei", "enviei"), a
 *   Portuguese passive marker ("foi X"), and a short list of English idioms ("done", "all
 *   set") that are not otherwise ordinary words in a screen's description. Safe to match
 *   bare because they carry the claim in the word itself, not in its surrounding frame.
 *
 * Grouped by concept, matching `action.ts`'s grouping, for the same reason: one place to
 * extend a concept in both directions and both languages, never a lexicon-wide catch-all.
 *
 * The honest limitation, inherited from ADR-015 rather than newly introduced: English and
 * Portuguese only, a closed list, tuned on the applications this project has actually
 * read. A third language gets no signal and silently falls back to no claim being
 * detected — which is the pre-ADR-019 state, not a new failure.
 */
const QUALIFIED_EN: Readonly<Record<string, readonly string[]>> = {
  book: ['booked', 'scheduled', 'reserved', 'arranged'],
  pay: ['paid', 'transferred', 'processed', 'purchased', 'bought', 'ordered'],
  send: ['sent', 'emailed', 'messaged', 'called', 'published', 'posted'],
  delete: ['deleted', 'erased', 'removed'],
  cancel: ['cancelled', 'canceled'],
  edit: ['changed', 'edited', 'updated', 'modified', 'renamed'],
  create: ['created', 'added'],
  fill: ['filled', 'submitted'],
  approve: ['approved'],
  // README's/AGENTS.md's own four-word summary of what the widget never does: "save,
  // send, delete or change anything". `save` was the one missing here.
  save: ['saved'],
};

const STANDALONE: Readonly<Record<string, readonly string[]>> = {
  generic: ['done', 'all set', 'all done', 'feito', 'pronto', 'concluído', 'concluido', 'tudo pronto'],
  book: ['marquei', 'agendei', 'reservei', 'foi marcado', 'foi marcada', 'foi agendado', 'foi agendada'],
  pay: ['paguei', 'transferi', 'processei', 'encomendei', 'foi pago', 'foi paga', 'foi processado'],
  send: ['enviei', 'mandei', 'liguei', 'publiquei', 'foi enviado', 'foi enviada', 'foi publicado'],
  delete: ['apaguei', 'eliminei', 'removi', 'foi apagado', 'foi apagada', 'foi eliminado', 'foi removido'],
  cancel: ['cancelei', 'foi cancelado', 'foi cancelada'],
  edit: ['alterei', 'mudei', 'editei', 'atualizei', 'foi alterado', 'foi atualizado', 'foi atualizada'],
  create: ['criei', 'adicionei', 'foi criado', 'foi criada', 'foi adicionado'],
  fill: ['preenchi', 'submeti', 'foi submetido', 'foi submetida', 'foi preenchido'],
  approve: ['aprovei', 'foi aprovado', 'foi aprovada'],
  save: ['guardei', 'gravei', 'foi guardado', 'foi guardada', 'foi gravado', 'foi gravada'],
};

const escapeAndSpace = (phrase: string): string =>
  phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');

const qualifiedWords = Object.values(QUALIFIED_EN).flat().map(escapeAndSpace).join('|');
const standaloneWords = Object.values(STANDALONE).flat().map(escapeAndSpace).join('|');

const COMPLETION_PATTERN = new RegExp(
  [
    // "I've/I have/I just/I already ___", allowing up to two words between (adverbs,
    // "the appointment for you") without letting the frame drift onto a different verb.
    `\\bi(?:'ve| have| just| already)(?:\\s+\\w+){0,2}?\\s+(?:${qualifiedWords})\\b`,
    // Explicit passive-perfect: "has/have/is/are/was/were been ___".
    `\\b(?:has|have|is|are|was|were)\\s+been\\s+(?:${qualifiedWords})\\b`,
    `\\b(?:${standaloneWords})\\b`,
  ].join('|'),
  'iu',
);

/**
 * A number outside a route token. Routes are checked and stripped of their own digits by
 * `ROUTE_TOKEN` matching first — this pattern runs on what is left, so `/squad/5` naming a
 * real route does not itself trigger this rule on the "5".
 */
const BARE_NUMBER = /\b\d[\d.,]*\b/u;

/**
 * Check one sentence against the three rules, in the order that fails fastest and reads
 * most clearly in a trace: an unknown reference is the most specific and most likely to be
 * a genuine hallucination, so it is named first when a sentence trips more than one rule.
 */
function checkSentence(sentence: string, knownRoutes: ReadonlySet<string>): ProseRemoval | null {
  const routeTokens = sentence.match(ROUTE_TOKEN) ?? [];
  const unknownRoute = routeTokens.find((token) => !knownRoutes.has(token));
  if (unknownRoute !== undefined) return { sentence, reason: 'unknown-reference' };

  if (COMPLETION_PATTERN.test(sentence)) return { sentence, reason: 'action-claim' };

  // Strip the route tokens already found legitimate before checking for a bare number, so
  // a real, known route containing digits (`/squad/teams/2`) is not itself flagged.
  const withoutRoutes = routeTokens.reduce((text, token) => text.split(token).join(' '), sentence);
  if (BARE_NUMBER.test(withoutRoutes)) return { sentence, reason: 'unverifiable-number' };

  return null;
}

/**
 * Validate stage 3's free-text answer against the registry the visitor actually received.
 *
 * `registry` here is that visitor's OWN role's registry — the same one `route()` already
 * has in scope — so "a route not in this role's registry" is exactly Rule 17's own test,
 * applied to prose instead of to a served file.
 */
export function validateClaims(prose: string, registry: Registry): ValidatedProse {
  const knownRoutes = new Set(
    registry.capabilities.map((c) => c.route).filter((r): r is string => typeof r === 'string'),
  );

  const sentences = splitSentences(prose);
  const kept: string[] = [];
  const removed: ProseRemoval[] = [];

  for (const sentence of sentences) {
    const failure = checkSentence(sentence, knownRoutes);
    if (failure) removed.push(failure);
    else kept.push(sentence);
  }

  return { text: kept.length > 0 ? kept.join(' ') : null, removed };
}
