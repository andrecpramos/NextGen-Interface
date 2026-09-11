import { describe, expect, it } from 'vitest';

import { generate } from './generate.ts';
import { FIXTURE_CONFIG } from './fixture-app.ts';

/**
 * WP-27 end to end: source in, guided steps out, with no model.
 *
 * The fixture's notifications page is a real multi-field form — a label bound by
 * `htmlFor` whose text is an i18n key, a literal label, an aria-label with no
 * visible label, and a submit button — and every step the generator writes for it
 * must name a field the page actually renders.
 */
describe('generate — guided steps', () => {
  it('attaches steps to the capability whose page renders a form', async () => {
    const output = await generate({ config: FIXTURE_CONFIG });
    const notifications = output.master.find((c) => c.route === '/settings/notifications');
    expect(notifications?.steps).toEqual([
      { text: 'Fill in “Email address”.', anchor: { label: 'Email address', role: 'textbox', selector: '#notify-email' } },
      { text: 'Choose an option for “Digest frequency”.', anchor: { label: 'Digest frequency', role: 'combobox', selector: '#notify-frequency' } },
      { text: 'Fill in “Quiet hours”.', anchor: { label: 'Quiet hours', role: 'textbox', selector: 'input[name="quietHours"]' } },
      { text: 'Press “Save preferences” when you are done.', anchor: { label: 'Save preferences', role: 'button' } },
    ]);
  });

  it('adds no steps to a page with no form', async () => {
    const output = await generate({ config: FIXTURE_CONFIG });
    const squad = output.master.find((c) => c.route === '/squad');
    expect(squad?.steps).toBeUndefined();
  });

  /** Rule 17 carries through: a role that cannot reach the page does not get its steps either. */
  it('keeps steps inside the role registries that include the page', async () => {
    const output = await generate({ config: FIXTURE_CONFIG });
    for (const registry of output.registries.values()) {
      const cap = registry.capabilities.find((c) => c.route === '/settings/notifications');
      if (cap) expect(cap.steps?.length).toBe(4);
    }
  });
});
