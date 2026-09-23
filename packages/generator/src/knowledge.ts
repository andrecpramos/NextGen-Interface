// What the adopter tells us about their own app.
//
// The generator reads an application's routes, roles and copy, and from those alone a screen is
// a title and a boilerplate sentence. It cannot know what a screen is *for*, what is on it, or
// what the app's users call it. That is why an ordinary question ("o meu filho magoou-se") never
// reaches the medical screen: the offline matcher is TF-IDF over a vocabulary built only from
// the registry's own text, and a word that appears in no screen's record contributes nothing.
//
// So the missing knowledge is *data*, and the person who has it is the adopter. This file is its
// shape: a `knowledge.json` they own and commit, written with their installing agent by answering
// open questions about the gaps `knowledgeGaps` finds (adapter/AGENTS.md, ASK 9).
//
//   app       what the application is, in the adopter's words          -> stage 3's context
//   glossary  their terms, and the everyday words people use instead   -> vocabulary
//   screens   per route: purpose, what is on it, aliases, real phrases -> description, explanation, examples
//   cannot    what the app does not do, and what to say          -> declared limits (Rule 13), in the adopter's words
//   rules     how the app works and how to reason about a request -> the model stage's context, role by role
//
// It is merged into `description`, `examples` and `explanation` — the fields stage 2 already
// indexes and the widget already serves — so no matcher changes and nothing new is trusted at run
// time. It is deterministic and needs no model, which is a constraint of the copied folder
// (ADR-021), and the file is *written* rather than read, so it arrives as untrusted JSON: parsed,
// never cast, capped, and stripped of anything that could rewrite what an object is (Rule 15).

import type { Capability, RegistryContext } from '@nextgen/core-capability';

import type { AnnotatedCapability } from './types.ts';

export interface GlossaryEntry {
  readonly term: string;
  /** What the term means in this app. Not used for matching; stage 3 is given it as context. */
  readonly means: string | null;
  /** The everyday words people say instead. */
  readonly aliases: readonly string[];
  /** Which roles are told this word. `null` is every role. Rule 17: a registry is its role's entitlement. */
  readonly roles: readonly string[] | null;
}

/**
 * A statement about how the app works, for the model to reason from: what depends on what, what has
 * to be known before something can be found, where people usually go wrong. Short, and about the
 * app — "medical status is per child, so ask which child" — never an instruction to the model.
 */
export interface Rule {
  readonly text: string;
  /** Which roles are told this. `null` is every role. */
  readonly roles: readonly string[] | null;
}

export interface ScreenKnowledge {
  /** What the screen is for, in the adopter's words. Served verbatim as the explanation. */
  readonly purpose: string | null;
  /** What is on it. */
  readonly contains: readonly string[];
  /** Other names for it. */
  readonly aliases: readonly string[];
  /** Things a real user says when they want it. */
  readonly askedAs: readonly string[];
  /**
   * The names of controls on it that only open something — a form, a dialog, a drawer — as the page shows
   * them: `["Novo evento", "New event"]` (ADR-031). The assistant may press one for a visitor who asked to
   * start what it opens. Never list a control that saves, sends, pays or creates a record when pressed.
   */
  readonly opens: readonly string[];
  /**
   * For a screen the scanner cannot read — a route decided on the server, a micro-frontend, a framework it
   * does not know — its name. With it, a `screens` entry whose route matches nothing found is *declared*:
   * it becomes a screen of the registry (ADR-028). Ignored for a screen the scanner found: the app's own
   * title stays.
   */
  readonly title: string | null;
  /**
   * Which roles can open a declared screen. Required in an app with more than one role: a screen's
   * presence in a registry is that role's entitlement (Rule 17), and nothing may be guessed into one.
   */
  readonly roles: readonly string[] | null;
}

