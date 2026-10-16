import { describe, expect, it } from 'vitest';

import { accessibleName, resolveAnchor, resolveSteps, type AnchorNode, type AnchorRoot } from './anchor.ts';

/**
 * The failure that must never happen: *anchors mispoint rather than degrade
 * under a deliberate change to the app.* Every test below either points correctly or refuses —
 * and the ones that matter most are the deliberate changes, which must refuse.
 *
 * The page is a hand-built tree behind the resolver's two-method interface, so
 * this needs no browser and no DOM library. The selector engine below supports
 * exactly what the resolver asks for: a tag, `#id`, `[attr]`, `[attr="v"]`, and
 * a tag followed by attribute clauses.
 */

interface Spec {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
}

function page(...specs: Spec[]): AnchorRoot & { nodes: AnchorNode[] } {
  const nodes: AnchorNode[] = specs.map((s) => ({
    tagName: s.tag.toUpperCase(),
    getAttribute: (name: string) => s.attrs?.[name] ?? null,
    textContent: s.text ?? null,
  }));

  const matches = (el: AnchorNode, selector: string): boolean => {
    const m = /^([a-zA-Z]*)((?:\[[^\]]+\])*)$|^#([\w-]+)$/.exec(selector.trim());
    if (!m) throw new SyntaxError(`unsupported selector ${selector}`);
    if (m[3]) return el.getAttribute('id') === m[3];
    if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    for (const clause of (m[2] ?? '').match(/\[[^\]]+\]/g) ?? []) {
      const [, attr, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(clause) ?? [];
      if (!attr) throw new SyntaxError(`unsupported clause ${clause}`);
      const actual = el.getAttribute(attr);
      if (actual === null) return false;
      if (value !== undefined && actual !== value) return false;
    }
    return true;
  };

  return {
    nodes,
    querySelectorAll: (selector) => nodes.filter((n) => matches(n, selector)),
    getElementById: (id) => nodes.find((n) => n.getAttribute('id') === id) ?? null,
  };
}

/** The fixture's notifications form, as a browser would render it. */
const notificationsForm = () =>
  page(
    { tag: 'label', attrs: { for: 'notify-email' }, text: 'Email address' },
    { tag: 'input', attrs: { id: 'notify-email', name: 'email', type: 'email' } },
    { tag: 'label', attrs: { for: 'notify-frequency' }, text: 'Digest frequency' },
    { tag: 'select', attrs: { id: 'notify-frequency', name: 'frequency' } },
    { tag: 'input', attrs: { name: 'quietHours', type: 'text', 'aria-label': 'Quiet hours' } },
    { tag: 'button', attrs: { type: 'submit' }, text: 'Save preferences' },
  );

describe('resolveAnchor — semantic matching is primary', () => {
  it('finds a field by the label bound to it with `for`', () => {
    const root = notificationsForm();
    const r = resolveAnchor({ label: 'Email address', role: 'textbox' }, root);
    expect(r).toMatchObject({ status: 'matched', via: 'label' });
    expect(r.status === 'matched' && r.element.getAttribute('name')).toBe('email');
  });

  it('finds a field that has only an aria-label and no visible label', () => {
    const r = resolveAnchor({ label: 'Quiet hours' }, notificationsForm());
    expect(r.status === 'matched' && r.element.getAttribute('name')).toBe('quietHours');
  });

  it('finds a submit button by its own text', () => {
    const r = resolveAnchor({ label: 'Save preferences', role: 'button' }, notificationsForm());
    expect(r).toMatchObject({ status: 'matched', via: 'label' });
  });

  it('is indifferent to case and whitespace, which a person would be too', () => {
    const r = resolveAnchor({ label: '  email   ADDRESS ' }, notificationsForm());
    expect(r.status).toBe('matched');
  });

  it('uses the role to disambiguate a label two controls share', () => {
    const root = page(
      { tag: 'input', attrs: { 'aria-label': 'Quiet hours', type: 'checkbox' } },
      { tag: 'input', attrs: { 'aria-label': 'Quiet hours', type: 'text' } },
    );
    const r = resolveAnchor({ label: 'Quiet hours', role: 'checkbox' }, root);
    expect(r.status === 'matched' && r.element.getAttribute('type')).toBe('checkbox');
  });
});

