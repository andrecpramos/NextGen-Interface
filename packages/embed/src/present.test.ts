import { describe, expect, it } from 'vitest';

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import type { Smalltalk } from './chat.ts';
import { attachmentView, displayLanguage, fillParams, inLanguage, isSamePlace, present, safeRoute, searchChoice, smalltalkView, WORDS, wordsFor, type Choice } from './present.ts';

/**
 * The script tag's policy for one turn: what it says, and whether it moves.
 * Every case here is one where moving, or acting, would be wrong.
 */

const caps = [
  { id: 'calendar.overview', kind: 'navigate', route: '/calendar', title: 'Calendar', explanation: 'Training and matches by day.' },
  { id: 'child.medical', kind: 'navigate', route: '/my/children/:childId/medical', title: 'Medical', explanation: 'Your child’s medical record.' },
  { id: 'child.development', kind: 'navigate', route: '/my/children/:childId/development', title: 'Development', explanation: 'Progress over time.' },
  { id: 'squad.search', kind: 'read', route: '/squad', title: 'Squad', explanation: 'Every player.' },
  { id: 'module.delete', kind: 'destructive', route: '/modules', title: 'Delete a module', explanation: 'Removes a module.' },
  { id: 'unsupported.payments', kind: 'unsupported', route: null, title: 'Payments', refusal: 'I can’t move money for you.' },
];

const registry = {
  capabilities: caps,
  byId: new Map(caps.map((c) => [c.id, c])),
  boundaryIds: new Set(['unsupported.payments']),
} as unknown as Registry;

const trace = (over: Partial<TurnTrace>): TurnTrace =>
  ({
    outcome: 'execute',
    capabilityId: null,
    candidates: [],
    explanationRequest: false,
    ...over,
  }) as TurnTrace;

const words = WORDS.en;

describe('present — when it moves the browser', () => {
  it('moves for an executed navigate turn, and says where — nothing more (ADR-030)', () => {
    const view = present(trace({ capabilityId: 'calendar.overview' }), registry, '/', words);
    expect(view).toMatchObject({ tone: 'go', destination: '/calendar', body: null });
    expect(view.title).toBe('Opening Calendar');
  });

  it('does not move when the user asked what a screen is (WP-36)', () => {
    const view = present(trace({ capabilityId: 'calendar.overview', explanationRequest: true }), registry, '/', words);
    expect(view.destination).toBeNull();
    expect(view.choices).toEqual([{ label: 'Open Calendar', route: '/calendar' }]);
  });

  it('does not move to where the user already is', () => {
    const view = present(trace({ capabilityId: 'calendar.overview' }), registry, '/calendar/', words);
    expect(view.destination).toBeNull();
    expect(view.title).toBe('You’re on Calendar');
    expect(view.body).toBeNull();
  });

  it('never performs a read, write or destructive capability: there is no dispatcher here', () => {
    for (const id of ['squad.search', 'module.delete']) {
      const view = present(trace({ capabilityId: id }), registry, '/', words);
      expect(view.destination).toBeNull();
      expect(view.tone).toBe('explain');
    }
  });
});

describe('present — routes with parameters', () => {
  it('fills a parameter from the page the user is on', () => {
    const view = present(trace({ capabilityId: 'child.medical' }), registry, '/my/children/42/development', words);
    expect(view.destination).toBe('/my/children/42/medical');
  });

  it('refuses to guess a parameter the current page does not carry', () => {
    const view = present(trace({ capabilityId: 'child.medical' }), registry, '/calendar', words);
    expect(view.destination).toBeNull();
    expect(view.body).toBe(words.needsItem);
    expect(view.choices).toEqual([]);
  });

  // The locale prefix of an i18n router (next-intl `[locale]`): the scanner leaves it in the route and out of
  // the slots, on the promise that the widget fills it from the page the visitor is on.
  it('fills a locale prefix from any page of a locale-routed app', () => {
    const patterns = ['/:locale', '/:locale/portal', '/:locale/auth/login'];
    expect(fillParams('/:locale/auth/login', '/pt/portal', patterns)).toBe('/pt/auth/login');
    expect(fillParams('/:locale/portal', '/en', patterns)).toBe('/en/portal');
    expect(fillParams('/:locale', '/pt/auth/login', patterns)).toBe('/pt');
  });

  it('cannot fill it from a page that has no locale, and says so rather than guessing, when the page offers no hint', () => {
    expect(fillParams('/:locale/auth/login', '/', ['/:locale', '/:locale/auth/login'])).toBeNull();
  });

  // localePrefix "as-needed": the default language has no prefix, so its pages carry no locale in the URL.
  // The page's own language (`<html lang>`, which next-intl sets to the locale) is the next best evidence.
  it('falls back to the page’s own language for a locale, when the URL carries none', () => {
    const patterns = ['/:locale', '/:locale/auth/login'];
    expect(fillParams('/:locale/auth/login', '/', patterns, { locale: 'pt' })).toBe('/pt/auth/login');
    expect(fillParams('/:locale/auth/login', '/auth/login', patterns, { locale: 'pt' })).toBe('/pt/auth/login');
  });

  it('prefers what the URL says to what the page’s language guesses', () => {
    const patterns = ['/:locale/portal', '/:locale/auth/login'];
    expect(fillParams('/:locale/auth/login', '/en/portal', patterns, { locale: 'pt' })).toBe('/en/auth/login');
  });

  it('never lends that hint to a parameter that picks an item', () => {
    expect(fillParams('/players/:id', '/', ['/players/:id'], { locale: 'pt' })).toBeNull();
    expect(fillParams('/:locale/players/:id', '/', ['/:locale/players/:id'], { locale: 'pt' })).toBeNull();
  });

  it('drops an optional parameter it does not know, and keeps a plain route as it is', () => {
    expect(fillParams('/reports/:id?', '/', [])).toBe('/reports');
    expect(fillParams('/calendar', '/anything', [])).toBe('/calendar');
    expect(fillParams(null, '/', [])).toBeNull();
  });
});

