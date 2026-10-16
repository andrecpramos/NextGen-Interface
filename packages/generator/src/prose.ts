/**
 * Reading a developer's prose for the one judgement it holds and no code does:
 * **is this route still meant to be used?**
 *
 * The first spike's miss #2: `/classes/groups`, `/timetable/overall` and `/dev/icons`
 * were generated with entirely correct roles, and the ground truth still leaves
 * them out — not because access is wrong but because a careful developer knows
 * they are a legacy duplicate, a one-release shim and a dev-only utility. That
 * knowledge exists only in prose. The spike didn't read it; a generator can.
 *
 * The prose read here is the route's own comment and the reason a navigation
 * manifest recorded for it — both written *about the route*. A component's doc
 * comment is deliberately not consulted for this: it describes the component,
 * runs to paragraphs, and an aside mentioning some other legacy thing would
 * silently delete a destination that is perfectly current. It feeds the
 * description instead.
 *
 * All of it is untrusted text (Rule 15). It is matched against fixed patterns
 * and quoted verbatim into the report; none of it is executed, and none of it
 * reaches a prompt from here.
 */

export type ProseVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'legacy'; readonly evidence: string }
  | { readonly kind: 'dev-only'; readonly evidence: string };

const LEGACY = /\b(legacy|deprecated|stale[- ]bookmark|superseded|no longer used|kept one release|route shim)\b/i;
const DEV_ONLY = /\b(dev[- ]only|development builds?|never ships to production|debug[- ]only)\b/i;

/** A path mentioned inside prose, e.g. "/squad/team is the canonical landing". */
const PATH_MENTION = /\/[a-z0-9][a-z0-9/:_-]*/gi;

/**
 * A marker that introduces a *class* of other routes rather than this one.
 *
 * "the legacy routes below redirect into its tabs" is a sentence about the
 * routes below, written on the route they redirect *to* — which is current, and
 * is exactly why the sentence exists. Read carelessly it deletes the
 * destination instead of the shims.
 */
const PLURAL_SUBJECT = /^\s*(routes?\s+(below|above)|routes|links|redirects|deep[- ]links|entries|bookmarks|paths|urls)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;])\s+|\s+—\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Does this sentence's marker describe `path`, or something else it names?
 *
 * The distinction is positional and it is load-bearing. In
 *
 *   "/gradebook/:termId is a legacy deep-link kept one release"
 *
 * the legacy thing is named *before* the marker, and it is not the route the
 * comment sits on — `/gradebook` itself is current. Whereas in
 *
 *   "Legacy group list — /classes/group is the canonical store-driven landing"
 *
 * the marker comes first and the other path is named as the *replacement*, so
 * the route being described is the legacy one. Getting this backwards drops a
 * live destination or keeps a dead one, and both happened to the spike.
 */
function marksThisRoute(sentence: string, marker: RegExp, path: string): boolean {
  const match = marker.exec(sentence);
  if (!match) return false;
  const markerAt = match.index;
  if (PLURAL_SUBJECT.test(sentence.slice(markerAt + match[0].length))) return false;
  for (const mention of sentence.matchAll(PATH_MENTION)) {
    const mentioned = mention[0].replace(/[.,;:]+$/, '');
    if (mentioned === path) continue;
    if (!mentioned.startsWith('/') || mentioned.length < 3) continue;
    // Another route named as the subject, ahead of the marker: not about us.
    if ((mention.index ?? 0) < markerAt) return false;
  }
  return true;
}

/**
 * Judge a route from what the app says about it.
 *
 * Silence is approval: a route nobody wrote a warning about is a route that
 * still works.
 */
export function judgeProse(path: string, sources: readonly (string | null)[]): ProseVerdict {
  for (const source of sources) {
    if (!source) continue;
    for (const sentence of sentences(source)) {
      if (marksThisRoute(sentence, DEV_ONLY, path)) return { kind: 'dev-only', evidence: sentence };
      if (marksThisRoute(sentence, LEGACY, path)) return { kind: 'legacy', evidence: sentence };
    }
  }
  return { kind: 'ok' };
}
