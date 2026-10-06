import { describe, expect, it } from 'vitest';

import { defineBoundary, defineCapability, defineRegistry } from './define.ts';
import { validateRegistry } from './validate.ts';
import type { GuidedStep } from './types.ts';

/**
 * What the validator requires of guided steps.
 *
 * Two properties: a step's text is what a user gets when its
 * anchor cannot be found, so it is mandatory; and an anchor that is only a CSS
 * selector is option (a) on its own, which breaks silently on a redesign.
 */

const ex = (n: number) => Array.from({ length: n }, (_, i) => `example ${i + 1}`);

const withSteps = (steps: readonly GuidedStep[]) =>
  defineRegistry({
    domainDescription: 'A club application. It shows squads and settings.',
    capabilities: [
      defineCapability({
        id: 'settings.notifications', kind: 'navigate', route: '/settings/notifications',
        title: 'Notifications', description: 'Choose which emails and messages this account receives',
        explanation: 'Where you choose which emails and push messages this account receives.',
        explanationSource: 'features/settings/pages/NotificationsPage.tsx',
        steps, examples: ex(3),
      }),
    ],
  });

const rules = (steps: readonly GuidedStep[]) => validateRegistry(withSteps(steps)).issues.map((i) => i.rule);

describe('validateRegistry — guided steps', () => {
  it('accepts a step with text and a semantic anchor', () => {
    const result = validateRegistry(
      withSteps([{ text: 'Fill in “Email address”.', anchor: { label: 'Email address', role: 'textbox', selector: '#notify-email' } }]),
    );
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.rule.startsWith('step'))).toEqual([]);
  });

  it('errors on a step with no text — a highlight with no instruction', () => {
    expect(rules([{ text: '  ', anchor: { label: 'Email address' } }])).toContain('step-text-required');
  });

  it('warns on a selector-only anchor', () => {
    expect(rules([{ text: 'Fill it in.', anchor: { selector: '#notify-email' } }])).toContain('step-anchor-selector-only');
  });

  it('warns on an anchor with nothing to match', () => {
    expect(rules([{ text: 'Fill it in.', anchor: { role: 'textbox' } }])).toContain('step-anchor-empty');
  });

  it('accepts a step with no anchor at all — text-only guidance is legitimate', () => {
    expect(rules([{ text: 'Read the page before changing anything.' }]).filter((r) => r.startsWith('step'))).toEqual([]);
  });

  it('errors on steps attached to a declared limit, which has no page', () => {
    const registry = defineRegistry({
      domainDescription: 'A club application.',
      capabilities: [
        { ...defineBoundary({
          id: 'unsupported.payments', title: 'Paying anything', description: 'Paying an invoice or a fee',
          examples: ex(3), refusal: 'I cannot pay anything.',
        }), steps: [{ text: 'Pay here.' }] },
      ],
    });
    expect(validateRegistry(registry).issues.map((i) => i.rule)).toContain('steps-on-boundary');
  });
});