describe('resolveAnchor — the selector is a fallback, never trusted alone', () => {
  it('falls back to the selector when the label is not on the page', () => {
    const root = page({ tag: 'input', attrs: { id: 'notify-email', name: 'email' } });
    const r = resolveAnchor({ label: 'Email address', selector: '#notify-email' }, root);
    // No label and no competing name on the element: the selector cannot be
    // contradicted, so it is accepted — and says it came from the fallback.
    expect(r).toMatchObject({ status: 'matched', via: 'selector' });
  });

  it('is not consulted at all when the label already found the field', () => {
    const root = notificationsForm();
    const r = resolveAnchor({ label: 'Email address', selector: '#does-not-exist' }, root);
    expect(r).toMatchObject({ status: 'matched', via: 'label' });
  });
});

/**
 * The Stop-if. Each of these is a deliberate change to the application — the
 * kind that happens on any redesign — and each must end in text, not in a
 * highlight on the wrong control.
 */
describe('a deliberate change to the app degrades to text; it never mispoints', () => {
  it('refuses when the selector now finds a field with a different name', () => {
    // The redesign moved `#notify-email` onto what is now a phone field, and
    // renamed the email label. The selector still resolves — to the wrong thing.
    const root = page(
      { tag: 'label', attrs: { for: 'notify-email' }, text: 'Phone number' },
      { tag: 'input', attrs: { id: 'notify-email', name: 'phone' } },
    );
    const r = resolveAnchor({ label: 'Email address', selector: '#notify-email' }, root);
    expect(r.status).toBe('unmatched');
    expect(r.status === 'unmatched' && r.reason).toMatch(/Phone number/);
  });

  it('refuses when the selector now finds a different kind of control', () => {
    const root = page({ tag: 'button', attrs: { id: 'notify-email' } });
    const r = resolveAnchor({ label: 'Email address', role: 'textbox', selector: '#notify-email' }, root);
    expect(r.status).toBe('unmatched');
  });

  it('refuses when two fields carry the label, rather than guessing the first', () => {
    const root = page(
      { tag: 'label', attrs: { for: 'a' }, text: 'Email address' },
      { tag: 'input', attrs: { id: 'a' } },
      { tag: 'label', attrs: { for: 'b' }, text: 'Email address' },
      { tag: 'input', attrs: { id: 'b' } },
    );
    expect(resolveAnchor({ label: 'Email address' }, root)).toEqual({ status: 'ambiguous', count: 2 });
  });

  it('refuses when the selector itself now matches more than one element', () => {
    const root = page({ tag: 'input', attrs: { name: 'email' } }, { tag: 'input', attrs: { name: 'email' } });
    expect(resolveAnchor({ selector: 'input[name="email"]' }, root)).toEqual({ status: 'ambiguous', count: 2 });
  });

  it('refuses when the field was removed entirely', () => {
    const r = resolveAnchor({ label: 'Email address', selector: '#notify-email' }, page());
    expect(r.status).toBe('unmatched');
  });

  it('refuses an invalid selector instead of throwing into the page', () => {
    const r = resolveAnchor({ selector: 'input:has(>' }, notificationsForm());
    expect(r.status).toBe('unmatched');
  });
});

describe('resolveSteps — every step keeps its text whatever its anchor does', () => {
  it('highlights what it can and leaves the rest as instructions', () => {
    const steps = [
      { text: 'Fill in “Email address”.', anchor: { label: 'Email address', role: 'textbox' } },
      { text: 'Fill in “Pager”.', anchor: { label: 'Pager' } },
      { text: 'Read the page.' },
    ];
    const resolved = resolveSteps(steps, notificationsForm());
    expect(resolved.map((s) => s.text)).toEqual(steps.map((s) => s.text));
    expect(resolved.map((s) => s.element !== null)).toEqual([true, false, false]);
  });
});

describe('accessibleName', () => {
  it('prefers aria-label, then aria-labelledby, then a bound label, then placeholder', () => {
    const root = page(
      { tag: 'span', attrs: { id: 'lbl' }, text: 'From labelledby' },
      { tag: 'label', attrs: { for: 'x' }, text: 'From label' },
      { tag: 'input', attrs: { id: 'x', 'aria-labelledby': 'lbl', placeholder: 'From placeholder' } },
    );
    const input = root.nodes[2]!;
    expect(accessibleName(input, root)).toBe('From labelledby');
  });

  it('returns null rather than inventing a name', () => {
    const root = page({ tag: 'input', attrs: { name: 'x' } });
    expect(accessibleName(root.nodes[0]!, root)).toBeNull();
  });
});
