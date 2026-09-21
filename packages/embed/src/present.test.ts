import { describe, expect, it } from 'vitest';

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import type { Smalltalk } from './chat.ts';
import { attachmentView, fillParams, isSamePlace, present, smalltalkView, WORDS, wordsFor, type Choice } from './present.ts';

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
  it('moves for an executed navigate turn, and says where', () => {
    const view = present(trace({ capabilityId: 'calendar.overview' }), registry, '/', words);
    expect(view).toMatchObject({ tone: 'go', destination: '/calendar', body: 'Training and matches by day.' });
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
    expect(view.title).toMatch(/already on Calendar/);
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
    expect(view.body).toMatch(/one specific item/);
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
 * When the router will not act but one screen is plainly ahead, a menu of equals is the wrong
 * answer: it makes the visitor do the ranking the router already did. So the leader is offered
 * first, as the likely one, with what the screen is for — and never executed, because a
 * suggestion costs one tap when it is wrong and a move costs a page.
 */
describe('present — a clear leader', () => {
  const clarify = (candidates: { capabilityId: string; score: number }[], path = '/', w = words) =>
    present(trace({ outcome: 'clarify', candidates }), registry, path, w);

  it('says which one it thinks you mean when one is clearly ahead, and what that screen is for', () => {
    const view = clarify([
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'squad.search', score: 0.12 },
    ]);
    expect(view).toMatchObject({ tone: 'choose', probable: true, destination: null, title: 'You probably want Calendar.' });
    expect(view.choices).toEqual([
      { label: 'Calendar', route: '/calendar', detail: 'Training and matches by day.' },
      { label: 'Squad', route: '/squad', detail: 'Every player.' },
    ]);
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
    expect(view.title).toBe(words.couldHelp(2));
    expect(view.choices).toHaveLength(2);
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
  });

  it('leaves the framing to the model when it wrote something, which wins over fixed wording', () => {
    const view = present(
      trace({ outcome: 'clarify', prose: 'I found a couple of things close to that.', candidates: [{ capabilityId: 'calendar.overview', score: 0.5 }, { capabilityId: 'squad.search', score: 0.1 }] }),
      registry,
      '/',
      words,
    );
    expect(view.probable).toBeUndefined();
    expect(view.title).toBe(words.couldHelp(2));
    expect(view.body).toBe('I found a couple of things close to that.');
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
    expect(detailOf('x.essay').detail!.length).toBeLessThanOrEqual(141);
    expect(detailOf('x.essay').detail!.endsWith('…')).toBe(true);
    expect('detail' in detailOf('x.bare')).toBe(false);
  });

  it('says it in the page’s language', () => {
    const view = clarify([{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.search', score: 0.1 }], '/', WORDS.pt);
    expect(view.title).toBe('Provavelmente quer Calendar.');
    expect(WORDS.pt.orElse).toBeTruthy();
    expect(WORDS.en.orElse).toBeTruthy();
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

  it('offers at most two places, however many candidates there were', () => {
    expect(ask('something').choices).toHaveLength(2);
    const leading = ask('something', [{ capabilityId: 'calendar.overview', score: 0.9 }, ...many.slice(1)]);
    expect(leading.probable).toBe(true);
    expect(leading.choices).toHaveLength(2);
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

  it('a tie is two places, named as such, not a quiz', () => {
    const view = ask('something');
    expect(view.probable).toBeUndefined();
    expect(view.title).toBe(words.couldHelp(2));
    expect(words.couldHelp(2)).not.toMatch(/which/i);
  });

  it('a single place is offered as one, not as a choice between things', () => {
    const view = ask('something', [{ capabilityId: 'calendar.overview', score: 0.1 }]);
    expect(view.choices).toHaveLength(1);
    expect(view.title).toBe(words.couldHelp(1));
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
    expect(ask('I want to book a training').title).toBe(words.couldHelp(2));
  });

  it('has the words for it in both languages', () => {
    for (const w of [WORDS.en, WORDS.pt]) {
      expect(w.couldHelp(1)).toBeTruthy();
      expect(w.couldHelp(2)).toBeTruthy();
      expect(w.couldHelp(1)).not.toBe(w.couldHelp(2));
      expect(w.probablyTask('X')).toContain('X');
      expect(w.notThat).toBeTruthy();
    }
    expect(WORDS.pt.couldHelp(2)).not.toBe(WORDS.en.couldHelp(2));
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
    expect(view.title).not.toBe(words.couldHelp(2));
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
    expect(view.title).toBe(words.couldHelp(1));
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

  it('falls back to the declared explanation when prose is null — the pre-WP-53 shape', () => {
    const view = present(trace({ capabilityId: 'calendar.overview', prose: null }), registry, '/', words);
    expect(view.body).toBe('Training and matches by day.');
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
