import { normalize } from './text.ts';
import type { Capability } from './types.ts';

/**
 * Stage 1's index: an exact phrase → the one capability it names.
 *
 * A phrase two capabilities both claim names neither. It used to go to whichever registered last, with
 * a console warning nobody reads — and when two roles' registries were merged for a user who holds both
 * (a coach who is also a parent), "nutrição" silently became the guardian's screen for the coach too
 * (Pilot-A field report, 2026-09-23, P2-5). Dropped, the phrase reaches stage 2, which ranks both screens
 * on everything else the visitor said, and asks when they are close.
 */
export function buildTriggerIndex(capabilities: readonly Capability[]): {
  readonly index: Map<string, string>;
  /** Each contested phrase, with the capabilities that claimed it. */
  readonly contested: ReadonlyMap<string, readonly string[]>;
} {
  const claims = new Map<string, string[]>();
  for (const cap of capabilities) {
    for (const trigger of cap.triggers ?? []) {
      const key = normalize(trigger);
      const ids = claims.get(key) ?? [];
      if (!ids.includes(cap.id)) ids.push(cap.id);
      claims.set(key, ids);
    }
  }
  const index = new Map<string, string>();
  const contested = new Map<string, readonly string[]>();
  for (const [key, ids] of claims) {
    if (ids.length === 1) index.set(key, ids[0]!);
    else contested.set(key, ids);
  }
  return { index, contested };
}
