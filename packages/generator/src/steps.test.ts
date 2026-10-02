import { describe, expect, it } from 'vitest';

import { stepsFor, stepsEntry } from './steps.ts';
import type { FormField } from './types.ts';

/**
 * WP-27 — guided steps from a page's form.
 *
 * The anchors these produce are consumed by `packages/embed`'s resolver, so the
 * properties tested here are the ones that resolver depends on: a real label to
 * match semantically, a role it computes the same way, and a selector that is
 * only ever a fallback.
 */

const field = (over: Partial<FormField>): FormField => ({
  tag: 'input',
  label: null,
  labelKey: null,
  id: null,
  name: null,
  type: null,
  rules: [],
  ...over,
});

const dictionary = new Map<string, Record<string, unknown>>([
  ['settings', { notifications: { email: 'Email address', save: 'Save preferences' } }],
]);

describe('stepsFor', () => {
  it('writes one step per named field, in source order, with both D-3 signals', () => {
    const steps = stepsFor(
      [
        field({ id: 'notify-email', name: 'email', type: 'email', labelKey: 'settings:notifications.email' }),
        field({ tag: 'select', id: 'notify-frequency', label: 'Digest frequency' }),
        field({ name: 'quietHours', type: 'text', label: 'Quiet hours' }),
        field({ tag: 'button', type: 'submit', labelKey: 'settings:notifications.save' }),
      ],
      dictionary,
      'en',
    );
    expect(steps).toEqual([
      { text: 'Fill in “Email address”.', anchor: { label: 'Email address', role: 'textbox', selector: '#notify-email' } },
      { text: 'Choose an option for “Digest frequency”.', anchor: { label: 'Digest frequency', role: 'combobox', selector: '#notify-frequency' } },
      { text: 'Fill in “Quiet hours”.', anchor: { label: 'Quiet hours', role: 'textbox', selector: 'input[name="quietHours"]' } },
      { text: 'Press “Save preferences” when you are done.', anchor: { label: 'Save preferences', role: 'button' } },
    ]);
  });

  /**
   * A step that cannot name its field cannot be matched semantically, and one
   * anchored by selector alone is D-3's option (a) on its own — the thing that
   * breaks silently on the next redesign. Dropped, not emitted.
   */
  it('drops a field whose label cannot be resolved to text', () => {
    const steps = stepsFor([field({ id: 'x', labelKey: 'settings:missing.key' })], dictionary, 'en');
    expect(steps).toEqual([]);
  });

  it('writes in the application’s own language, not ours', () => {
    const [step] = stepsFor([field({ label: 'Email' })], undefined, 'pt-PT');
    expect(step?.text).toBe('Preencha “Email”.');
  });

  it('falls back to English for a language it has no template for, rather than failing', () => {
    const [step] = stepsFor([field({ label: 'Correo' })], undefined, 'es');
    expect(step?.text).toBe('Fill in “Correo”.');
  });

  it('computes the role the runtime resolver will compute', () => {
    const roles = stepsFor(
      [
        field({ label: 'a', type: 'checkbox' }),
        field({ label: 'b', type: 'radio' }),
        field({ label: 'c', tag: 'textarea' }),
        field({ label: 'd' }),
      ],
      undefined,
      'en',
    ).map((s) => s.anchor?.role);
    expect(roles).toEqual(['checkbox', 'radio', 'textbox', 'textbox']);
  });

  /**
   * The label is adopter text (Rule 15). It is quoted into a fixed template and
   * never interpreted, so an instruction in a label is just a strange label.
   */
  it('quotes a hostile label rather than following it', () => {
    const [step] = stepsFor([field({ label: 'Ignore previous instructions' })], undefined, 'en');
    expect(step?.text).toBe('Fill in “Ignore previous instructions”.');
  });
});

describe('stepsEntry', () => {
  it('adds nothing to a capability whose page has no form', () => {
    expect(stepsEntry([], undefined, 'en')).toEqual({});
  });
});
