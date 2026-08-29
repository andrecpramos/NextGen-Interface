import type { Capability, RegistryFile } from '@nextgen/core-capability';
import { policyFor } from './policy.ts';
import { NavigationEngine, type SlotValue, type UndoJournal } from './engines.ts';

/**
 * The dispatcher.
 *
 * Everything the model influences arrives here as data — a capability id and a
 * bag of slots — and everything that happens next is decided by code. That
 * asymmetry is the whole security model (ADR-004): a wrong route is a wasted
 * turn, and a wrong *write* is impossible without a human tapping Confirm on a
 * card showing the parsed parameters.
 */

export type Decision =
  /** Do it now. read / navigate only. */
  | { readonly type: 'execute'; readonly capabilityId: string; readonly params: Readonly<Record<string, SlotValue>>; readonly route: string | null }
  /** Show the parsed parameters and wait. write / destructive. */
  | { readonly type: 'confirm'; readonly capabilityId: string; readonly params: Readonly<Record<string, SlotValue>>; readonly title: string; readonly destructive: boolean }
  /** Ask. Missing slots, low evidence, or an ambiguity the router would not guess through. */
  | { readonly type: 'clarify'; readonly question: string; readonly options: readonly string[] }
  /** Declared limit, or a capability nobody classified. */
  | { readonly type: 'refuse'; readonly reason: string; readonly declared: boolean };

export interface DispatchRequest {
  readonly capabilityId: string | null;
  readonly params: Readonly<Record<string, SlotValue>>;
  readonly missing?: readonly string[];
  /** Candidate ids, used to build the clarifying question. */
  readonly candidates?: readonly string[];
}

export interface DispatcherDeps {
  readonly registry: RegistryFile;
  readonly undo?: UndoJournal;
}

export class Dispatcher {
  private readonly byId: Map<string, Capability>;
  private readonly navigation: NavigationEngine;
  private readonly undo: UndoJournal | undefined;

  constructor(deps: DispatcherDeps) {
    this.byId = new Map(deps.registry.capabilities.map((c) => [c.id, c]));
    this.navigation = new NavigationEngine(deps.registry);
    this.undo = deps.undo;
  }

  /**
   * The policy decision. Pure — it performs nothing, it decides.
   *
   * Order matters and is deliberate: identity, then classification, then
   * completeness, then policy. Classification is checked *before* missing slots,
   * so an unclassified capability is refused rather than turning into a
   * clarifying question that invites the user to complete it.
   */
  decide(request: DispatchRequest): Decision {
    const { capabilityId, params } = request;

    if (!capabilityId) {
      return {
        type: 'clarify',
        question: 'Which of these did you mean?',
        options: request.candidates ?? [],
      };
    }

    // Rule 4. A model-produced id is untrusted until the registry confirms it.
    const cap = this.byId.get(capabilityId);
    if (!cap) {
      return { type: 'refuse', reason: `unknown capability "${capabilityId}"`, declared: false };
    }

    // ADR-004 fail-closed. `null` policy means the kind was never classified.
    const policy = policyFor(cap.kind);
    if (!policy) {
      return {
        type: 'refuse',
        reason: `capability "${cap.id}" has unclassified kind "${cap.kind}" — refusing`,
        declared: false,
      };
    }

    // ADR-009. A declared limit: not a defect, and the user gets the authored
    // explanation rather than a generic "I didn't understand".
    if (!policy.executable) {
      return {
        type: 'refuse',
        reason: cap.refusal ?? 'That is outside what this application does.',
        declared: true,
      };
    }

    const missing = (request.missing ?? []).filter((m) => params[m] === undefined);
    if (missing.length > 0) {
      return {
        type: 'clarify',
        question: describeMissing(cap, missing),
        options: [],
      };
    }

    if (policy.requiresConfirmation) {
      return {
        type: 'confirm',
        capabilityId: cap.id,
        params,
        title: cap.title,
        destructive: cap.kind === 'destructive',
      };
    }

    const nav = cap.kind === 'navigate' ? this.navigation.resolve(cap.id, params) : null;
    if (nav && !nav.ok) {
      return { type: 'clarify', question: nav.reason, options: [] };
    }

    return {
      type: 'execute',
      capabilityId: cap.id,
      params,
      route: nav?.ok ? nav.route : null,
    };
  }

  /**
   * Called once the user has approved a `confirm` decision.
   *
   * A destructive action journals its undo token *before* it is allowed to
   * proceed, and refuses if no journal is wired up. Losing the ability to undo
   * is not a reason to skip the undo — it is a reason not to act.
   */
  async approve(decision: Decision): Promise<Decision | { readonly type: 'approved'; readonly capabilityId: string; readonly params: Readonly<Record<string, SlotValue>>; readonly undoToken: string | null }> {
    if (decision.type !== 'confirm') {
      return { type: 'refuse', reason: 'only a confirm decision can be approved', declared: false };
    }
    const cap = this.byId.get(decision.capabilityId)!;
    const policy = policyFor(cap.kind)!;

    let undoToken: string | null = null;
    if (policy.requiresUndo) {
      if (!this.undo) {
        return {
          type: 'refuse',
          reason: `"${cap.id}" is destructive and no undo journal is configured`,
          declared: false,
        };
      }
      undoToken = await this.undo.record({
        capabilityId: cap.id,
        params: decision.params,
        describedAs: cap.title,
        recordedAt: new Date().toISOString(),
      });
    }

    return { type: 'approved', capabilityId: cap.id, params: decision.params, undoToken };
  }
}

function describeMissing(cap: Capability, missing: readonly string[]): string {
  const described = missing.map((m) => cap.params?.[m]?.description ?? m);
  return described.length === 1
    ? `Which ${described[0]}?`
    : `I need ${described.join(' and ')}.`;
}
