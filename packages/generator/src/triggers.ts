// Imported rather than reimplemented, deliberately. A trigger is only useful if
// it is byte-identical to what stage 1 will look up, and `normalize` carries a
// warning in its own source that changing it "shifts every score". A private
// copy here would drift the day either side is touched, and the failure would
// be silent: triggers that are present, indexed, and never matched.
import { normalize } from '@nextgen/core-intent';

/**
 * Stage-1 triggers, from the application's own nav labels.
 *
 * WP-38 lever 1, and the cheapest of the three. The generator emitted **zero**
 * triggers across 145 capabilities, which means stage 1 — the 2ms, no-model,
 * exact-match path — never fired once in the whole fut-app measurement. The
 * model-free rate could not have been anything but low: two of the three stages
 * were doing all the work and the free one was switched off.
 *
 * The source is the label a person wrote for other people to read on a sidebar.
 * PLAN.md §7.2 is explicit that this is a far richer signal than JSX, and it is
 * the vocabulary a user is most likely to type, because it is the vocabulary
 * they have been reading.
 *
 * ## The rule that makes this safe
 *
 * **A phrase claimed by more than one capability is dropped, not assigned.**
 *
 * `core-intent/src/registry.ts` builds its trigger index with last-write-wins
 * and a `console.warn` on collision. A warning in a build log is not a
 * mechanism: emitting an ambiguous trigger would silently hand every "Calendar"
 * utterance to whichever capability sorted last, and stage 1 answers with
 * **score 1.0** — no margin check, no runner-up, no escalation. A wrong stage-1
 * hit is the most confident wrong answer the system can give.
 *
 * So ambiguity is resolved by refusing to guess, which is the same move
 * ADR-009 makes for out-of-scope and Rule 13 makes for declared limits.
 */

/**
 * Stage 1 ignores triggers shorter than this when matching a substring
 * (`stages.ts`), so a shorter one can only ever fire on an exact whole-utterance
 * match. Emitting them would add index entries that almost never hit and give a
 * misleading trigger count — the number is supposed to mean coverage.
 */
const MIN_TRIGGER_LENGTH = 4;

export interface TriggerAssignment {
  readonly triggers: ReadonlyMap<string, readonly string[]>;
  /** Normalised phrases dropped because more than one capability claimed them. */
  readonly ambiguous: ReadonlyMap<string, readonly string[]>;
}

/**
 * Assign each capability the candidate phrases that only it claims.
 *
 * `candidates` maps capability id to every phrase that could identify it — in
 * practice its nav label in each configured language, both as written and as
 * feature-qualified. Order within a capability is preserved so the most natural
 * spelling stays first.
 */
export function assignTriggers(
  candidates: ReadonlyMap<string, readonly string[]>,
): TriggerAssignment {
  // normalised phrase -> the capability ids claiming it
  const claims = new Map<string, Set<string>>();
  for (const [id, phrases] of candidates) {
    for (const phrase of phrases) {
      const key = normalize(phrase);
      if (key.length < MIN_TRIGGER_LENGTH) continue;
      let owners = claims.get(key);
      if (!owners) claims.set(key, (owners = new Set()));
      owners.add(id);
    }
  }

  const triggers = new Map<string, string[]>();
  const ambiguous = new Map<string, string[]>();

  for (const [id, phrases] of candidates) {
    const mine: string[] = [];
    const seen = new Set<string>();
    for (const phrase of phrases) {
      const key = normalize(phrase);
      if (key.length < MIN_TRIGGER_LENGTH || seen.has(key)) continue;
      const owners = claims.get(key)!;
      if (owners.size > 1) {
        if (!ambiguous.has(key)) ambiguous.set(key, [...owners].sort());
        continue;
      }
      seen.add(key);
      // Stored normalised: `registry.ts` normalises on the way into the index
      // anyway, and storing the normalised form makes the emitted registry show
      // exactly what will be matched rather than something that looks different.
      mine.push(key);
    }
    if (mine.length > 0) triggers.set(id, mine);
  }

  return { triggers, ambiguous };
}
