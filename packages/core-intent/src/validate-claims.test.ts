import { describe, expect, it } from 'vitest';

import { validateClaims } from './validate-claims.ts';
import type { Registry } from './types.ts';

/**
 * ADR-019 (WP-53). The table the ADR itself writes down, each row its own test:
 *
 *   a route in this role's registry           -> kept
 *   a route NOT in this role's registry        -> that sentence dropped
 *   a claim to have done/saved/sent/changed    -> dropped
 *   a number the visitor would act on          -> dropped
 *
 * Plus the Stop-if this exists to guard against: an ordinary, safe, DESCRIPTIVE sentence
 * must survive. Every false-positive case below is a sentence a model could plausibly
 * write about a real screen, checked because it was the kind of sentence a cruder
 * detector would have wrongly stripped.
 */

const fakeRegistry = (routes: readonly string[]): Registry =>
  ({
    capabilities: routes.map((route, i) => ({ id: `cap.${i}`, route, kind: 'navigate', title: route })),
  }) as unknown as Registry;

describe('validateClaims — kept', () => {
  it('keeps a sentence naming a route that is in this role registry', () => {
    const registry = fakeRegistry(['/settings']);
    const result = validateClaims('You can change that on /settings.', registry);
    expect(result.text).toBe('You can change that on /settings.');
    expect(result.removed).toEqual([]);
  });

  it('keeps prose with no route, no action claim and no number at all', () => {
    const registry = fakeRegistry(['/settings']);
    const result = validateClaims('This screen is about your notification preferences.', registry);
    expect(result.text).toBe('This screen is about your notification preferences.');
    expect(result.removed).toEqual([]);
  });

  it('joins multiple safe sentences back together', () => {
    const registry = fakeRegistry(['/settings', '/squad']);
    const result = validateClaims('Go to /settings for that. Or check /squad instead.', registry);
    expect(result.text).toBe('Go to /settings for that. Or check /squad instead.');
  });
});

describe('validateClaims — an unknown route is dropped', () => {
  it('drops a sentence naming a route that is not in this role registry', () => {
    const registry = fakeRegistry(['/settings']);
    const result = validateClaims('Try /admin/billing for that.', registry);
    expect(result.text).toBeNull();
    expect(result.removed).toEqual([{ sentence: 'Try /admin/billing for that.', reason: 'unknown-reference' }]);
  });

  it('drops only the offending sentence, keeps the rest', () => {
    const registry = fakeRegistry(['/settings']);
    const result = validateClaims('You can do that on /settings. Also try /admin/billing.', registry);
    expect(result.text).toBe('You can do that on /settings.');
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.reason).toBe('unknown-reference');
  });

  it('does not flag a KNOWN route that happens to contain digits', () => {
    const registry = fakeRegistry(['/squad/teams/2']);
    const result = validateClaims('That team is at /squad/teams/2.', registry);
    expect(result.text).toBe('That team is at /squad/teams/2.');
    expect(result.removed).toEqual([]);
  });
});

describe('validateClaims — an action claim is dropped', () => {
  const registry = fakeRegistry(['/settings']);

  it.each([
    "I've booked the appointment for you.",
    'I have scheduled that for tomorrow.',
    'I just sent the message.',
    'I already cancelled it.',
    'It has been saved.',
    'The request was already sent — it has been submitted.',
    'Done.',
    'All set.',
    'Marquei a consulta para si.',
    'Já enviei a mensagem.',
    'Foi cancelado com sucesso.',
    'Feito.',
  ])('drops %j', (sentence) => {
    const result = validateClaims(sentence, registry);
    expect(result.text).toBeNull();
    expect(result.removed[0]!.reason).toBe('action-claim');
  });

  it('does not flag ordinary descriptive sentences that share a word with the claim list', () => {
    // Every one of these is a plausible, SAFE thing to say about a screen, and every one
    // shares a bare word with the qualified-EN list. This is the false-positive class the
    // qualifying-frame requirement exists to rule out.
    const safe = [
      'This screen is called Settings.',
      'It shows recently added players.',
      'The list is updated automatically as new games are played.',
      'You can see who has changed the roster.',
      'Messages sent by the coach appear here.',
      'This is where cancelled bookings are listed.',
    ];
    for (const sentence of safe) {
      const result = validateClaims(sentence, registry);
      expect(result.removed).toEqual([]);
      expect(result.text).toBe(sentence);
    }
  });
});

describe('validateClaims — a bare number is dropped (Rule 2)', () => {
  const registry = fakeRegistry(['/notifications']);

  it('drops a sentence stating a figure the model has no way to know', () => {
    const result = validateClaims('You have 5 unread notifications.', registry);
    expect(result.text).toBeNull();
    expect(result.removed[0]!.reason).toBe('unverifiable-number');
  });

  it('does not flag a number that is part of an already-known route', () => {
    const registry2 = fakeRegistry(['/squad/teams/2']);
    const result = validateClaims('Open /squad/teams/2 to see it.', registry2);
    expect(result.removed).toEqual([]);
  });
});

describe('validateClaims — degradation', () => {
  const registry = fakeRegistry(['/settings']);

  it('returns null text when every sentence is removed', () => {
    const result = validateClaims('I already booked it. Try /admin/billing too.', registry);
    expect(result.text).toBeNull();
    expect(result.removed).toHaveLength(2);
  });

  it('returns null text and no removals for empty prose', () => {
    const result = validateClaims('', registry);
    expect(result.text).toBeNull();
    expect(result.removed).toEqual([]);
  });

  it('returns null text for whitespace-only prose', () => {
    const result = validateClaims('   \n  ', registry);
    expect(result.text).toBeNull();
  });

  it('checks a sentence with no terminal punctuation at all', () => {
    const result = validateClaims('Head to /settings', registry);
    expect(result.text).toBe('Head to /settings');
  });
});

describe('validateClaims — order of checks', () => {
  it('reports unknown-reference over action-claim when a sentence trips both', () => {
    const registry = fakeRegistry(['/settings']);
    const result = validateClaims('I already booked /admin/billing for you.', registry);
    expect(result.removed[0]!.reason).toBe('unknown-reference');
  });
});