/** Something users ask for that this app does not do — declared, never judged (Rule 13). */
export interface Limit {
  /** What it is about: becomes the limit's title. */
  readonly about: string;
  /** What the visitor is told, in the adopter's words. Served verbatim. */
  readonly say: string;
  /** What people say when they ask for it. At least three, so it can be recognised. */
  readonly askedAs: readonly string[];
  /**
   * Where the visitor can do it themselves, or get help with it — routes of this app's screens. Offered
   * beneath the refusal, to each role only where that role can open the screen. Empty: a plain refusal.
   */
  readonly instead: readonly string[];
}

export interface AppKnowledge {
  readonly app: { readonly name: string | null; readonly about: string | null };
  readonly glossary: readonly GlossaryEntry[];
  /** Keyed by route path (`/my/children/medical`) or capability id. */
  readonly screens: Readonly<Record<string, ScreenKnowledge>>;
  readonly cannot: readonly Limit[];
  readonly rules: readonly Rule[];
}

export const EMPTY_KNOWLEDGE: AppKnowledge = { app: { name: null, about: null }, glossary: [], screens: {}, cannot: [], rules: [] };

export interface KnowledgeProblem {
  /** Where in the file, e.g. `screens./a.askedAs[1]`; empty for the file as a whole. */
  readonly path: string;
  readonly message: string;
}

