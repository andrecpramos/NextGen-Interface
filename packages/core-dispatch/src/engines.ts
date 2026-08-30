import type { Capability } from '@nextgen/core-capability';

/**
 * Everything the dispatcher reads from a registry, and nothing else.
 *
 * Deliberately not `RegistryFile`: that also carries `enums` in their *source*
 * form, while a loaded registry carries them compiled. Asking for the whole file
 * made a runtime registry fail to satisfy this port despite having every field
 * actually used — a mismatch no isolated test could surface, because neither
 * package ever saw the other's value.
 */
export interface CapabilitySource {
  readonly capabilities: readonly Capability[];
}

/**
 * The engines the dispatcher drives.
 *
 * `NavigationEngine` is concrete — validating a route against the registry needs
 * no I/O and belongs here. `QueryEngine` and `UndoJournal` are interfaces: the
 * dispatcher must not know whether a query hits SQLite or Postgres, and WP-04
 * supplies the implementations.
 */

export type SlotValue = string | number;

// ------------------------------------------------------------- navigation --

export type NavigationResult =
  | { readonly ok: true; readonly route: string; readonly params: Readonly<Record<string, SlotValue>> }
  | { readonly ok: false; readonly reason: string };

/**
 * Turns a capability id plus slots into a route the router can actually take.
 *
 * The model never produces a route — it produces a capability id, and this
 * resolves it (Rule 3). A hallucinated `/expensez` therefore cannot exist: there
 * is no path from model output to a route string that does not pass through a
 * registry lookup here.
 */
export class NavigationEngine {
  private readonly byId: Map<string, Capability>;

  constructor(registry: CapabilitySource) {
    this.byId = new Map(registry.capabilities.map((c) => [c.id, c]));
  }

  resolve(capabilityId: string, params: Readonly<Record<string, SlotValue>>): NavigationResult {
    const cap = this.byId.get(capabilityId);
    if (!cap) return { ok: false, reason: `unknown capability "${capabilityId}"` };
    if (cap.kind === 'unsupported') {
      return { ok: false, reason: cap.refusal ?? 'that is outside what this application does' };
    }
    if (!cap.route) return { ok: false, reason: `"${capabilityId}" has no route` };

    // Fill any :segments from params, and refuse rather than build a broken URL.
    const segments = cap.route.split('/');
    const filled: string[] = [];
    for (const segment of segments) {
      if (!segment.startsWith(':')) {
        filled.push(segment);
        continue;
      }
      const name = segment.slice(1);
      const value = params[name];
      if (value === undefined) {
        return { ok: false, reason: `route "${cap.route}" needs "${name}", which was not resolved` };
      }
      filled.push(encodeURIComponent(String(value)));
    }

    // Anything not consumed by the path is a query param, and only declared ones
    // survive: a model-supplied key the registry does not know about is dropped.
    const query: Record<string, SlotValue> = {};
    for (const [k, v] of Object.entries(params)) {
      if (cap.params?.[k] && !cap.route.includes(`:${k}`)) query[k] = v;
    }

    return { ok: true, route: filled.join('/') || '/', params: query };
  }
}

// ------------------------------------------------------------------ query --

/**
 * The query contract.
 *
 * Rule 3: **the model never emits SQL.** It selects a capability id and typed
 * slots; an implementation of this maps that pair onto one of a fixed,
 * parameterised set of queries. There is no string-building path from an
 * utterance to a database, which is what makes injected text in a transaction
 * memo unable to become a query.
 *
 * Implemented in WP-04.
 */
export interface QueryEngine {
  run(request: QueryRequest): Promise<QueryResult>;
}

export interface QueryRequest {
  readonly capabilityId: string;
  readonly params: Readonly<Record<string, SlotValue>>;
}

export interface QueryResult {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /**
   * What was read, for the trace. "What data did you use?" is answered from
   * this record, not from asking the model to recall.
   */
  readonly dataRead: readonly DataRef[];
}

export interface DataRef {
  readonly table: string;
  readonly rowCount: number;
  readonly from?: string;
  readonly to?: string;
}

// ------------------------------------------------------------------- undo --

/**
 * The undo journal.
 *
 * ADR-004: a destructive action records a token *before* it runs, and the
 * affordance survives navigation away from the screen it happened on.
 * Implemented in WP-04.
 */
export interface UndoJournal {
  /** Called before the action. Returning a token is what permits it to proceed. */
  record(entry: UndoEntry): Promise<string>;
  undo(token: string): Promise<UndoOutcome>;
  get(token: string): Promise<UndoEntry | null>;
}

export interface UndoEntry {
  readonly capabilityId: string;
  readonly params: Readonly<Record<string, SlotValue>>;
  readonly describedAs: string;
  readonly recordedAt: string;
}

export type UndoOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };
