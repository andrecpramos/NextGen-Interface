import type { TurnResponse } from './wire';

/**
 * Should this turn move the browser, and where?
 *
 * WP-35's first acceptance item: *"`navigate` moves the browser to the route; it
 * does not narrate."* Until now it narrated. The engine has resolved routes
 * since WP-03 — `NavigationEngine` refuses rather than emitting a broken URL,
 * the API puts the result on every response — and **no client ever read it**.
 * PLAN.md §3 has carried that as "engine built, surface missing" for the whole
 * project, and for a navigation product it is the main event.
 *
 * This is a pure function rather than a call inside the turn handler because the
 * interesting part is the policy, not the push. Every rule below is a case where
 * moving would be wrong, and each is cheap to state and cheap to test.
 */
export function destinationFor(response: TurnResponse): string | null {
  // 1. Only an executed turn. A confirmation is a question the user has not
  //    answered yet, a clarify is the assistant admitting it does not know, and
  //    a refusal is a declared limit. Moving on any of them would act on a
  //    decision nobody made — and on `confirm` it would defeat ADR-004 entirely
  //    by arriving before the approval.
  if (response.kind !== 'execute') return null;

  // 2. Only a `navigate` capability. `TurnResponse.kind` answers "what did the
  //    dispatcher decide", not "what kind of thing was this" — a `read` also
  //    executes, and its answer has just been rendered into the panel. Moving
  //    away from a search result to the search screen is worse than useless: it
  //    replaces the answer with the form that would produce it.
  if (response.trace.capabilityKind !== 'navigate') return null;

  // 3. Not when the user asked what something *is* (WP-36). "What is the squad
  //    list?" is a question about a screen, not a request to be put on it, and
  //    yanking the reader onto it mid-sentence answers a question they did not
  //    ask. The explanation is served either way; only the movement is withheld.
  if (response.trace.explanationRequest) return null;

  // 4. A route the engine could not resolve is not a destination. The engine
  //    already refuses to emit a broken URL, so this is defence in depth against
  //    an empty string arriving as a push target.
  const route = response.route?.trim();
  if (!route || !route.startsWith('/')) return null;

  return route;
}

/**
 * Is moving to `destination` a no-op from where the user already is?
 *
 * Pushing the current route onto the history stack gives the back button a step
 * that goes nowhere, which reads as the app being broken. Compared on the path
 * only: a query string or hash the user already has is theirs to keep.
 */
export function isSamePlace(destination: string, currentPath: string): boolean {
  const strip = (p: string) => p.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  return strip(destination) === strip(currentPath);
}