/** Enough for any real app; not enough for a runaway or hostile file to bloat every registry. */
const MAX_SCREENS = 500;
const MAX_GLOSSARY = 200;
const MAX_LIMITS = 50;
const MAX_RULES = 60;
const MAX_ROLES = 20;
/** Aliases a role's model prompt is given per word: the vocabulary must not crowd out the rules. */
const CONTEXT_ALIASES = 8;
const MIN_PHRASES = 3;
const MAX_LIST = 40;
/** Places a refusal points to: a visitor told "not here" can weigh two, not a list. */
const MAX_INSTEAD = 2;
const MAX_ALIASES = 20;
const MAX_TEXT = 300;
const MAX_LONG = 600;
const MAX_EXAMPLES = 60;
const SECTIONS = new Set(['app', 'glossary', 'screens', 'cannot', 'rules']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SOURCE = 'knowledge.json';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Accent- and case-insensitive, for comparing what people write. */
const fold = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------------------------------------------------------------- parse ----

export function parseKnowledge(raw: unknown): { knowledge: AppKnowledge; problems: KnowledgeProblem[] } {
  const problems: KnowledgeProblem[] = [];
  const problem = (path: string, message: string): void => void problems.push({ path, message });

  if (!isObject(raw)) {
    if (raw !== undefined && raw !== null) problem('', 'expected a JSON object; nothing was read');
    else problem('', 'no knowledge file content; nothing was read');
    return { knowledge: EMPTY_KNOWLEDGE, problems };
  }

  for (const key of Object.keys(raw)) if (!SECTIONS.has(key)) problem(key, 'unknown section, ignored — known: app, glossary, screens, cannot, rules');

  /** Text, cleaned; `null` (and a problem, when it was present but wrong) if there is none. */
  const text = (value: unknown, path: string, max: number): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      problem(path, 'expected text, ignored');
      return null;
    }
    const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (cleaned.length > max) {
      problem(path, `too long — cut to ${max} characters`);
      return cleaned.slice(0, max).trim();
    }
    return cleaned || null;
  };

  /** A list of text. A single string is a list of one — the way people write these. */
  const list = (value: unknown, path: string, cap: number, max = MAX_TEXT): string[] => {
    if (value === undefined || value === null) return [];
    const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
    if (!items) {
      problem(path, 'expected a list of text, ignored');
      return [];
    }
    const out: string[] = [];
    items.forEach((item, i) => {
      if (typeof item !== 'string') return problem(`${path}[${i}]`, 'expected text, ignored');
      const cleaned = text(item, `${path}[${i}]`, max);
      if (cleaned) out.push(cleaned);
    });
    if (out.length > cap) {
      problem(path, `too many — kept the first ${cap}`);
      out.length = cap;
    }
    return out;
  };

  /** Which roles something is for: a name or a list of names; absent is every role (`null`). */
  const roles = (value: unknown, path: string): string[] | null => {
    if (value === undefined || value === null) return null;
    const names = list(value, path, MAX_ROLES, 60);
    return names.length > 0 ? names : null;
  };

  const app = isObject(raw.app) ? raw.app : {};
  if (raw.app !== undefined && !isObject(raw.app)) problem('app', 'expected an object, ignored');

  const glossary: GlossaryEntry[] = [];
  if (raw.glossary !== undefined && !Array.isArray(raw.glossary)) problem('glossary', 'expected a list, ignored');
  for (const [i, entry] of (Array.isArray(raw.glossary) ? raw.glossary : []).entries()) {
    const path = `glossary[${i}]`;
    if (glossary.length >= MAX_GLOSSARY) {
      problem('glossary', `too many — kept the first ${MAX_GLOSSARY}`);
      break;
    }
    if (!isObject(entry)) {
      problem(path, 'expected an object, ignored');
      continue;
    }
    const term = text(entry.term, `${path}.term`, 80);
    if (!term) {
      problem(path, 'a glossary entry needs a term, ignored');
      continue;
    }
    glossary.push({
      term,
      means: text(entry.means, `${path}.means`, MAX_TEXT),
      aliases: list(entry.aliases, `${path}.aliases`, MAX_ALIASES, 80),
      roles: roles(entry.roles, `${path}.roles`),
    });
  }

  const rules: Rule[] = [];
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) problem('rules', 'expected a list, ignored');
  for (const [i, entry] of (Array.isArray(raw.rules) ? raw.rules : []).entries()) {
    const path = `rules[${i}]`;
    if (rules.length >= MAX_RULES) {
      problem('rules', `too many — kept the first ${MAX_RULES}`);
      break;
    }
    // A rule is a string, or text with the roles it is for.
    const said = typeof entry === 'string' ? entry : isObject(entry) ? entry.text : undefined;
    const body = text(said, typeof entry === 'string' ? path : `${path}.text`, MAX_LONG);
    if (!body) {
      problem(path, 'a rule needs text, ignored');
      continue;
    }
    rules.push({ text: body, roles: isObject(entry) ? roles(entry.roles, `${path}.roles`) : null });
  }

  // A null prototype: a key in someone's file can only ever be a key.
  const screens: Record<string, ScreenKnowledge> = Object.create(null);
  if (raw.screens !== undefined && !isObject(raw.screens)) problem('screens', 'expected an object keyed by route, ignored');
  for (const [key, value] of Object.entries(isObject(raw.screens) ? raw.screens : {})) {
    const path = `screens.${key}`;
    if (FORBIDDEN_KEYS.has(key)) {
      problem(path, 'not an allowed key, ignored');
      continue;
    }
    if (Object.keys(screens).length >= MAX_SCREENS) {
      problem('screens', `too many — kept the first ${MAX_SCREENS}`);
      break;
    }
    if (!isObject(value)) {
      problem(path, 'expected an object, ignored');
      continue;
    }
    screens[key.trim()] = {
      purpose: text(value.purpose, `${path}.purpose`, MAX_LONG),
      contains: list(value.contains, `${path}.contains`, MAX_LIST),
      aliases: list(value.aliases, `${path}.aliases`, MAX_LIST),
      askedAs: list(value.askedAs, `${path}.askedAs`, MAX_LIST),
      opens: list(value.opens, `${path}.opens`, 20).filter((name) => name.length <= 80),
      title: text(value.title, `${path}.title`, 80),
      roles: roles(value.roles, `${path}.roles`),
    };
  }

  const cannot: Limit[] = [];
  if (raw.cannot !== undefined && !Array.isArray(raw.cannot)) problem('cannot', 'expected a list, ignored');
  for (const [i, entry] of (Array.isArray(raw.cannot) ? raw.cannot : []).entries()) {
    const path = `cannot[${i}]`;
    if (cannot.length >= MAX_LIMITS) {
      problem('cannot', `too many — kept the first ${MAX_LIMITS}`);
      break;
    }
    if (!isObject(entry)) {
      problem(path, 'expected an object, ignored');
      continue;
    }
    const about = text(entry.about, `${path}.about`, 80);
    const say = text(entry.say, `${path}.say`, MAX_LONG);
    const askedAs = list(entry.askedAs, `${path}.askedAs`, MAX_LIST);
    // A route of this app, as the route table writes it; anything else is dropped with a reason.
    const routes = list(entry.instead, `${path}.instead`, MAX_LIST).filter((route, j) => {
      if (route.startsWith('/')) return true;
      problem(`${path}.instead[${j}]`, 'expected a route of this app, starting with "/", ignored');
      return false;
    });
    if (routes.length > MAX_INSTEAD) problem(`${path}.instead`, `too many — kept the first ${MAX_INSTEAD}`);
    const instead = routes.slice(0, MAX_INSTEAD);
    if (!about || !say) problem(path, 'a limit needs both "about" (what it is) and "say" (what to tell the visitor), ignored');
    else if (askedAs.length < MIN_PHRASES) problem(path, `a limit needs at least ${MIN_PHRASES} things people say to ask for it, or it cannot be recognised — ignored`);
    else cannot.push({ about, say, askedAs, instead });
  }

  return {
    knowledge: { app: { name: text(app.name, 'app.name', 80), about: text(app.about, 'app.about', MAX_LONG) }, glossary, screens, cannot, rules },
    problems,
  };
}