describe('present — clarify and refuse', () => {
  it('offers the ranked screens as links, never a declared limit', () => {
    const view = present(
      trace({
        outcome: 'clarify',
        candidates: [
          { capabilityId: 'unsupported.payments', score: 0.9 },
          { capabilityId: 'calendar.overview', score: 0.5 },
          { capabilityId: 'squad.search', score: 0.4 },
        ],
      }),
      registry,
      '/',
      words,
    );
    expect(view.tone).toBe('choose');
    expect(view.destination).toBeNull();
    expect(view.choices).toEqual([
      { label: 'Calendar', route: '/calendar', detail: 'Training and matches by day.' },
      { label: 'Squad', route: '/squad', detail: 'Every player.' },
    ]);
  });

  it('states a declared limit in the registry’s own words, as a limit rather than an error', () => {
    const view = present(trace({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments' }), registry, '/', words);
    expect(view).toMatchObject({ tone: 'limit', body: 'I can’t move money for you.', destination: null });
  });

  it('falls back to a general limit when no boundary was named', () => {
    expect(present(trace({ outcome: 'out_of_scope' }), registry, '/', words).body).toBe(words.limitFallback);
  });

  it('says it went wrong, and moves nothing, on an error', () => {
    expect(present(trace({ outcome: 'error' }), registry, '/', words)).toMatchObject({ tone: 'unsure', destination: null });
  });
});

/**
 * The assistant helps; it does not act (2026-09-22). A refusal no longer has to end at "no": a limit can
 * point to where the visitor can do it themselves — where the adopter said, or, for a limit about acting,
 * the screen the request is plainly about. Nothing is performed; the visitor still taps.
 */
describe('present — a limit that helps', () => {
  const settings = { id: 'settings.notifications', kind: 'navigate', route: '/settings/notifications', title: 'Notification settings', explanation: 'Choose which messages you get, and how.' };
  const invoices = { id: 'billing.invoices', kind: 'navigate', route: '/billing', title: 'Invoices', explanation: 'Every invoice and when it is due.' };
  const acting = { id: 'unsupported.data_changes', kind: 'unsupported', route: null, title: 'Changing records for you', refusal: 'I don’t change records myself.', refuses: 'action' };
  const fees = { id: 'unsupported.declared.fees', kind: 'unsupported', route: null, title: 'Paying fees', refusal: 'Fees are paid at the office.', helpAt: ['/billing'] };
  const all = [...caps, settings, invoices, acting, fees];
  const helped = {
    capabilities: all,
    byId: new Map(all.map((c) => [c.id, c])),
    boundaryIds: new Set(['unsupported.payments', acting.id, fees.id]),
  } as unknown as Registry;

  it('points to where the adopter said the visitor can get help, beneath their own refusal', () => {
    const view = present(trace({ outcome: 'out_of_scope', capabilityId: fees.id }), helped, '/', words);
    expect(view).toMatchObject({ tone: 'limit', title: words.limitDoTitle, destination: null });
    expect(view.body).toBe(`Fees are paid at the office. ${words.limitHelpHere}`);
    expect(view.choices).toEqual([{ label: 'Invoices', route: '/billing', detail: 'Every invoice and when it is due.' }]);
  });

  it('for a limit about acting, offers the screen the request is plainly about, to do it there themselves', () => {
    const asked = trace({ outcome: 'out_of_scope', capabilityId: acting.id, candidates: [{ capabilityId: settings.id, score: 0.34 }, { capabilityId: 'calendar.overview', score: 0.05 }] });
    const view = present(asked, helped, '/', words);
    expect(view).toMatchObject({ tone: 'limit', title: words.limitDoTitle, destination: null });
    expect(view.body).toBe(`I don’t change records myself. ${words.limitDoHere}`);
    expect(view.choices.map((c) => c.route)).toEqual(['/settings/notifications']);
  });

  it('offers nothing when no screen is a plain match — a wrong "do it here" is worse than a plain refusal', () => {
    const asked = trace({ outcome: 'out_of_scope', capabilityId: acting.id, candidates: [{ capabilityId: settings.id, score: 0.08 }] });
    const view = present(asked, helped, '/', words);
    expect(view).toMatchObject({ title: words.limitTitle, body: 'I don’t change records myself.', choices: [] });
  });

  it('never offers a screen for a limit about a subject from retrieval alone, however well it scores', () => {
    const asked = trace({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments', candidates: [{ capabilityId: 'calendar.overview', score: 0.6 }] });
    expect(present(asked, helped, '/', words).choices).toEqual([]);
  });

  it('never offers another limit, nor the page the visitor is already on', () => {
    const asked = trace({ outcome: 'out_of_scope', capabilityId: acting.id, candidates: [{ capabilityId: fees.id, score: 0.9 }, { capabilityId: settings.id, score: 0.4 }] });
    expect(present(asked, helped, '/', words).choices.map((c) => c.route)).toEqual(['/settings/notifications']);
    expect(present(asked, helped, '/settings/notifications', words).choices).toEqual([]);
  });
});

/**
 * When the router will not act but one screen is plainly ahead, a menu of equals is the wrong
 * answer: it makes the visitor do the ranking the router already did. So the answer is one question
 * about the leader, with what the screen is for (ADR-026) — and never executed, because a
 * suggestion costs one tap (or a "yes") when it is wrong and a move costs a page.
 */
/**
 * Rule 20 (ADR-041): asked to change something, the assistant says it can't do it for them and offers the
 * screen where it is handled. A link the visitor takes — never a move, whatever `decide` says.
 */
describe('present — a request to change something', () => {
  const change = (over: Partial<TurnTrace>): TurnTrace =>
    trace({ outcome: 'out_of_scope', capabilityId: 'calendar.overview', changeRequest: true, ...over });

  it('says it cannot do it for them, and offers the screen as a link, without moving', () => {
    const view = present(change({}), registry, '/', words);
    expect(view).toMatchObject({ tone: 'limit', title: words.limitDoTitle, body: words.limitHelpHere, destination: null });
    expect(view.choices).toEqual([{ label: 'Calendar', route: '/calendar', detail: 'Training and matches by day.' }]);
  });

  it('says it is handled here when they are already on that screen — never a dead end', () => {
    const view = present(change({}), registry, '/calendar', words);
    expect(view).toMatchObject({ tone: 'limit', title: words.limitDoTitle, body: words.limitHandledHere, choices: [] });
  });

  it('offers the list an item screen is reached from, when the page names no item', () => {
    const view = present(change({ capabilityId: 'child.medical' }), registry, '/', words);
    expect(view.destination).toBeNull();
    expect(view.choices.length).toBeLessThanOrEqual(1);
  });

  it('asks as a limit, not "you probably want", when the router was not sure — and never moves, even eager', () => {
    const unsure = trace({
      outcome: 'clarify',
      changeRequest: true,
      candidates: [{ capabilityId: 'calendar.overview', score: 0.6 }, { capabilityId: 'squad.search', score: 0.05 }],
    });
    for (const decide of ['balanced', 'eager'] as const) {
      const view = present(unsure, registry, '/', words, [], {}, decide);
      expect(view).toMatchObject({ tone: 'limit', title: words.limitDoTitle, destination: null });
      expect(view.choices[0]?.route).toBe('/calendar');
    }
  });
});

describe('present — keyboard mashing (ADR-039)', () => {
  it('says it did not catch that, and offers places to begin — never a refusal, never a move', () => {
    const view = present(trace({ outcome: 'clarify', mashing: true }), registry, '/', words);
    expect(view).toMatchObject({ tone: 'unsure', title: words.mashed, destination: null });
    expect(view.choices.length).toBeGreaterThan(0);
  });
});

describe('present — a clear leader', () => {
  const clarify = (candidates: { capabilityId: string; score: number }[], path = '/', w = words) =>
    present(trace({ outcome: 'clarify', candidates }), registry, path, w);

  it('asks about the one it thinks you mean when one is clearly ahead, with what that screen is for — and nothing else', () => {
    const view = clarify([
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'squad.search', score: 0.12 },
    ]);
    expect(view).toMatchObject({ tone: 'choose', probable: true, destination: null, title: 'Looking for Calendar?' });
    expect(view.choices).toEqual([{ label: 'Calendar', route: '/calendar', detail: 'Training and matches by day.' }]);
  });

  it('never moves the browser, whatever the margin', () => {
    expect(clarify([{ capabilityId: 'calendar.overview', score: 0.9 }]).destination).toBeNull();
  });

  it('keeps asking when two are close: a tie is a real question', () => {
    const view = clarify([
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'squad.search', score: 0.25 },
    ]);
    expect(view.probable).toBeUndefined();
    expect(view.choices).toHaveLength(2);
    expect(view.title).toBe(words.eitherOr(view.choices[0]!.label, view.choices[1]!.label));
  });

  it('keeps asking when the best is barely a match at all', () => {
    expect(clarify([{ capabilityId: 'calendar.overview', score: 0.1 }, { capabilityId: 'squad.search', score: 0.02 }]).probable).toBeUndefined();
  });

  it('keeps asking when a declared limit is close behind: the request may be out of scope', () => {
    const view = clarify([
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'unsupported.payments', score: 0.25 },
    ]);
    expect(view.probable).toBeUndefined();
  });

  it('does not call a screen the likely one when it is not the one it can offer', () => {
    // The leader needs an item the page cannot supply, so what is offered first is not the leader.
    const view = clarify([
      { capabilityId: 'child.development', score: 0.4 },
      { capabilityId: 'calendar.overview', score: 0.1 },
    ]);
    expect(view.probable).toBeUndefined();
    expect(view.choices.map((c) => c.label)).toEqual(['Calendar']);
    // …but it is still asked about, as one question, not offered as a list of one.
    expect(view.title).toBe(words.probably('Calendar'));
  });

  it('keeps what the model wrote as the body beneath the question, over any fixed wording', () => {
    const prose = 'I found a couple of things close to that.';
    const lead = present(
      trace({ outcome: 'clarify', prose, candidates: [{ capabilityId: 'calendar.overview', score: 0.5 }, { capabilityId: 'squad.search', score: 0.1 }] }),
      registry,
      '/',
      words,
    );
    expect(lead).toMatchObject({ title: words.probably('Calendar'), body: prose });
    const tie = present(
      trace({ outcome: 'clarify', prose, candidates: [{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.search', score: 0.25 }] }),
      registry,
      '/',
      words,
    );
    expect(tie.body).toBe(prose);
    expect(tie.choices).toHaveLength(2);
  });

  it('a lone candidate above the floor is the likely one', () => {
    expect(clarify([{ capabilityId: 'calendar.overview', score: 0.2 }]).probable).toBe(true);
  });

  it('gives a screen’s purpose as its first sentence only, and never an essay', () => {
    const long = { id: 'x.long', kind: 'navigate', route: '/long', title: 'Long', explanation: 'First sentence here. A second one that must not appear.' };
    const essay = { id: 'x.essay', kind: 'navigate', route: '/essay', title: 'Essay', explanation: `${'palavra '.repeat(40)}fim.` };
    const bare = { id: 'x.bare', kind: 'navigate', route: '/bare', title: 'Bare' };
    const reg = { capabilities: [long, essay, bare], byId: new Map([long, essay, bare].map((c) => [c.id, c])), boundaryIds: new Set() } as unknown as Registry;
    const detailOf = (id: string) => present(trace({ outcome: 'clarify', candidates: [{ capabilityId: id, score: 0.4 }] }), reg, '/', words).choices[0]!;
    expect(detailOf('x.long').detail).toBe('First sentence here.');
    expect(detailOf('x.essay').detail!.length).toBeLessThanOrEqual(91);
    expect(detailOf('x.essay').detail!.endsWith('…')).toBe(true);
    expect('detail' in detailOf('x.bare')).toBe(false);
  });

  it('says it in the page’s language', () => {
    const view = clarify([{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.search', score: 0.1 }], '/', WORDS.pt);
    expect(view.title).toBe('Procura Calendar?');
    expect(WORDS.pt.eitherOr('A', 'B')).toBe('A ou B?');
  });
});

/**
 * The visitor is assumed to know nothing about the app: asking "make an appointment" is asking
 * *where*, and three unexplained names are a quiz. So an answer that asks is short (a likely one and
 * at most one other — measured on the reference app, the right screen is among the first two 21 times
 * in 21), and every name comes with what it is for, so the two can be told apart by someone who has
 * never seen either.
 */
describe('present — few options, each explained', () => {
  const many = [
    { capabilityId: 'calendar.overview', score: 0.3 },
    { capabilityId: 'squad.search', score: 0.25 },
    { capabilityId: 'child.development', score: 0.2 },
    { capabilityId: 'module.delete', score: 0.19 },
  ];
  const ask = (utterance: string, candidates = many, over: Partial<TurnTrace> = {}, w = words) =>
    present(trace({ outcome: 'clarify', utterance, candidates, ...over }), registry, '/my/children/42/development', w);

  it('offers at most two places, however many candidates there were — and one when one is plainly ahead', () => {
    expect(ask('something').choices).toHaveLength(2);
    const leading = ask('something', [{ capabilityId: 'calendar.overview', score: 0.9 }, ...many.slice(1)]);
    expect(leading.probable).toBe(true);
    expect(leading.choices).toHaveLength(1);
  });

  it('says what every offered screen is for, so a stranger can tell them apart', () => {
    for (const choice of ask('something').choices) expect(choice.detail, choice.label).toBeTruthy();
  });

  it('leaves out a purpose the app did not declare, rather than inventing one', () => {
    const bare = { id: 'x.bare', kind: 'navigate', route: '/bare', title: 'Bare' };
    const reg = { capabilities: [bare], byId: new Map([[bare.id, bare]]), boundaryIds: new Set() } as unknown as Registry;
    const view = present(trace({ outcome: 'clarify', candidates: [{ capabilityId: 'x.bare', score: 0.2 }] }), reg, '/', words);
    expect('detail' in view.choices[0]!).toBe(false);
  });

  it('a tie is one question naming both places — "this, or that?" — not a list to rank', () => {
    const view = ask('something');
    expect(view.probable).toBeUndefined();
    const [a, b] = view.choices.map((c) => c.label);
    expect(view.title).toBe(words.eitherOr(a!, b!));
    expect(view.title).toContain(a!);
    expect(view.title).toContain(b!);
    expect(view.title.endsWith('?')).toBe(true);
  });

  it('a single place is asked about, not offered as a choice between things', () => {
    const view = ask('something', [{ capabilityId: 'calendar.overview', score: 0.1 }]);
    expect(view.choices).toHaveLength(1);
    expect(view.title).toBe(words.probably('Calendar'));
  });

  it('when what was asked is a task, it says the task can be done there', () => {
    const lead = [{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.search', score: 0.1 }];
    const task = ask('I want to book a training', lead);
    expect(task.probable).toBe(true);
    expect(task.title).toBe(words.probablyTask('Calendar'));
    // …and asking where something is keeps the plain wording.
    expect(ask('where is the calendar', lead).title).toBe(words.probably('Calendar'));
  });

  it('does not say a task can be done when it is not sure which screen it is', () => {
    const view = ask('I want to book a training');
    expect(view.title).toBe(words.eitherOr(view.choices[0]!.label, view.choices[1]!.label));
  });

  it('has the words for it in both languages, each a question', () => {
    for (const w of [WORDS.en, WORDS.pt]) {
      expect(w.eitherOr('X', 'Y')).toMatch(/X.*Y.*\?$/);
      expect(w.probably('X')).toMatch(/X.*\?$/);
      expect(w.probablyTask('X')).toMatch(/X.*\?$/);
    }
    expect(WORDS.pt.probably('X')).not.toBe(WORDS.en.probably('X'));
  });
});

/**
 * A photo or a file sent with, or instead of, words. Nothing about it reaches the router: the assistant
 * cannot read it and says so — kindly, and with a way forward, because "I can't help with that" to a
 * visitor holding a photo of the thing they need help with is a dead end.
 */
describe('attachments — what the assistant says, and never says', () => {
  it('says something in both languages for every case, in words that are not the refusal', () => {
    for (const w of [WORDS.en, WORDS.pt]) {
      for (const handed of [true, false]) {
        const view = attachmentView(handed, w);
        expect(view.tone).toBe('chat');
        expect(view.title).toBeTruthy();
        expect(view.body).toBeTruthy();
        expect(`${view.title} ${view.body}`).not.toContain(w.limitTitle);
        expect(view.destination).toBeNull();
        expect(view.choices).toEqual([]);
      }
    }
  });

  it('says it passed them to the app only when the app took them', () => {
    expect(attachmentView(true, words).body).toBe(words.attachHanded);
    expect(attachmentView(false, words).body).toContain('nothing leaves your device');
    expect(WORDS.pt.attachOnly.body).toContain('nada sai do seu dispositivo');
    expect(attachmentView(false, words).body).not.toBe(words.attachHanded);
  });

  it('is honest that it cannot read what was attached, and that it stays on the device', () => {
    expect(words.attachKept).toMatch(/can’t read/);
    expect(words.attachKept).toMatch(/device/);
    expect(WORDS.pt.attachKept).toMatch(/dispositivo/);
  });

  it('tells a visitor why a file was turned away, in a sentence with the real limit in it', () => {
    expect(words.attachTooMany(4)).toContain('4');
    expect(words.attachTooLarge(15)).toContain('15');
    for (const w of [WORDS.en, WORDS.pt]) {
      expect(w.attachUnsupported).toBeTruthy();
      expect(w.attachEmpty).toBeTruthy();
      expect(w.attach).toBeTruthy();
      expect(w.attachCamera).toBeTruthy();
      // Short enough for a phone's row of four buttons and a box.
      expect(w.composerShort.length).toBeLessThanOrEqual(16);
      expect(w.composerShort.length).toBeLessThan(w.composer.length);
      expect(w.attachedFiles(1)).not.toBe(w.attachedFiles(3));
      expect(w.removeFile('a.png')).toContain('a.png');
    }
    expect(WORDS.pt.attachTooMany(4)).not.toBe(words.attachTooMany(4));
  });
});

/**
 * A ranking with no evidence in it is not a suggestion. When nothing the visitor said appears in
 * anything the app says, every screen scores 0 and the "best" two are whichever come first: offering
 * them as "two places could help with that" is a lie told with confidence. Found on a real one-page
 * app, where "quero falar com alguém" was answered with the home page and the privacy policy.
 */
describe('present — nothing matched', () => {
  const nothing = (candidates: { capabilityId: string; score: number }[], starts: Choice[] = []) =>
    present(trace({ outcome: 'clarify', utterance: 'quero falar com alguém', candidates }), registry, '/', words, starts);

  it('does not offer screens that scored nothing as suggestions', () => {
    const view = nothing([
      { capabilityId: 'calendar.overview', score: 0 },
      { capabilityId: 'squad.search', score: 0 },
    ]);
    expect(view.title).toBe(words.unsureHelp);
    expect(view.probable).toBeUndefined();
  });

  it('says so and offers real places to begin, from the page’s own navigation when it has one', () => {
    const starts: Choice[] = [{ label: 'Start', route: '/start', detail: 'Where it begins.' }];
    const view = nothing([{ capabilityId: 'calendar.overview', score: 0 }], starts);
    expect(view.tone).toBe('unsure');
    expect(view.choices).toEqual(starts);
    expect(view.destination).toBeNull();
  });

  it('falls back to the places the registry can open from here when the page has no navigation', () => {
    const view = nothing([{ capabilityId: 'calendar.overview', score: 0 }]);
    expect(view.choices.map((c) => c.route)).toEqual(['/calendar']);
  });

  it('keeps the screens that did match, and drops only the ones that did not', () => {
    const view = nothing([
      { capabilityId: 'calendar.overview', score: 0.12 },
      { capabilityId: 'squad.search', score: 0 },
    ]);
    expect(view.choices.map((c) => c.label)).toEqual(['Calendar']);
    expect(view.title).toBe(words.probably('Calendar'));
  });

  it('is plain "did not understand" when there is nowhere to send them either', () => {
    const empty = { capabilities: [], byId: new Map(), boundaryIds: new Set() } as unknown as Registry;
    const view = present(trace({ outcome: 'clarify', candidates: [] }), empty, '/', words);
    expect(view.title).toBe(words.unsure);
    expect(view.choices).toEqual([]);
  });

  it('says it in both languages', () => {
    for (const w of [WORDS.en, WORDS.pt]) expect(w.unsureHelp).toBeTruthy();
    expect(WORDS.pt.unsureHelp).not.toBe(WORDS.en.unsureHelp);
  });
});

/**
 * Small talk is answered, not routed (chat.ts). "Hi" is not a request this app cannot do, and a
 * visitor told so has learned the assistant is not for them. The reply says what it is for and, when
 * they are lost, offers a few real places to begin.
 */
describe('smalltalkView — a friendly answer that never refuses', () => {
  const view = (kind: Smalltalk, path = '/calendar', w = words) => smalltalkView(kind, registry, path, w);

  it('answers every kind, in both languages, with something to read', () => {
    for (const w of [WORDS.en, WORDS.pt]) {
      for (const kind of ['greeting', 'thanks', 'goodbye', 'howAreYou', 'identity', 'help', 'ok'] as const) {
        const shown = smalltalkView(kind, registry, '/', w);
        expect(shown.title, kind).toBeTruthy();
        expect(shown.tone).toBe('chat');
        expect(shown.destination).toBeNull();
      }
    }
  });

  it('never says it cannot do that, however it is put', () => {
    for (const w of [WORDS.en, WORDS.pt]) {
      for (const kind of ['greeting', 'thanks', 'goodbye', 'howAreYou', 'identity', 'help', 'ok'] as const) {
        const shown = smalltalkView(kind, registry, '/', w);
        expect(`${shown.title} ${shown.body ?? ''}`).not.toContain(w.limitTitle);
      }
    }
  });

  it('a greeting invites, and does not throw a menu at someone who only said hello', () => {
    expect(view('greeting').choices).toEqual([]);
  });

  it('being lost gets a few real places to begin, each with what it is for', () => {
    const shown = view('help', '/');
    expect(shown.choices.length).toBeGreaterThan(0);
    expect(shown.choices.length).toBeLessThanOrEqual(3);
    for (const choice of shown.choices) {
      expect(choice.route).toMatch(/^\//);
      expect(choice.detail, choice.label).toBeTruthy();
    }
    expect(shown.body).toContain(words.helpStart);
  });

  it('begins with the places it is told to when it is told (the app’s own main navigation), at most three', () => {
    const starts = ['/a', '/b', '/c', '/d'].map((route) => ({ label: route.slice(1).toUpperCase(), route, detail: `Purpose of ${route}.` }));
    const shown = smalltalkView('help', registry, '/', words, starts);
    expect(shown.choices.map((c) => c.route)).toEqual(['/a', '/b', '/c']);
    expect(shown.body).toContain(words.helpStart);
    // …and it is only ever used to say what it is for.
    expect(smalltalkView('greeting', registry, '/', words, starts).choices).toEqual([]);
  });

  it('offers only what could be opened from here: no boundary, no item it cannot fill, not this page', () => {
    const labels = view('help', '/calendar').choices.map((c) => c.label);
    expect(labels).not.toContain('Calendar');
    expect(labels).not.toContain('Payments');
    expect(labels).not.toContain('Medical');
  });

  it('does not invite anywhere when the app has nowhere to send them', () => {
    const empty = { capabilities: [], byId: new Map(), boundaryIds: new Set() } as unknown as Registry;
    const shown = smalltalkView('help', empty, '/', words);
    expect(shown.choices).toEqual([]);
    expect(shown.body ?? '').not.toContain(words.helpStart);
  });
});

/**
 * ADR-019 (WP-53). `trace.prose` is the model's answer, already checked by
 * `validateClaims` before this trace existed — `present()`'s only job is to prefer it
 * over the fixed, build-time text when it is there, exactly like every other field on a
 * trace that overrides a default.
 */
describe('present — the model’s validated answer, when there is one', () => {
  it('prefers trace.prose over the declared explanation on an executed turn', () => {
    const view = present(
      trace({ capabilityId: 'calendar.overview', prose: 'Training moved to Tuesday this week.' }),
      registry,
      '/',
      words,
    );
    expect(view.body).toBe('Training moved to Tuesday this week.');
  });

  it('says nothing more than where it is going when prose is null: no stock description (ADR-030)', () => {
    const view = present(trace({ capabilityId: 'calendar.overview', prose: null }), registry, '/', words);
    expect(view.body).toBeNull();
    // Asked what a screen is, the declared explanation is still the answer.
    const asked = present(trace({ capabilityId: 'calendar.overview', prose: null, explanationRequest: true }), registry, '/', words);
    expect(asked.body).toBe('Training and matches by day.');
  });

  it('prefers trace.prose over the declared refusal on a limit', () => {
    const view = present(
      trace({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments', prose: 'This app has no way to move money at all.' }),
      registry,
      '/',
      words,
    );
    expect(view).toMatchObject({ tone: 'limit', body: 'This app has no way to move money at all.' });
  });

  it('carries prose into a choose view, alongside the offered links', () => {
    const view = present(
      trace({
        capabilityId: null,
        prose: 'I found a couple of things close to that.',
        candidates: [{ capabilityId: 'calendar.overview', score: 0.5 }],
      }),
      registry,
      '/',
      words,
    );
    expect(view.tone).toBe('choose');
    expect(view.body).toBe('I found a couple of things close to that.');
    expect(view.choices).toEqual([{ label: 'Calendar', route: '/calendar', detail: 'Training and matches by day.' }]);
  });
});

describe('words', () => {
  it('speaks the page’s language', () => {
    expect(wordsFor('pt-PT')).toBe(WORDS.pt);
    expect(wordsFor('en-GB')).toBe(WORDS.en);
    expect(wordsFor(null)).toBe(WORDS.en);
  });

  it('compares places on the path only', () => {
    expect(isSamePlace('/calendar', '/calendar?week=2')).toBe(true);
    expect(isSamePlace('/calendar', '/squad')).toBe(false);
  });
});

/** The adopter's dial (ADR-027): what is done with the router's decision, never the decision itself. */
describe('present — decide', () => {
  const decided = trace({ capabilityId: 'calendar.overview' });
  const leading = trace({ outcome: 'clarify', candidates: [{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.search', score: 0.1 }] });
  const at = (t: TurnTrace, decide: 'confirm' | 'balanced' | 'eager') => present(t, registry, '/', words, [], {}, decide);

  it('confirm asks before a decided move, offering that one place as the likely one', () => {
    const view = at(decided, 'confirm');
    expect(view).toMatchObject({ tone: 'choose', destination: null, probable: true, title: 'Open Calendar?' });
    expect(view.choices.map((c) => c.route)).toEqual(['/calendar']);
  });

  it('eager takes a plain leader; balanced asks about it', () => {
    expect(at(leading, 'eager')).toMatchObject({ tone: 'go', destination: '/calendar' });
    expect(at(leading, 'balanced')).toMatchObject({ tone: 'choose', destination: null });
  });

  it('leaves a decided move, a limit and an explanation alone under every setting but confirm', () => {
    expect(at(decided, 'eager').destination).toBe('/calendar');
    const limit = trace({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments' });
    for (const decide of ['confirm', 'balanced', 'eager'] as const) expect(at(limit, decide).tone).toBe('limit');
    expect(at(trace({ capabilityId: 'calendar.overview', explanationRequest: true }), 'confirm').tone).toBe('explain');
  });
});

describe('searchChoice', () => {
  it('puts the visitor’s words, encoded, where the template says', () => {
    expect(searchChoice('/search?q={query}', '  Ana  & Porto ', words)).toEqual({ label: 'Search for “Ana & Porto”', route: '/search?q=Ana%20%26%20Porto' });
  });

  it('refuses anything that is not a path on this app with a place for the words', () => {
    for (const template of [undefined, '', 'https://x.test/?q={query}', '//x.test/{query}', '/search', 'search?q={query}']) {
      expect(searchChoice(template, 'x', words), String(template)).toBeNull();
    }
    expect(searchChoice('/search?q={query}', '   ', words)).toBeNull();
  });
});

/**
 * ADR-028: complex apps are mostly screens about one item, and repeat names across areas. A visitor on a
 * page that names no item is offered the list it is chosen from; two screens with one name say where each is.
 */
describe('present — item screens and repeated names', () => {
  const caps2 = [
    { id: 'players.list', kind: 'navigate', route: '/players', title: 'Players', explanation: 'Every player in the club.' },
    { id: 'players.stats', kind: 'navigate', route: '/players/:playerId/stats', title: 'Player stats', explanation: 'One player’s minutes and goals.' },
    { id: 'finance', kind: 'navigate', route: '/finance', title: 'Finance', explanation: 'Money.' },
    { id: 'finance.settings', kind: 'navigate', route: '/finance/settings', title: 'Settings', explanation: 'How invoices are numbered.' },
    { id: 'squad.settings', kind: 'navigate', route: '/squad/settings', title: 'Settings', explanation: 'Squad rules.' },
    { id: 'orphan.item', kind: 'navigate', route: '/orphans/:id', title: 'Orphan', explanation: 'Nothing lists these.' },
  ];
  const reg = { capabilities: caps2, byId: new Map(caps2.map((c) => [c.id, c])), boundaryIds: new Set() } as unknown as Registry;

  it('answers a decided item screen with the list it is chosen from, and what to do there', () => {
    const view = present(trace({ capabilityId: 'players.stats' }), reg, '/', words);
    expect(view.destination).toBeNull();
    expect(view.body).toBe('Open Players and pick one.');
    expect(view.choices).toEqual([{ label: 'Players', route: '/players', detail: 'Pick one to see its Player stats.' }]);
  });

  it('still fills the item when the page names it, and says so plainly when nothing lists it', () => {
    expect(present(trace({ capabilityId: 'players.stats' }), reg, '/players/7/stats', words).title).toBe('You’re on Player stats');
    const orphan = present(trace({ capabilityId: 'orphan.item' }), reg, '/', words);
    expect(orphan.body).toContain(words.needsItem);
    expect(orphan.choices).toEqual([]);
  });

  it('offers the list for an item screen it is asking about, instead of dropping it', () => {
    const view = present(trace({ outcome: 'clarify', candidates: [{ capabilityId: 'players.stats', score: 0.4 }, { capabilityId: 'finance', score: 0.1 }] }), reg, '/', words);
    expect(view.choices[0]).toEqual({ label: 'Players', route: '/players', detail: 'Pick one to see its Player stats.' });
    expect(view.probable).toBe(true);
  });

  it('tells two screens with one name apart by the area each is in', () => {
    const view = present(trace({ outcome: 'clarify', candidates: [{ capabilityId: 'finance.settings', score: 0.3 }, { capabilityId: 'squad.settings', score: 0.28 }] }), reg, '/', words);
    expect(view.choices.map((c) => c.label)).toEqual(['Settings · Finance', 'Settings · Squad']);
    expect(view.title).toBe(words.eitherOr('Settings · Finance', 'Settings · Squad'));
  });
});

/** ADR-029: every destination is a path on this site before it becomes an href or a move. */
describe('safeRoute', () => {
  it('lets a path on this site through, query and hash included', () => {
    for (const route of ['/', '/players', '/players/42/stats?tab=a#top', '/pt/portal', '/search?q=Ana%20%26%20Porto']) expect(safeRoute(route), route).toBe(route);
  });

  it('stops anything a browser would read as another site, or a script', () => {
    for (const route of [
      'javascript:alert(1)', 'https://evil.example/', '//evil.example/x', '/\\evil.example', '/\\\\evil.example', '/%5Cevil.example'.replace('%5C', '\\'),
      ' /players', '/pla\u0000yers', '/players\n', 'players', '', null, undefined, 42, `/${'a'.repeat(3000)}`,
    ]) expect(safeRoute(route), String(route)).toBeNull();
  });

  it('never offers an unsafe registry route, even when the router picked it', () => {
    const evil = [{ id: 'evil', kind: 'navigate', route: '//evil.example', title: 'Evil', explanation: 'x' }];
    const reg = { capabilities: evil, byId: new Map(evil.map((c) => [c.id, c])), boundaryIds: new Set() } as unknown as Registry;
    // present() describes what the registry says; the widget filters it before it becomes a link or a move.
    const view = present(trace({ capabilityId: 'evil' }), reg, '/', words);
    expect(safeRoute(view.destination)).toBeNull();
  });
});

/**
 * ADR-030: a visitor reads one language — the page's. The app's words come in every language it ships
 * (`translations`), and the assistant's own follow them; never a Portuguese screen name in an English
 * sentence, or the other way round.
 */
describe('one language on screen', () => {
  const caps = [
    { id: 'pay', kind: 'navigate', route: '/pay', title: 'Pagamentos', explanation: 'Este ecrã mostra: Faturas.', translations: { en: { title: 'Payments', explanation: 'This screen shows: Invoices.' } } },
    { id: 'news', kind: 'navigate', route: '/news', title: 'Notícias', explanation: 'Este ecrã mostra: Destaques.', translations: { en: { title: 'News' } } },
    { id: 'no.money', kind: 'unsupported', route: null, title: 'Dinheiro', refusal: 'Não trato de pagamentos.', translations: { en: { title: 'Money', refusal: 'I don’t handle payments.' } } },
    { id: 'no.law', kind: 'unsupported', route: null, title: 'Direito', refusal: 'Não dou conselhos legais.' },
  ];
  const reg = { language: 'pt-PT', capabilities: caps, byId: new Map(caps.map((c) => [c.id, c])), boundaryIds: new Set(['no.money', 'no.law']) } as unknown as Registry;

  it('shows the page’s language when the app ships it, and the app’s own otherwise', () => {
    expect(displayLanguage('en-GB', reg)).toBe('en');
    expect(displayLanguage('pt', reg)).toBe('pt-PT');
    // A language the app does not ship: English, the default, since the app has it…
    expect(displayLanguage('fr', reg)).toBe('en');
    // …and the app's own when it does not.
    const ptOnly = { ...reg, capabilities: [caps[3]] } as unknown as Registry;
    expect(displayLanguage('fr', ptOnly)).toBe('pt-PT');
    expect(displayLanguage(null, reg)).toBe('pt-PT');
    // A registry from before ADR-030 says nothing of its language: the page's, as it always was.
    expect(displayLanguage('en', { ...reg, language: undefined } as unknown as Registry)).toBe('en');
  });

  it('reads each name, explanation and refusal in that language — and leaves out what it does not have', () => {
    const en = inLanguage(reg, 'en');
    expect(en.byId.get('pay')).toMatchObject({ title: 'Payments', explanation: 'This screen shows: Invoices.' });
    // No English explanation: none, rather than the Portuguese one.
    expect(en.byId.get('news')!.title).toBe('News');
    expect(en.byId.get('news')!.explanation).toBeUndefined();
    expect(en.byId.get('no.money')!.refusal).toBe('I don’t handle payments.');
    expect(en.byId.get('no.law')!.refusal).toBeUndefined();
    // Its own language, and a registry that names none, are returned as they are.
    expect(inLanguage(reg, 'pt-PT')).toBe(reg);
    expect(inLanguage(reg, 'pt')).toBe(reg);
    expect(inLanguage(reg, 'en')).toBe(en);
  });

  it('answers wholly in English on an English page of a Portuguese app', () => {
    const w = wordsFor(displayLanguage('en', reg));
    const en = inLanguage(reg, 'en');
    expect(present(trace({ capabilityId: 'pay' }), en, '/', w).title).toBe('Opening Payments');
    const limit = present(trace({ outcome: 'out_of_scope', capabilityId: 'no.law' }), en, '/', w);
    expect(`${limit.title} ${limit.body}`).not.toMatch(/Não|conselhos/);
    expect(limit.body).toBe(w.limitFallback);
    const asked = present(trace({ capabilityId: 'news', explanationRequest: true }), en, '/', w);
    expect(asked.body).toBeNull();
  });

  it('never lets the router see a translation: its registry is untouched', () => {
    inLanguage(reg, 'en');
    expect(reg.byId.get('pay')!.title).toBe('Pagamentos');
  });
});
