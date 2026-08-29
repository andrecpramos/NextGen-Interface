import { isCapabilityKind, type Capability, type CapabilityKind } from '@nextgen/core-capability';

/**
 * The ADR-004 policy table, as code.
 *
 * "Enforcement must live in code, not in the prompt. A prompt instruction saying
 * 'always confirm before deleting' is a suggestion to a probabilistic system,
 * and it is bypassable by injected text. The dispatcher is neither."
 *
 * Nothing in this file consults a model, a score, or a confidence. Policy is a
 * function of `kind` alone — which is exactly what makes it hold when the router
 * is confidently wrong, and what made the adversarial bucket score 20/20 on
 * every model tested including the one that never refuses anything.
 */

export interface Policy {
  /** May this run at all? */
  readonly executable: boolean;
  /** Must the user see parsed parameters and approve them first? */
  readonly requiresConfirmation: boolean;
  /** Must an undo token be journalled before it runs? */
  readonly requiresUndo: boolean;
}

const POLICY: Readonly<Record<CapabilityKind, Policy>> = {
  // Execute immediately. The large majority of turns are questions, and
  // confirming those would train users to tap Confirm reflexively — which
  // destroys the value of confirmation exactly where it matters.
  read: { executable: true, requiresConfirmation: false, requiresUndo: false },
  navigate: { executable: true, requiresConfirmation: false, requiresUndo: false },

  // Confirmation card showing PARSED PARAMETERS, editable in place. This is
  // where a misheard amount gets caught: STT hears "twenty" as "twelve", and a
  // visible editable field turns an invisible data-corruption bug into a
  // one-tap correction.
  write: { executable: true, requiresConfirmation: true, requiresUndo: false },

  // Confirmation plus an undo token in the journal, which must outlive the
  // screen the action happened on.
  destructive: { executable: true, requiresConfirmation: true, requiresUndo: true },

  // A declared limit (ADR-009). Never executes, and unlike an unclassified
  // capability this is not a defect — it is the application saying so on
  // purpose, with a message authored next to the thing being refused.
  unsupported: { executable: false, requiresConfirmation: false, requiresUndo: false },
};

/**
 * Policy for a kind, or `null` when the kind is unclassified.
 *
 * `null` means **refuse**. It is deliberately not a default: the realistic
 * failure mode is not someone marking a delete as `read`, it is someone adding a
 * capability and forgetting to classify it. Defaulting to `read` would silently
 * grant free execution to whatever comes next; refusing produces a loud,
 * immediate, harmless failure at development time.
 */
export function policyFor(kind: string): Policy | null {
  if (!isCapabilityKind(kind)) return null;
  return POLICY[kind];
}

/** Convenience for the common question, with the fail-closed default baked in. */
export function requiresConfirmation(capability: Capability): boolean {
  return policyFor(capability.kind)?.requiresConfirmation ?? true;
}