// ---------------------------------------------------------------- apply ----

const sentence = (parts: readonly string[]): string => (parts.length ? `${parts.join(', ')}.` : '');
const terminated = (line: string): string => (/[.!?…]$/.test(line) ? line : `${line}.`);

/** Does `term` appear as a word in `folded` (already folded), allowing a plural? */
function mentions(folded: string, term: string): boolean {
  const t = fold(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${t}(s|es)?([^a-z0-9]|$)`).test(folded);
}

const exampleText = (example: string | { readonly say: string }): string => (typeof example === 'string' ? example : example.say);

/** An id for a declared screen, in the registry's dotted-lowercase form: `/players/:id/stats` → `declared.players.id.stats`. */
function declaredId(route: string, taken: ReadonlySet<string>): string {
  const segments = route
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/^:/, '').replace(/\?$/, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '_'))
    .map((s) => (/^[a-z]/.test(s) ? s : `s${s}`));
  const base = `declared.${segments.length > 0 ? segments.join('.') : 'home'}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

/**
 * Screens the adopter declared because the scanner could not read them (ADR-028): a `screens` entry keyed
 * by a route, with a `title`, that matches no screen found. Server-decided routes, micro-frontends and
 * frameworks the scanner does not know are how a complex app escapes a route table; this is how it gets
 * them back. Only for a route (`/…`), only with a title, and — where the app has more than one role —
 * only for the roles named: a declared screen with no roles is left out, and `knowledgeGaps` says so.
 * `applyKnowledge` then merges its purpose, contents and phrasing exactly as for a found screen.
 */
export function declaredScreens(
  found: readonly AnnotatedCapability[],
  knowledge: AppKnowledge,
  allRoles: readonly string[],
  askToGo: (title: string) => readonly string[],
): AnnotatedCapability[] {
  const routes = new Set(found.map((c) => c.route).filter(Boolean));
  const ids = new Set(found.map((c) => c.id));
  const out: AnnotatedCapability[] = [];
  for (const [key, screen] of Object.entries(knowledge.screens)) {
    if (!key.startsWith('/') || !screen.title || routes.has(key) || ids.has(key)) continue;
    const roles = screen.roles ? screen.roles.filter((r) => allRoles.includes(r)) : allRoles.length === 1 ? [...allRoles] : [];
    if (roles.length === 0) continue;
    const id = declaredId(key, ids);
    ids.add(id);
    routes.add(key);
    out.push({
      id,
      kind: 'navigate',
      route: key,
      title: screen.title,
      description: `${terminated(screen.title)}`,
      explanation: screen.purpose ?? terminated(screen.title),
      explanationSource: SOURCE,
      // Rule 10's three, from the adopter's own phrasing first; `applyKnowledge` adds the rest of `askedAs`.
      examples: [...askToGo(screen.title)],
      roles,
    } as AnnotatedCapability);
  }
  return out;
}

/**
 * Merge what the adopter wrote into the screens the generator found. Pure: it returns new
 * capabilities and touches nothing it was given, and the same input gives the same output.
 *
 * Only `description`, `examples` and `explanation` change — never an id, a route, a kind, a
 * title or a role — so knowledge can make a screen easier to find and never move or expose one.
 */
export function applyKnowledge<T extends AnnotatedCapability>(
  capabilities: readonly T[],
  knowledge: AppKnowledge,
): { capabilities: T[]; unmatched: string[] } {
  const matched = new Set<string>();
  const known = (key: string): boolean => Object.hasOwn(knowledge.screens, key);

  const merged = capabilities.map((c): T => {
    const key = c.route && known(c.route) ? c.route : known(c.id) ? c.id : null;
    if (key === null) return c;
    matched.add(key);
    const screen = knowledge.screens[key]!;

    const vocabulary = [
      ...(screen.purpose ? [terminated(screen.purpose)] : []),
      sentence(screen.contains),
      sentence(screen.aliases),
    ].filter(Boolean);

    // The everyday words for a term this screen is about, and only this screen.
    const about = fold([c.title, c.description, screen.purpose ?? '', ...screen.contains, ...screen.aliases, ...screen.askedAs].join(' '));
    const present = new Set(about.split(/[^a-z0-9]+/));
    const everyday = knowledge.glossary
      .filter((entry) => mentions(about, entry.term))
      .flatMap((entry) => entry.aliases)
      .filter((alias) => !fold(alias).split(/[^a-z0-9]+/).every((word) => present.has(word)));
    if (everyday.length) vocabulary.push(sentence([...new Set(everyday)]));

    const seen = new Set<string>();
    // What the adopter said opens something here is also how a visitor asks to start it (ADR-031).
    const examples = [...(c.examples ?? []), ...screen.askedAs, ...screen.opens.slice(0, 3)].filter((example) => {
      const id = fold(exampleText(example)).replace(/\s+/g, ' ').trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Controls that only open something here (ADR-031): what the source showed, and what the adopter said.
    const opens = [...new Set([...(c.opens ?? []), ...screen.opens])];

    return {
      ...c,
      description: [c.description, ...vocabulary].join(' '),
      examples: examples.slice(0, MAX_EXAMPLES),
      ...(screen.purpose ? { explanation: screen.purpose, explanationSource: SOURCE } : {}),
      ...(opens.length > 0 ? { opens } : {}),
    };
  });

  return { capabilities: merged, unmatched: Object.keys(knowledge.screens).filter((key) => !matched.has(key)).sort() };
}

// ------------------------------------------------------------ boundaries ----

/** `Pagamentos e quotas` -> `pagamentos_e_quotas`. */
const slugOf = (text: string): string => fold(text).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'limit';

/**
 * The adopter's declared limits, as the same kind of capability the generator's own catalogue
 * produces (`unsupported`, no route, a refusal). Every role receives them: a limit is about the
 * app, not about a screen anyone is entitled to see.
 */
export function knowledgeBoundaries(knowledge: AppKnowledge): Capability[] {
  const used = new Set<string>();
  return knowledge.cannot.map((limit): Capability => {
    const base = `unsupported.declared.${slugOf(limit.about)}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return {
      id,
      kind: 'unsupported',
      route: null,
      title: limit.about,
      description: [terminated(limit.about), sentence(limit.askedAs)].filter(Boolean).join(' '),
      refusal: limit.say,
      examples: [...limit.askedAs],
      // Every route the adopter named; `splitByRole` keeps, per role, only the ones that role can open.
      ...(limit.instead.length > 0 ? { helpAt: [...limit.instead] } : {}),
    };
  });
}

// -------------------------------------------------------------- context ----

const forRole = (roles: readonly string[] | null, role: string): boolean => roles === null || roles.includes(role);

/**
 * What the model stage is told about the app, for one role: the rules, the vocabulary and the limits
 * that are for it. Rule 17 lives here: a registry *is* its role's entitlement, so a rule scoped to
 * COACH is not written into a PARENT's registry at all, rather than being filtered when read.
 * `null` when there is nothing to tell, so a registry without any is byte-identical to before.
 */
export function knowledgeContext(knowledge: AppKnowledge, role: string): RegistryContext | null {
  const rules = knowledge.rules.filter((r) => forRole(r.roles, role)).map((r) => r.text);
  const glossary = knowledge.glossary
    .filter((g) => forRole(g.roles, role))
    .map((g) => ({
      term: g.term,
      ...(g.means ? { means: g.means } : {}),
      ...(g.aliases.length > 0 ? { aliases: g.aliases.slice(0, CONTEXT_ALIASES) } : {}),
    }));
  const limits = knowledge.cannot.map((l) => ({ about: l.about, say: l.say }));
  if (rules.length === 0 && glossary.length === 0 && limits.length === 0) return null;
  return {
    ...(glossary.length > 0 ? { glossary } : {}),
    ...(rules.length > 0 ? { rules } : {}),
    ...(limits.length > 0 ? { limits } : {}),
  };
}

// ----------------------------------------------------------------- gaps ----

export type GapKind =
  | 'app-about-missing'
  | 'limits-missing'
  | 'rules-missing'
  | 'role-unknown'
  | 'screen-unknown'
  | 'purpose-missing'
  | 'phrasing-thin'
  | 'knowledge-orphan'
  /** A declared screen (a `title` for a route the scanner did not find) that names no role in a multi-role app. */
  | 'declared-roles-missing'
  /** A limit's `instead` names a route that is no screen of this app: it would be dropped without a word. */
  | 'instead-unknown';

export interface KnowledgeGap {
  readonly kind: GapKind;
  readonly route?: string;
  readonly title?: string;
  /** What to ask the developer, in words an agent can say as it stands. */
  readonly message: string;
  /**
   * For a question about a screen: how much answering it is likely to help, higher first (`screenPriority`).
   * 133 questions is an interview nobody finishes (Pilot-A field report, 2026-09-23); the first ten are.
   */
  readonly priority?: number;
}

/**
 * How much knowing a screen is likely to help, for ordering the interview. Not a measurement — a
 * deterministic heuristic over what the scanner knows, stated so it can be argued with:
 *
 * - every role that reaches it is more visitors who may ask for it (+2 each);
 * - a screen whose name shares a word with another's is where the router has to tell two apart (+3);
 * - a top-level screen is asked for by name; a deep one by way of its parent (−1 per level past two);
 * - a screen that needs an item (`:id`) is reached from that item, rarely asked for (−3).
 */
export function screenPriority(capability: AnnotatedCapability, all: readonly AnnotatedCapability[]): number {
  const route = capability.route ?? '';
  const depth = route.split('/').filter(Boolean).length;
  const words = (title: string): Set<string> => new Set(fold(title).split(/\W+/).filter((w) => w.length > 3));
  const own = words(capability.title);
  const twinned = all.some((other) => other.id !== capability.id && other.kind === 'navigate' && [...words(other.title)].some((w) => own.has(w)));
  return capability.roles.length * 2 + (twinned ? 3 : 0) - Math.max(0, depth - 2) - (route.includes(':') ? 3 : 0);
}

export interface KnowledgeCoverage {
  readonly screens: number;
  readonly withPurpose: number;
  /** Screens with at least three phrases real users say. */
  readonly withPhrasing: number;
}

const THIN = 3;

/**
 * What the scanner does not know — the questions an installing agent should put to the
 * developer, screen by screen, instead of a generic form. A screen is asked about once however
 * many roles reach it.
 */
export function knowledgeGaps(
  capabilities: readonly AnnotatedCapability[],
  knowledge: AppKnowledge,
): { gaps: KnowledgeGap[]; coverage: KnowledgeCoverage } {
  const gaps: KnowledgeGap[] = [];
  if (!knowledge.app.about) gaps.push({ kind: 'app-about-missing', message: 'What is this application for, and who uses it? Two sentences, in your words.' });

  if (knowledge.cannot.length === 0) {
    gaps.push({ kind: 'limits-missing', message: 'What do your users ask for that this app cannot do, and what should the assistant say when they do? (Payments, contacting a person, editing data…)' });
  }
  if (knowledge.rules.length === 0) {
    gaps.push({
      kind: 'rules-missing',
      message: 'How does this app work that a newcomer would not guess? What must someone know, or have done, before they can find or do things — and where do users usually go wrong? (One short statement each; say which roles it is for if it is not for everyone.)',
    });
  }
  // A rule or a word scoped to a role the app does not have would be dropped without a word.
  const known = new Set(capabilities.flatMap((c) => c.roles));
  const scoped = [...knowledge.rules.map((r) => ['rule', r.text, r.roles] as const), ...knowledge.glossary.map((g) => ['word', g.term, g.roles] as const)];
  for (const [what, label, roles] of scoped) {
    for (const role of roles ?? []) {
      if (!known.has(role)) {
        gaps.push({ kind: 'role-unknown', message: `The ${what} “${label.slice(0, 60)}” is for the role “${role}”, and this app has no such role (it has ${[...known].join(', ') || 'none'}) — so nobody is told it. A typo?` });
      }
    }
  }

  const screens = new Map<string, AnnotatedCapability>();
  for (const c of capabilities) if (c.kind === 'navigate' && c.route && !screens.has(c.route)) screens.set(c.route, c);

  const matched = new Set<string>();
  let withPurpose = 0;
  let withPhrasing = 0;
  const all = [...screens.values()];
  for (const [route, c] of screens) {
    const key = Object.hasOwn(knowledge.screens, route) ? route : Object.hasOwn(knowledge.screens, c.id) ? c.id : null;
    const label = `${route} (“${c.title}”)`;
    const priority = screenPriority(c, all);
    if (key === null) {
      gaps.push({ kind: 'screen-unknown', route, title: c.title, priority, message: `${label}: what is this screen for, what is on it, and what would a user say to get here?` });
      continue;
    }
    matched.add(key);
    const entry = knowledge.screens[key]!;
    if (entry.purpose) withPurpose++;
    else gaps.push({ kind: 'purpose-missing', route, title: c.title, priority, message: `${label}: what is it for, in your words?` });
    if (entry.askedAs.length >= THIN) withPhrasing++;
    else gaps.push({ kind: 'phrasing-thin', route, title: c.title, priority, message: `${label}: give ${THIN - entry.askedAs.length} more things a real user would say to get here (aim for five: requests, in the language most of your users write, only what this screen really does).` });
  }

  const roleNames = [...new Set(capabilities.flatMap((c) => c.roles))];
  for (const key of Object.keys(knowledge.screens).sort()) {
    if (matched.has(key)) continue;
    const entry = knowledge.screens[key]!;
    if (key.startsWith('/') && entry.title && !(entry.roles ?? []).some((r) => roleNames.includes(r))) {
      gaps.push({
        kind: 'declared-roles-missing',
        route: key,
        message: `“${key}” (“${entry.title}”) is declared in knowledge.json, but names no role this app has (${roleNames.join(', ') || 'none'}), so no one is offered it. Add "roles": the roles that can open it.`,
      });
      continue;
    }
    gaps.push({
      kind: 'knowledge-orphan',
      route: key,
      message: `“${key}” is in knowledge.json but matches no screen — a typo, a page that was removed, or a screen the scanner cannot read? To declare one it cannot read, give it a "title" and the "roles" that can open it.`,
    });
  }
  // Where a limit sends the visitor must be a real screen, or it is quietly dropped from every role.
  for (const limit of knowledge.cannot) {
    for (const route of limit.instead) {
      if (!screens.has(route)) {
        gaps.push({ kind: 'instead-unknown', route, message: `The limit “${limit.about.slice(0, 60)}” sends visitors to “${route}”, which is no screen of this app — a typo, or a page that was removed? It is not offered.` });
      }
    }
  }

  return { gaps, coverage: { screens: screens.size, withPurpose, withPhrasing } };
}
