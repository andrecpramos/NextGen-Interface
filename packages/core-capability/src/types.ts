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
  readonly triggers?: readonly string[];
  readonly params?: Readonly<Record<string, ParamSpec>>;
  readonly examples?: readonly (string | CapabilityExample)[];
  /** Required on `unsupported`: what the user is told, and why. */
  readonly refusal?: string;
}

export interface EnumDefinition {
  readonly tree?: Readonly<Record<string, readonly string[]>>;
  readonly values?: readonly string[];
  readonly aliases?: Readonly<Record<string, readonly string[]>>;
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
}

/** Normalise the two example forms to one. */
export function exampleText(example: string | CapabilityExample): string {
  return typeof example === 'string' ? example : example.say;
}
