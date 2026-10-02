/**
 * The capability schema — the contract between the engine and every domain.
 *
 * This package owns these types precisely so that no domain and no engine
 * package can define its own. A route and a routable intent come from one
 * definition, so a route cannot exist that the AI does not know about, and the
 * AI cannot know about a route that does not exist (architecture.md).
 */

/**
 * The kinds the ADR-004 policy table is defined over, plus one.
 *
 * `unsupported` is not in the original table. It was added by ADR-009 and it is
 * a different statement from the other four: those say what a capability *does*,
 * `unsupported` says the application deliberately does **not** do this. ADR-004
 * rule 3 ("no payments, no transfers, no sending") already drew that boundary —
 * it just drew it in prose, where no code could read it.
 *
 * Note the distinction from *unclassified*, which is a missing `kind` and must
 * be refused as a defect. `unsupported` is a declared, deliberate refusal with a
 * message the user can act on.
 */
export type CapabilityKind = 'navigate' | 'read' | 'write' | 'destructive' | 'unsupported';

/** The four kinds that can actually execute. `unsupported` never executes. */
export type ExecutableKind = Exclude<CapabilityKind, 'unsupported'>;

const CAPABILITY_KINDS: readonly string[] = [
  'navigate',
  'read',
  'write',
  'destructive',
  'unsupported',
];

/**
 * Narrowing guard.
 *
 * Deliberately a runtime check: a registry is data, so `kind` arrives as an
 * unvalidated string. Typing it as `CapabilityKind` at the boundary would make
 * ADR-004's "unclassified → refuse" path look like dead code to the compiler and
 * quietly delete the check it requires.
 */
export function isCapabilityKind(kind: string): kind is CapabilityKind {
  return CAPABILITY_KINDS.includes(kind);
}

export function isExecutableKind(kind: string): kind is ExecutableKind {
  return isCapabilityKind(kind) && kind !== 'unsupported';
}

/** `enum:Category` refers to an enum declared in the registry's `enums` block. */
export type ParamType = 'date' | 'money' | 'number' | 'string' | `enum:${string}`;

export interface ParamSpec {
  readonly type: ParamType;
  readonly required?: boolean;
  /** Human-readable, used to build the clarifying question. */
  readonly description?: string;
}

/**
 * The parameter an i18n router puts in front of every route: next-intl's `[locale]`, `[lang]`.
 *
 * It is not a slot. The visitor never supplies it — the widget fills it from the page they are on — so
 * a route may carry it without declaring it in `params`. One definition, read by the validator, the
 * generator and the widget, so the three cannot disagree about which names it covers.
 */
const LOCALE_PARAM = /^:?(?:locale|lang|language|lng)\??$/i;

/** True for a locale route parameter, named with or without its `:` and optional `?`. */
export function isLocaleParam(name: string): boolean {
  return LOCALE_PARAM.test(name);
}

/**
 * An example utterance.
 *
 * Per architecture.md the examples block "is not documentation. It is the test
 * fixture *and* the few-shot pool. One source, three uses" — the third being the
 * embedding document. `say` feeds retrieval; `expect` feeds golden-set codegen.
 *
 * The plain-string form is shorthand for `{ say }` with no fixture.
 */
export interface CapabilityExample {
  readonly say: string;
  readonly expect?: {
    readonly route?: string;
    readonly params?: Readonly<Record<string, string | number>>;
    readonly maxStage?: 'deterministic' | 'embedding' | 'llm';
  };
}

/**
 * A capability, as it appears in a generated registry.
 *
 * `kind` is `string`, not `CapabilityKind` — see `isCapabilityKind` above.
 * `route` is nullable because an `unsupported` capability has nowhere to go.
 */
export interface Capability {
  readonly id: string;
  readonly kind: string;
  readonly route: string | null;
  readonly title: string;
  /**
   * What this capability is, for **retrieval**. Machine-facing: it is part of
   * the document stage 2 embeds, and its job is to be distinctive.
   */
  readonly description: string;
  /**
   * What a user is told when they ask *"what is this / what does this page
   * do"* — **served verbatim, never generated per turn** (WP-36).
   *
   * This is the same move [ADR-009](../../../.claude/decisions/ADR-009.md) made
   * for refusals, applied to answers. Written once at build time from the
   * application's own copy, it stays model-free, reproducible and auditable, and
   * a wrong answer is fixed by editing a string rather than by tuning a prompt.
   * Generating one per turn would forfeit the whole cost argument and make this
   * a chat widget with our name on it (PLAN.md §1.6, Ladder A1).
   *
   * Deliberately **not** part of `capabilityDocument`. Adding it would change
   * every vector and invalidate every calibrated threshold (Rule 14, Finding 1)
   * — the explanation is what gets *served*, not what gets *matched*.
   *
   * Required on everything that is not a declared limit; a limit answers the
   * same question with its `refusal`.
   */
  readonly explanation?: string;
  /**
   * Where the explanation came from — a path in the adopter's source.
   *
   * WP-36's acceptance: "the explanation is traceable to its source file, so a
   * wrong answer is fixable". Without it, a bad sentence in an adopter's
   * assistant is unattributable and therefore unfixable.
   */
  readonly explanationSource?: string;
  /**
   * Guided steps — *"tell me what to do here"* (WP-27).
   *
   * A route gets someone to a page; a step tells them what to do once they are
   * there. Written at build time from the form the generator found in the page's
   * source, and **never generated per turn** (Rule 9), for the same reasons as
   * `explanation`: served verbatim, auditable, fixable by editing a string.
   */
  readonly steps?: readonly GuidedStep[];
  /**
   * Rules the generator read from this page's own source — a validation
   * schema, a `required`/`min`/`max`/`pattern` attribute (ADR-020, WP-54).
   * Written at build time, never generated per turn, for the same reason
   * `explanation` and `steps` are: served verbatim, auditable, fixable by
   * editing the source it names rather than a prompt.
   */
  readonly rules?: readonly ExtractedRule[];
  readonly triggers?: readonly string[];
  readonly params?: Readonly<Record<string, ParamSpec>>;
  readonly examples?: readonly (string | CapabilityExample)[];
  /** Required on `unsupported`: what the user is told, and why. */
  readonly refusal?: string;
}

