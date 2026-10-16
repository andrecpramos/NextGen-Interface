import type { GuidedStep, StepAnchor } from '@nextgen/core-capability';

/**
 * Where does a guided step point?
 *
 * **Semantic matching at run time is primary, a build-time CSS selector is the
 * fallback, and an attribute the adopter adds is never required.** That last
 * would be a human step in their codebase, which the product promises not to
 * ask for.
 *
 * ## The one property this file exists to hold
 *
 * **An anchor that no longer matches degrades to text. It never points at the
 * wrong element.** A confidently wrong hint is worse than none, and the failure
 * to avoid is exactly that: anchors mispointing rather than degrading under a deliberate change to the app.
 *
 * So the resolver refuses in every case where it is not sure:
 *
 * - **no match** — the step is shown as text, with no highlight;
 * - **more than one match** — ambiguous, so also text. Picking the first of two
 *   "Email" fields is how a user is told to type their password into the wrong box;
 * - **a selector match whose accessible name contradicts the declared label** —
 *   the build-time selector survived a redesign that moved it onto a different
 *   field. This is the case that makes (a) dangerous on its own, and it is refused.
 *
 * The DOM is reached through a two-method interface rather than `Document`, so the
 * policy is testable without a browser and without a DOM library — every
 * behaviour above has a test against a hand-built tree.
 */

/** The slice of an element the resolver reads. `Element` satisfies it. */
export interface AnchorNode {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
}

/** The slice of a document the resolver reads. `Document` satisfies it. */
export interface AnchorRoot {
  querySelectorAll(selector: string): ArrayLike<AnchorNode>;
  getElementById(id: string): AnchorNode | null;
}

export type AnchorResult =
  | { readonly status: 'matched'; readonly element: AnchorNode; readonly via: 'label' | 'selector' }
  | { readonly status: 'unmatched'; readonly reason: string }
  | { readonly status: 'ambiguous'; readonly count: number };

const norm = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The implicit ARIA role of the controls a form step can point at. */
function roleOf(el: AnchorNode): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button') return 'button';
    return 'textbox';
  }
  return tag;
}

function toArray(list: ArrayLike<AnchorNode>): AnchorNode[] {
  return Array.from({ length: list.length }, (_, i) => list[i]!);
}

/**
 * The accessible name, computed from the same sources a screen reader uses, in
 * roughly the same order. Deliberately not the full accname algorithm — it covers
 * what a form control carries in practice, and returns `null` rather than
 * guessing when none of them is present.
 */
export function accessibleName(el: AnchorNode, root: AnchorRoot): string | null {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => root.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }

  const id = el.getAttribute('id');
  if (id) {
    for (const label of toArray(root.querySelectorAll('label'))) {
      if (label.getAttribute('for') === id && label.textContent?.trim()) return label.textContent;
    }
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder;

  // A button is named by its own text.
  if (roleOf(el) === 'button' && el.textContent?.trim()) return el.textContent;

  return null;
}

/** Every control whose accessible name equals `label`. */
function byLabel(label: string, root: AnchorRoot): AnchorNode[] {
  const want = norm(label);
  const found = new Set<AnchorNode>();

  // <label for="x">Label</label> → #x
  for (const l of toArray(root.querySelectorAll('label'))) {
    if (norm(l.textContent) !== want) continue;
    const target = l.getAttribute('for');
    const el = target ? root.getElementById(target) : null;
    if (el) found.add(el);
  }

  // Everything else that can carry a name: aria-label, aria-labelledby,
  // placeholder, and a button's own text.
  const candidates = [
    ...toArray(root.querySelectorAll('[aria-label]')),
    ...toArray(root.querySelectorAll('[aria-labelledby]')),
    ...toArray(root.querySelectorAll('[placeholder]')),
    ...toArray(root.querySelectorAll('button')),
  ];
  for (const el of candidates) {
    if (norm(accessibleName(el, root)) === want) found.add(el);
  }

  return [...found];
}

/**
 * Resolve one anchor against the live page.
 *
 * Label first — semantic matching — narrowed by role when the step declares one. The
 * build-time selector is consulted only when the label finds nothing, and even
 * then it must not contradict the label.
 */
export function resolveAnchor(anchor: StepAnchor | undefined, root: AnchorRoot): AnchorResult {
  if (!anchor || (!anchor.label && !anchor.selector)) {
    return { status: 'unmatched', reason: 'the step declares nothing to anchor to' };
  }

  if (anchor.label) {
    let matches = byLabel(anchor.label, root);
    if (anchor.role) matches = matches.filter((el) => roleOf(el) === anchor.role!.toLowerCase());
    if (matches.length === 1) return { status: 'matched', element: matches[0]!, via: 'label' };
    if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  }

  if (anchor.selector) {
    let matches: AnchorNode[];
    try {
      matches = toArray(root.querySelectorAll(anchor.selector));
    } catch {
      return { status: 'unmatched', reason: `the selector "${anchor.selector}" is not valid on this page` };
    }
    if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
    if (matches.length === 1) {
      const el = matches[0]!;
      // The redesign guard. The selector was captured at build time; if the
      // element it now finds carries a *different* name than the field the step
      // was written for, the selector has drifted onto another control. Pointing
      // there would be the confidently wrong hint this file exists to prevent.
      if (anchor.label) {
        const name = accessibleName(el, root);
        if (name !== null && norm(name) !== norm(anchor.label)) {
          return {
            status: 'unmatched',
            reason: `the selector now finds a field named "${name.trim()}", not "${anchor.label}" — refusing to point at it`,
          };
        }
      }
      if (anchor.role && roleOf(el) !== anchor.role.toLowerCase()) {
        return { status: 'unmatched', reason: `the selector now finds a ${roleOf(el)}, not a ${anchor.role}` };
      }
      return { status: 'matched', element: el, via: 'selector' };
    }
  }

  return { status: 'unmatched', reason: anchor.label ? `no field named "${anchor.label}" on this page` : 'the selector matches nothing' };
}

export interface ResolvedStep {
  readonly text: string;
  /** `null` means "show the text, highlight nothing" — the degraded, safe case. */
  readonly element: AnchorNode | null;
  readonly result: AnchorResult;
}

/**
 * Resolve a whole guided sequence. Every step keeps its text whatever happens to
 * its anchor, so the worst outcome is the guidance a screen reader user gets
 * anyway: an ordered list of instructions with nothing highlighted.
 */
export function resolveSteps(steps: readonly GuidedStep[], root: AnchorRoot): ResolvedStep[] {
  return steps.map((step) => {
    const result = resolveAnchor(step.anchor, root);
    return { text: step.text, element: result.status === 'matched' ? result.element : null, result };
  });
}