/**
 * Where a guided step points — D-3, answered 2026-09-11.
 *
 * **(c) semantic matching is primary** — `label` and `role`, matched against the
 * page's accessibility tree at run time, because a visible label survives a
 * redesign far better than a class name and is how a person finds a field.
 * **(a) a build-time `selector` is the fallback**, and it is never trusted on its
 * own: the runtime refuses a selector match whose accessible name contradicts
 * `label`. **(b) an attribute the adopter adds is never required** — it would be
 * a human step in their codebase, which the product promises not to ask for.
 *
 * An anchor that no longer matches degrades to the step's text. It never points
 * at the wrong element — see `packages/embed/src/anchor.ts`.
 */
export interface StepAnchor {
  /** The control's accessible name as the page shows it. The primary signal. */
  readonly label?: string;
  /** Its ARIA role — `textbox`, `combobox`, `checkbox`, `button` — to disambiguate. */
  readonly role?: string;
  /** A CSS selector captured from source at build time. Fallback only. */
  readonly selector?: string;
}

export interface GuidedStep {
  /** What to do, in words. Always shown, whatever happens to the anchor. */
  readonly text: string;
  readonly anchor?: StepAnchor;
}

/**
 * ADR-020's two confidence tiers for an extracted rule.
 *
 * `read` came from something written down — a validation schema, a `required`
 * attribute, an enum. `inferred` came from a condition in a handler or effect,
 * where the extractor is reading behaviour rather than a declaration. Nothing
 * with tier `inferred` ships in a registry yet (WP-55); the type exists now so
 * the field does not need reshaping when it does.
 */
export type RuleTier = 'read' | 'inferred';

/**
 * A rule the generator read from the application's own source, rather than
 * guessed — ADR-020. `field` names the control it constrains: a form's
 * `name`/`id`, resolved the same way a guided step's anchor is.
 *
 * `source` is `<file>:<line>` in the adopter's own tree, for the same reason
 * `explanationSource` exists on the capability itself: a wrong rule is
 * traceable to the one place that can fix it, and a rule whose line has moved
 * is detectable rather than silently stale.
 */
export interface ExtractedRule {
  readonly field: string;
  readonly statement: string;
  readonly tier: RuleTier;
  readonly source: string;
}

export interface EnumDefinition {
  readonly tree?: Readonly<Record<string, readonly string[]>>;
  readonly values?: readonly string[];
  readonly aliases?: Readonly<Record<string, readonly string[]>>;
}

/**
 * What the application's owner says about it, beyond what its screens say about themselves
 * (2026-09-21, ADR-023). All of it is **data for the model**, and none of it is subject matter
 * written into an engine: `core-intent` reads these fields the way it reads `domainDescription`, so
 * the only thing that makes one adopter's prompt different from another's is what the registry
 * carries (Rule 1).
 *
 * It is role-scoped by construction. A registry *is* its role's entitlement (Rule 17), so what the
 * generator writes here is only what that role may be told; the loader does not filter.
 */
export interface RegistryContext {
  /** The app's own words for things, and the everyday words people say instead. */
  readonly glossary?: readonly {
    readonly term: string;
    readonly means?: string;
    readonly aliases?: readonly string[];
  }[];
  /**
   * How the app works and how to reason about a request, as short statements: what depends on what,
   * what has to be known before something can be found, where people usually go wrong.
   */
  readonly rules?: readonly string[];
  /** What the app does not do, and what its owner wants said when asked. */
  readonly limits?: readonly { readonly about: string; readonly say: string }[];
}

export interface RegistryFile {
  readonly schemaVersion: number;
  /**
   * What application stage 3 is routing for, in one or two sentences — e.g.
   * "A personal finance tracker. It records transactions, budgets, categories
   * and account balances." Read by `core-intent`'s stage-3 prompt so the model
   * knows what app it serves without that knowledge being hardcoded into
   * `core-*` (Rule 1; WP-16, D-2). Required: an engine that silently falls
   * back to a default description on a missing one reproduces the exact
   * defect this field exists to fix.
   */
  readonly domainDescription: string;
  readonly capabilities: readonly Capability[];
  readonly enums?: Readonly<Record<string, EnumDefinition>>;
  /** What the owner says about the app: its words, its rules, its limits. Optional; see `RegistryContext`. */
  readonly context?: RegistryContext;
}

/** Normalise the two example forms to one. */
export function exampleText(example: string | CapabilityExample): string {
  return typeof example === 'string' ? example : example.say;
}
