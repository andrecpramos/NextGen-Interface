import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import { mountAssistant, type AssistantOptions } from './assistant.ts';
import { WORDS } from './present.ts';
import { css, GRAPHITE } from './theme.ts';
import { FakeDocument, MemoryStorage, type FakeElement } from './test-support/fake-dom.ts';
import type { Recognition, RecognitionCtor, VoiceEnv } from './voice.ts';
import type { Routable } from './widget.ts';

/**
 * The assistant layer, driven through test-support/fake-dom.ts. The decisions are
 * present.ts's, the look is theme.ts's and the adopter's navigation is nav.ts's,
 * each tested on its own; this file checks the layer around them — the landing
 * page, the dialog, the menu, the trip to a destination, the note that survives a
 * page load, the guide, "why", reading aloud, and hands-free voice.
 */

const caps = [
  { id: 'calendar.overview', kind: 'navigate', route: '/calendar', title: 'Calendar', explanation: 'Training and matches by day.' },
  { id: 'squad.list', kind: 'navigate', route: '/squad', title: 'Squad', explanation: 'Every player.' },
  { id: 'child.medical', kind: 'navigate', route: '/my/children/:childId/medical', title: 'Medical', explanation: null },
  { id: 'module.delete', kind: 'destructive', route: '/modules', title: 'Delete a module', explanation: null },
  { id: 'unsupported.payments', kind: 'unsupported', route: null, title: 'Payments', refusal: 'I cannot move money.' },
  { id: 'standings', kind: 'navigate', route: '/competition/standings', title: 'Standings', explanation: 'The league table.' },
  { id: 'settings', kind: 'navigate', route: '/settings', title: 'Settings', explanation: 'Your preferences.' },
  { id: 'notifications', kind: 'navigate', route: '/notifications', title: 'Notifications', explanation: 'What changed.' },
  {
    id: 'expenses.new',
    kind: 'navigate',
    route: '/expenses/new',
    title: 'New expense',
    explanation: 'The expense form.',
    steps: [
      { text: 'Fill in “Amount”.', anchor: { label: 'Amount', role: 'textbox' } },
      { text: 'Save it.', anchor: { label: 'Save', role: 'button' } },
    ],
  },
];
const registry = {
  capabilities: caps,
  byId: new Map(caps.map((c) => [c.id, c])),
  boundaryIds: new Set(['unsupported.payments']),
} as unknown as Registry;

const trace = (over: Partial<TurnTrace>): TurnTrace =>
  ({ outcome: 'execute', capabilityId: null, candidates: [], explanationRequest: false, ...over }) as unknown as TurnTrace;

function answering(...traces: Partial<TurnTrace>[]): Routable & { asked: string[] } {
  const asked: string[] = [];
  let i = 0;
  return {
    registry,
    asked,
    async route(utterance) {
      asked.push(utterance);
      return trace(traces[Math.min(i++, traces.length - 1)] ?? {});
    },
  };
}

const toCalendar: Partial<TurnTrace> = { capabilityId: 'calendar.overview' };
const clarifying = {
  outcome: 'clarify',
  decidedAt: 'embedding',
  latency: { total: 12.4 },
  candidates: [
    { capabilityId: 'calendar.overview', score: 0.5 },
    { capabilityId: 'squad.list', score: 0.4 },
  ],
} as unknown as Partial<TurnTrace>;

interface Setup {
  /** No router supplied, so moving is a full page load (`location.assign`). */
  readonly reloads?: boolean;
  readonly path?: string;
  /** Build the adopter's page before the layer mounts on it. */
  readonly page?: (doc: FakeDocument) => void;
}

function setup(assistant: Routable, options: AssistantOptions = {}, { reloads = false, path = '/home', page }: Setup = {}) {
  const doc = new FakeDocument('en');
  page?.(doc);
  const storage = (options.storage as MemoryStorage | undefined) ?? new MemoryStorage();
  const preferences = (options.preferences as MemoryStorage | undefined) ?? new MemoryStorage();
  const location = { path };
  const moves: string[] = [];
  const mounted = mountAssistant(doc.body as unknown as Element, assistant, {
    ...(reloads
      ? {}
      : {
          navigate: (route: string) => {
            moves.push(route);
            location.path = route;
          },
        }),
    currentPath: () => location.path,
    dockSide: 'right',
    home: [],
    ...options,
    storage,
    preferences,
  });
  const host = doc.body.children.find((el) => el.hasAttribute('data-nextgen-assistant'))!;
  const hasClass = (name: string) => (el: FakeElement) => String(el.className ?? '').split(' ').includes(name);
  const byClass = (name: string): FakeElement => host.find(hasClass(name))!;
  return {
    doc,
    storage,
    preferences,
    location,
    moves,
    mounted,
    host,
    byClass,
    all: (name: string): FakeElement[] => host.findAll(hasClass(name)),
    orb: byClass('orb'),
    screen: byClass('screen'),
    caption: byClass('caption'),
    thread: byClass('thread'),
    bubble: byClass('bubble'),
    menu: byClass('menu'),
    drawer: byClass('drawer'),
    mic: byClass('mic'),
    send: byClass('send'),
    sound: byClass('sound'),
    close: byClass('close'),
    guide: byClass('guide'),
    input: host.find((el) => el.tagName === 'input')!,
  };
}

/** `setup` under another name, for a block that shadows it with its own defaults. */
const baseSetup = setup;

/** The adopter's page: a header navigation, and a footer one that is not the menu. */
function clubPage(doc: FakeDocument): void {
  const nav = doc.createElement('nav');
  nav.setAttribute('aria-label', 'Main');
  for (const [href, text] of [
    ['/home', 'Home'],
    ['/calendar', 'Calendar'],
    ['/competition/standings', 'Standings'],
    ['https://elsewhere.test/shop', 'Shop'],
  ] as const) {
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    a.textContent = text;
    nav.append(a);
  }
  const footer = doc.createElement('footer');
  const footerNav = doc.createElement('nav');
  for (const [href, text] of [
    ['/terms', 'Terms'],
    ['/privacy', 'Privacy'],
  ] as const) {
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    a.textContent = text;
    footerNav.append(a);
  }
  footer.append(footerNav);
  doc.body.append(nav, footer);
}

/**
 * A browser that can recognise speech on the device. `downloadable` is Edge's real starting
 * state: the language pack must be installed first, and only a tap may install it.
 */
function localVoice(
  extra: Partial<VoiceEnv> = {},
  { status = 'available', installs = true }: { status?: 'available' | 'downloadable'; installs?: boolean } = {},
) {
  let availability: string = status;
  const installed: unknown[] = [];
  const made: (Recognition & { started: boolean; aborted: boolean })[] = [];
  const tracks = [
    {
      stopped: 0,
      stop() {
        this.stopped++;
      },
    },
  ];
  class LocalRecognition {
    lang = '';
    interimResults = false;
    continuous = false;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;
    onstart: (() => void) | null = null;
    started = false;
    aborted = false;
    #local = false;
    get processLocally(): boolean {
      return this.#local;
    }
    set processLocally(value: boolean) {
      this.#local = value;
    }
    static available = async (): Promise<string> => availability;
    static install = async (options: unknown): Promise<boolean> => {
      installed.push(options);
      if (installs) availability = 'available';
      return installs;
    };
    constructor() {
      made.push(this);
    }
    start(): void {
      this.started = true;
      this.onstart?.();
    }
    stop(): void {
      this.onend?.();
    }
    abort(): void {
      this.aborted = true;
      this.onend?.();
    }
  }
  const env: VoiceEnv = {
    getUserMedia: async () => ({ getTracks: () => tracks }) as unknown as MediaStream,
    AudioContext: null,
    Recognition: LocalRecognition as unknown as RecognitionCtor,
    synth: null,
    Utterance: null,
    frame: () => 0,
    cancelFrame: () => undefined,
    timer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (id) => clearTimeout(id),
    now: () => Date.now(),
    ...extra,
  };
  return { env, made, tracks, installed };
}

const heard = (text: string) => ({ results: [{ isFinal: true, 0: { transcript: text } }] });
const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the assistant layer — at rest', () => {
  it('waits at the edge as a labelled button, with the screen shut', () => {
    const { host, orb, screen } = setup(answering({}));
    expect(host.shadowRoot).not.toBeNull();
    expect(orb.tagName).toBe('button');
    expect(orb.getAttribute('aria-label')).toBe('Open the assistant');
    expect(orb.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAttribute('role')).toBe('dialog');
    expect(screen.getAttribute('aria-modal')).toBe('true');
    expect(screen.hasAttribute('inert')).toBe(true);
  });

  it('says what it is when pointed at or reached by keyboard — a globe in a corner says nothing to a stranger', () => {
    const { orb, bubble } = setup(answering({}));
    orb.fire('pointerenter', { pointerType: 'mouse' } as never);
    expect(bubble.dataset.show).toBe('true');
    expect(bubble.textContent).toBe('Ask where to go');
    // The orb's own name already says it to a screen reader; the hint is not announced twice.
    expect(bubble.getAttribute('aria-hidden')).toBe('true');
    orb.fire('pointerleave');
    expect(bubble.dataset.show).toBe('false');
    expect(bubble.hasAttribute('aria-hidden')).toBe(false);

    orb.fire('focus');
    expect(bubble.dataset.show).toBe('true');
    orb.fire('blur');
    expect(bubble.dataset.show).toBe('false');

    // A finger has no hover: a tap opens the screen, and a hint would only flash on the way.
    orb.fire('pointerenter', { pointerType: 'touch' } as never);
    expect(bubble.dataset.show).toBe('false');
  });

  it('offers no microphone and no read-aloud where the browser can do neither', () => {
    const { mic, sound } = setup(answering({}));
    expect(mic.hidden).toBe(true);
    expect(sound.hidden).toBe(true);
  });

  it('wears the page’s look — here, a page with no stylesheet, so the default one', () => {
    const { host } = setup(answering({}));
    expect(host.style['--ng-accent']).toBe(css(GRAPHITE.accent));
    expect(host.style['--ng-scheme']).toBe('dark');
  });
});

describe('the landing page', () => {
  it('on a home route the screen is the page: open on arrival, with focus in the composer', async () => {
    const { screen, doc, input } = setup(answering({}), { home: ['/home'] });
    await settle(100);
    expect(screen.dataset.open).toBe('true');
    expect(doc.activeElement).toBe(input);
  });

  it('every other page is left as it was, with the small orb', async () => {
    const { screen, orb } = setup(answering({}), { home: ['/'] });
    await settle(100);
    expect(screen.dataset.open).toBe('false');
    expect(orb.dataset.mode).toBe('docked');
  });

  it('closing it shows the original landing page underneath', async () => {
    const { screen, close, doc } = setup(answering({}), { home: ['/home'] });
    await settle(100);
    close.fire('click');
    expect(screen.dataset.open).toBe('false');
    expect(doc.documentElement.style.overflow).toBe('');
  });

  it('taking the user to the landing route opens the screen there, rather than a note', async () => {
    const { mounted, screen, bubble, moves } = setup(answering(toCalendar), { home: ['/calendar'] });
    void mounted.ask('where is the calendar');
    await settle(3500);
    expect(moves).toEqual(['/calendar']);
    expect(screen.dataset.open).toBe('true');
    expect(bubble.dataset.show).toBe('false');
  });
});

describe('opening the screen', () => {
  it('moves focus in, stops the page scrolling, and offers no pre-written questions', async () => {
    const { orb, screen, input, doc, host, byClass } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    expect(screen.dataset.open).toBe('true');
    expect(screen.hasAttribute('inert')).toBe(false);
    expect(doc.activeElement).toBe(input);
    expect(doc.documentElement.style.overflow).toBe('hidden');
    expect(orb.getAttribute('aria-hidden')).toBe('true');
    expect(byClass('greeting').textContent).toBe('Ready when you are.');
    // …and, beneath it, what this is for — to someone who has never seen it. A sentence, not a question.
    expect(byClass('greeting-hint').textContent).toBe(WORDS.en.greetingHint);
    expect(screen.getAttribute('aria-describedby')).toBe('nextgen-greeting-hint');
    expect(host.findAll((el) => el.tagName === 'a')).toHaveLength(0);
  });

  it('Escape closes it, gives focus back to the orb, and lets the page scroll again', async () => {
    const { orb, screen, doc } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    expect(screen.fire('keydown', { key: 'Escape' }).defaultPrevented).toBe(true);
    expect(screen.dataset.open).toBe('false');
    expect(screen.hasAttribute('inert')).toBe(true);
    expect(doc.activeElement).toBe(orb);
    expect(doc.documentElement.style.overflow).toBe('');
  });

  it('keeps Tab inside the screen', async () => {
    const { orb, screen, doc, menu, send } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    send.focus();
    expect(screen.fire('keydown', { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(menu);
    expect(screen.fire('keydown', { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(send);
  });
});

describe('the menu', () => {
  it("opens the app's own navigation, in its order, with the current page marked", async () => {
    const { orb, menu, drawer, all, doc } = setup(answering({}), {}, { page: clubPage });
    orb.fire('click');
    await settle(50);
    menu.fire('click');
    expect(drawer.dataset.open).toBe('true');
    expect(drawer.hasAttribute('inert')).toBe(false);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    const links = all('drawer-link');
    // The footer is not the menu, and another site is not a place in this app.
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'Calendar', 'Standings']);
    expect(links.map((a) => a.href)).toEqual(['/home', '/calendar', '/competition/standings']);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    expect(doc.activeElement).toBe(links[0]);
  });

  it('Escape closes the menu first, and focus returns to its button; the next Escape closes the screen', async () => {
    const { orb, menu, drawer, screen, doc } = setup(answering({}), {}, { page: clubPage });
    orb.fire('click');
    await settle(50);
    menu.fire('click');
    screen.fire('keydown', { key: 'Escape' });
    expect(drawer.dataset.open).toBe('false');
    expect(screen.dataset.open).toBe('true');
    expect(doc.activeElement).toBe(menu);
    screen.fire('keydown', { key: 'Escape' });
    expect(screen.dataset.open).toBe('false');
  });

  it('following a link travels there with the orb', async () => {
    const { orb, menu, all, moves, screen } = setup(answering({}), {}, { page: clubPage });
    orb.fire('click');
    await settle(50);
    menu.fire('click');
    expect(all('drawer-link')[1]!.fire('click', { button: 0 }).defaultPrevented).toBe(true);
    await settle(1500);
    expect(moves).toEqual(['/calendar']);
    expect(screen.dataset.open).toBe('false');
  });

  it('choosing the page the user is already on just closes the screen onto it', async () => {
    const { orb, menu, all, moves, screen } = setup(answering({}), {}, { page: clubPage });
    orb.fire('click');
    await settle(50);
    menu.fire('click');
    all('drawer-link')[0]!.fire('click', { button: 0 });
    expect(screen.dataset.open).toBe('false');
    await settle(1500);
    expect(moves).toEqual([]);
  });

  it('on a page with no navigation of its own, lists the places the registry knows', async () => {
    const { orb, menu, all } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    menu.fire('click');
    expect(all('drawer-link').map((a) => a.href)).toEqual([
      '/calendar',
      '/squad',
      '/competition/standings',
      '/settings',
      '/notifications',
      '/expenses/new',
    ]);
  });

  it('keeps Tab inside the open menu', async () => {
    const { orb, menu, screen, all, byClass, doc } = setup(answering({}), {}, { page: clubPage });
    orb.fire('click');
    await settle(50);
    menu.fire('click');
    all('drawer-link').at(-1)!.focus();
    expect(screen.fire('keydown', { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(byClass('drawer-close'));
  });
});

describe('a turn that resolves to a place', () => {
  it('says where it is going, flies back to the edge, moves, and says where the user landed', async () => {
    const { mounted, thread, screen, orb, bubble, moves, storage } = setup(answering(toCalendar));
    const done = mounted.ask('where is the calendar');
    await settle(0);
    expect(thread.textContent).toContain('Opening Calendar');
    expect(moves).toEqual([]);
    await settle(3000);
    await done;
    expect(moves).toEqual(['/calendar']);
    expect(screen.dataset.open).toBe('false');
    expect(orb.dataset.mode).toBe('docked');
    await settle(400);
    expect(bubble.textContent).toBe('You are on Calendar');
    expect(bubble.dataset.show).toBe('true');
    expect(storage.items.size).toBe(0);
  });

  it('on a full page load, leaves a note for the next page instead', async () => {
    const { mounted, doc, storage } = setup(answering(toCalendar), {}, { reloads: true });
    void mounted.ask('where is the calendar');
    await settle(3000);
    expect(doc.defaultView!.moved).toEqual(['/calendar']);
    expect(JSON.parse(storage.getItem('nextgen:arrival')!)).toMatchObject({
      title: 'Calendar',
      side: 'right',
      capabilityId: 'calendar.overview',
    });
  });

  it('does not go anywhere once the user has closed the screen', async () => {
    const { mounted, moves, storage } = setup(answering(toCalendar));
    void mounted.ask('where is the calendar');
    await settle(500);
    mounted.close();
    await settle(4000);
    expect(moves).toEqual([]);
    expect(storage.items.size).toBe(0);
  });
});

describe('the next page', () => {
  it('picks up the note: the orb is already on that side and says where the user is', async () => {
    const storage = new MemoryStorage();
    storage.setItem('nextgen:arrival', JSON.stringify({ title: 'Calendar', side: 'left', at: Date.now() }));
    const { orb, bubble } = setup(answering({}), { storage, dockSide: 'auto' });
    expect(orb.dataset.side).toBe('left');
    await settle(60);
    expect(bubble.textContent).toBe('You are on Calendar');
    expect(bubble.dataset.show).toBe('true');
    expect(storage.items.size).toBe(0);
  });

  it('ignores a stale note', async () => {
    const storage = new MemoryStorage();
    storage.setItem('nextgen:arrival', JSON.stringify({ title: 'Calendar', side: 'left', at: Date.now() - 60_000 }));
    const { bubble } = setup(answering({}), { storage });
    await settle(60);
    expect(bubble.dataset.show).toBe('false');
    expect(storage.items.size).toBe(0);
  });

  it('ignores a note it cannot trust', async () => {
    const storage = new MemoryStorage();
    storage.setItem('nextgen:arrival', '{"title": 3, "side": "up"}');
    const { bubble } = setup(answering({}), { storage });
    await settle(60);
    expect(bubble.dataset.show).toBe('false');
  });
});

describe('the guide', () => {
  it('walks the user through the steps the registry declares for the screen they landed on', async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'nextgen:arrival',
      JSON.stringify({ title: 'New expense', side: 'right', at: Date.now(), capabilityId: 'expenses.new' }),
    );
    const { guide, bubble, byClass } = setup(
      answering({}),
      { storage },
      {
        path: '/expenses/new',
        page: (doc) => {
          const label = doc.createElement('label');
          label.setAttribute('for', 'amount');
          label.textContent = 'Amount';
          const amount = doc.createElement('input');
          amount.setAttribute('id', 'amount');
          const save = doc.createElement('button');
          save.textContent = 'Save';
          doc.body.append(label, amount, save);
        },
      },
    );
    await settle(60);
    expect(guide.hidden).toBe(false);
    expect(bubble.dataset.show).toBe('false');
    expect(byClass('guide-title').textContent).toBe('You are on New expense');
    expect(byClass('guide-count').textContent).toBe('Step 1 of 2');
    expect(byClass('guide-text').textContent).toBe('Fill in “Amount”.');
    expect(byClass('guide-back').hidden).toBe(true);

    byClass('guide-next').fire('click');
    expect(byClass('guide-count').textContent).toBe('Step 2 of 2');
    expect(byClass('guide-done').hidden).toBe(false);
    expect(byClass('guide-next').hidden).toBe(true);

    byClass('guide-done').fire('click');
    expect(guide.hidden).toBe(true);
    expect(storage.items.size).toBe(0);
  });
});

describe('a clarifying turn', () => {
  it('offers the candidates as real links, and following one travels', async () => {
    const { mounted, all, moves } = setup(answering(clarifying));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    const chips = all('chip');
    expect(chips.map((a) => a.href)).toEqual(['/calendar', '/squad']);
    expect(moves).toEqual([]);
    expect(chips[1]!.fire('click', { button: 0 }).defaultPrevented).toBe(true);
    await settle(2000);
    expect(moves).toEqual(['/squad']);
  });

  it('leaves a modified click alone — a new tab is still a new tab', async () => {
    const { mounted, all, moves } = setup(answering(clarifying));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(all('chip')[0]!.fire('click', { ctrlKey: true }).defaultPrevented).toBe(false);
    await settle(2000);
    expect(moves).toEqual([]);
  });
});

describe('a clear leader, offered as the likely one', () => {
  const leading = {
    outcome: 'clarify',
    decidedAt: 'embedding',
    latency: { total: 5 },
    candidates: [
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'squad.list', score: 0.1 },
    ],
  } as unknown as Partial<TurnTrace>;
  const classes = (el: FakeElement): string[] => String(el.className).split(' ');

  it('puts the likely one first with what it is for, and the rest beneath, introduced as alternatives', async () => {
    const { mounted, thread, all } = setup(answering(leading));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    const chips = all('chip');
    expect(chips.map((a) => a.href)).toEqual(['/calendar', '/squad']);
    expect(classes(chips[0]!)).toContain('lead');
    expect(classes(chips[1]!)).not.toContain('lead');
    expect(thread.textContent).toContain('You probably want Calendar.');
    expect(thread.textContent).toContain('Open Calendar');
    expect(thread.textContent).toContain('Training and matches by day.');
    expect(thread.textContent).toContain('Or maybe:');
  });

  it('is still only a link: nothing moves until the visitor takes it', async () => {
    const { mounted, all, moves } = setup(answering(leading));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(moves).toEqual([]);
    expect(all('lead')[0]!.fire('click', { button: 0 }).defaultPrevented).toBe(true);
    await settle(2000);
    expect(moves).toEqual(['/calendar']);
  });

  it('offers no alternatives label when there are none', async () => {
    const alone = { ...leading, candidates: [{ capabilityId: 'calendar.overview', score: 0.3 }] } as unknown as Partial<TurnTrace>;
    const { mounted, thread, all } = setup(answering(alone));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(all('lead')).toHaveLength(1);
    expect(thread.textContent).not.toContain('Or maybe:');
  });

  it('leaves a menu of equals exactly as it was: no likely one, no label', async () => {
    const { mounted, thread, all } = setup(answering(clarifying));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(all('lead')).toHaveLength(0);
    expect(all('chip')).toHaveLength(2);
    expect(thread.textContent).toContain('Two places could help with that:');
    expect(thread.textContent).not.toContain('Or maybe:');
  });
});

/**
 * A visitor who knows nothing about the app says "hi", "help", "I'm lost", "make an appointment". The
 * first three are not questions for the router — and a router handed them refuses — and the last is
 * answered with as few places as will do, each said in the adopter's own words.
 */
describe('a visitor who knows nothing about the app', () => {
  const text = (el: FakeElement): string => String(el.textContent);
  // A longer answer is "spoken" for longer (up to 2.2 s without a voice), so wait a little more than the rest do.
  const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms * 3);

  it('is greeted, not refused, and the router is never asked', async () => {
    const routed = answering(toCalendar);
    const { mounted, thread, all, moves } = setup(routed);
    const done = mounted.ask('hi');
    await settle(2000);
    await done;
    expect(routed.asked).toEqual([]);
    expect(text(thread)).toContain('Hi! How can I help?');
    expect(text(thread)).not.toContain('can’t help with that');
    expect(all('user').map(text)).toEqual(['hi']);
    expect(moves).toEqual([]);
  });

  it('says thanks, goodbye and who it is just as kindly', async () => {
    const routed = answering(toCalendar);
    const { mounted, thread } = setup(routed);
    for (const [said, reply] of [['thanks!', 'You’re welcome!'], ['bye', 'Bye for now!'], ['who are you?', 'I’m this app’s assistant.']] as const) {
      const done = mounted.ask(said);
      await settle(2000);
      await done;
      expect(text(thread)).toContain(reply);
    }
    expect(routed.asked).toEqual([]);
  });

  it('is routed on what follows a greeting, and the thread shows what they actually typed', async () => {
    const routed = answering(toCalendar);
    const { mounted, thread, all } = setup(routed);
    const done = mounted.ask('hi, where is the calendar?');
    await settle(2000);
    await done;
    expect(routed.asked).toEqual(['where is the calendar?']);
    expect(all('user').map(text)).toEqual(['hi, where is the calendar?']);
    expect(text(thread)).toContain('Opening Calendar');
  });

  it('is shown a few real places to begin when they say they are lost, each with what it is for', async () => {
    const routed = answering(toCalendar);
    const { mounted, thread, all } = setup(routed);
    const done = mounted.ask("I don't know what to do");
    await settle(2000);
    await done;
    expect(routed.asked).toEqual([]);
    expect(all('chip').map((a) => a.href)).toEqual(['/calendar', '/squad', '/competition/standings']);
    expect(text(thread)).toContain('Training and matches by day.');
    expect(text(thread)).toContain('The league table.');
    expect(text(thread)).toContain('Not sure where to start?');
  });

  it('is started from the app’s own main navigation, in its own words, where the assistant knows what a place is for', async () => {
    const routed = answering(toCalendar);
    const { mounted, thread, all } = setup(routed, {}, { page: clubPage });
    const done = mounted.ask('i have no idea what to do here');
    await settle(2000);
    await done;
    // Home is the page they are on, Shop is somewhere else, and neither is a place it can describe.
    expect(all('chip').map((a) => a.href)).toEqual(['/calendar', '/competition/standings']);
    expect(all('chip').map((a) => text(a))).toEqual(['CalendarTraining and matches by day.', 'StandingsThe league table.']);
    expect(text(thread)).toContain('Not sure where to start?');
  });

  it('is given two places for a task, not three, each said in the adopter’s words', async () => {
    const task = {
      outcome: 'clarify',
      decidedAt: 'embedding',
      latency: { total: 5 },
      utterance: 'make an appointment',
      candidates: [
        { capabilityId: 'calendar.overview', score: 0.3 },
        { capabilityId: 'squad.list', score: 0.27 },
        { capabilityId: 'standings', score: 0.2 },
      ],
    } as unknown as Partial<TurnTrace>;
    const { mounted, thread, all } = setup(answering(task));
    const done = mounted.ask('make an appointment');
    await settle(2000);
    await done;
    expect(all('chip').map((a) => a.href)).toEqual(['/calendar', '/squad']);
    expect(text(thread)).toContain('Training and matches by day.');
    expect(text(thread)).toContain('Every player.');
    expect(text(thread)).not.toContain('The league table.');
  });

  it('is told how to be understood better, and only when the answer was a guess', async () => {
    const guess = answering(clarifying);
    const a = setup(guess);
    const asking = a.mounted.ask('games');
    await settle(2000);
    await asking;
    expect(text(a.thread)).toContain('Not what you meant?');

    for (const other of [answering(toCalendar), answering({ outcome: 'out_of_scope' })]) {
      const b = setup(other);
      const done = b.mounted.ask('games');
      await settle(2000);
      await done;
      expect(text(b.thread)).not.toContain('Not what you meant?');
    }
    const c = setup(answering(toCalendar));
    const hello = c.mounted.ask('hello');
    await settle(2000);
    await hello;
    expect(text(c.thread)).not.toContain('Not what you meant?');
  });

  it('is not handed two arbitrary screens when nothing they said matched anything: it says so, and offers places to begin', async () => {
    const blank = { outcome: 'clarify', decidedAt: 'embedding', latency: { total: 5 }, candidates: [{ capabilityId: 'calendar.overview', score: 0 }, { capabilityId: 'squad.list', score: 0 }] } as unknown as Partial<TurnTrace>;
    const { mounted, thread, all } = setup(answering(blank), {}, { page: clubPage });
    const done = mounted.ask('quero falar com alguém');
    await settle(2000);
    await done;
    expect(text(thread)).toContain('not sure what you’re after');
    expect(text(thread)).not.toContain('Two places could help with that:');
    expect(all('chip').map((a) => a.href)).toEqual(['/calendar', '/competition/standings']);
  });

  it('is never left at a dead end: even a refusal says what it can do instead', async () => {
    const { mounted, thread } = setup(answering({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments' }));
    const done = mounted.ask('pay my invoice');
    await settle(2000);
    await done;
    expect(text(thread)).toContain('I can’t help with that here');
    expect(text(thread)).toContain('I cannot move money.');
    expect(text(thread)).toContain('I can help you find your way around this app');
  });
});

/**
 * A photo or a file, sent with what the visitor says — especially from a phone. What it is for: the
 * visitor is holding the thing they need help with (a certificate, a receipt, a screenshot of an error),
 * and a box that only takes typing tells them the assistant is not for that. What the assistant does with
 * it is deliberately little: nothing attached is sent anywhere — not to the router, not to a trace, not to a
 * model — because this product's promise is that nothing leaves the device. It is shown back, and handed
 * to the page it sits in (`nextgen:attach`), which may want it; and the visitor is told which happened.
 */
describe('attachments — a photo or a file, kept on the device', () => {
  // Off unless the adopter turns it on (ADR-024 addendum): everything below is about an app that did.
  const setup = (assistant: Routable, options: AssistantOptions = {}, rest: Setup = {}) =>
    baseSetup(assistant, { attach: true, ...options }, rest);
  const text = (el: FakeElement): string => String(el.textContent);
  const settle = (ms: number) => vi.advanceTimersByTimeAsync(ms * 3);
  const file = (name: string, type = 'image/png', size = 2048) => ({ name, type, size }) as unknown as File;

  interface Fitted {
    events: { type: string; detail: { files: File[]; utterance: string; route: string } }[];
    handle: { take: boolean };
  }
  /** A window that can be asked its pointer, and can be handed events — what a phone's browser is. */
  const fitted = (coarse = false): { page: (doc: FakeDocument) => void; sent: Fitted } => {
    const sent: Fitted = { events: [], handle: { take: false } };
    return {
      sent,
      page: (doc) => {
        const view = doc.defaultView as unknown as Record<string, unknown>;
        view.matchMedia = (query: string) => ({ matches: coarse && /pointer:\s*coarse/.test(query) });
        view.CustomEvent = class {
          type: string;
          detail: unknown;
          cancelable: boolean;
          defaultPrevented = false;
          constructor(type: string, init: { detail?: unknown; cancelable?: boolean } = {}) {
            this.type = type;
            this.detail = init.detail;
            this.cancelable = Boolean(init.cancelable);
          }
          preventDefault(): void {
            if (this.cancelable) this.defaultPrevented = true;
          }
        };
        view.dispatchEvent = (event: { type: string; detail: unknown; defaultPrevented: boolean; preventDefault(): void }) => {
          sent.events.push({ type: event.type, detail: event.detail as Fitted['events'][number]['detail'] });
          if (sent.handle.take) event.preventDefault();
          return !event.defaultPrevented;
        };
      },
    };
  };
  const pickers = (host: FakeElement) => host.findAll((el) => el.tagName === 'input' && el.type === 'file');
  const attach = (host: FakeElement, files: File[], which = 0) => {
    const picker = pickers(host)[which]!;
    picker.files = files;
    picker.fire('change');
  };

  it('offers a paperclip that opens the file picker, for photos and common documents', () => {
    const { page } = fitted();
    const { host, byClass } = setup(answering(toCalendar), {}, { page });
    const [picker] = pickers(host);
    let opened = 0;
    picker!.click = () => void opened++;
    byClass('attach').fire('click');
    expect(opened).toBe(1);
    expect(picker!.multiple).toBe(true);
    expect(String(picker!.accept)).toMatch(/image\/\*/);
    expect(String(picker!.accept)).toMatch(/pdf/);
    expect(text(byClass('attach'))).toContain('Attach a photo or file');
  });

  it('offers a camera only where the device is touch-first, and opens the rear camera', () => {
    const desktop = setup(answering(toCalendar), {}, { page: fitted(false).page });
    expect(desktop.byClass('camera').hidden).toBe(true);
    const phone = setup(answering(toCalendar), {}, { page: fitted(true).page });
    expect(phone.byClass('camera').hidden).toBe(false);
    const camera = pickers(phone.host)[1]!;
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(String(camera.accept)).toBe('image/*');
    let opened = 0;
    camera.click = () => void opened++;
    phone.byClass('camera').fire('click');
    expect(opened).toBe(1);
  });

  // Found reading the tab trap for the NVDA pass, 2026-09-22: the trap lists its stops, the paperclip was
  // not among them, and "at <= 0" took an unlisted control for the first one — so Shift+Tab from the
  // paperclip jumped to Send, the far end of the screen.
  it('lets Shift+Tab step back from the paperclip, not throw focus to the far end', async () => {
    const { orb, screen, doc, byClass, input } = setup(answering({}), {}, { page: fitted(true).page });
    orb.fire('click');
    await settle(50);
    const paperclip = byClass('attach');
    paperclip.focus();
    expect(screen.fire('keydown', { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(false);
    expect(doc.activeElement).toBe(paperclip);
    // …and it is a stop of the screen's own, so Tab from the camera reaches the box as the page draws it.
    byClass('camera').focus();
    expect(screen.fire('keydown', { key: 'Tab' }).defaultPrevented).toBe(false);
    input.focus();
    expect(doc.activeElement).toBe(input);
  });

  it('is off unless the adopter turns it on — a button that goes nowhere is a dead end', () => {
    const { byClass } = baseSetup(answering(toCalendar), {}, { page: fitted(true).page });
    expect(byClass('attach').hidden).toBe(true);
    expect(byClass('camera').hidden).toBe(true);
  });

  it('is left out entirely when the adopter says the app has nowhere to send a file', () => {
    const { page } = fitted(true);
    const { host, byClass, input, screen, all } = setup(answering(toCalendar), { attach: false }, { page });
    expect(byClass('attach').hidden).toBe(true);
    expect(byClass('camera').hidden).toBe(true);
    // …and pasting or dropping a file does not sneak one in.
    const event = (extra: object) => extra as never;
    expect(input.fire('paste', event({ clipboardData: { files: [file('a.png')] } })).defaultPrevented).toBe(false);
    expect(screen.fire('dragover', event({ dataTransfer: { types: ['Files'] } })).defaultPrevented).toBe(false);
    attach(host, [file('a.png')]);
    expect(all('attach-item')).toHaveLength(0);
    // The box is the same width it was before any of this existed: the full placeholder, not the short one.
    expect(input.placeholder).toBe('Ask anything about this app');
  });

  it('asks in fewer words where the row is crowded, so the box is not clipped mid-sentence', () => {
    const desktop = setup(answering(toCalendar), {}, { page: fitted(false).page });
    expect(desktop.input.placeholder).toBe('Ask anything about this app');
    const phone = setup(answering(toCalendar), {}, { page: fitted(true).page });
    expect(phone.input.placeholder).toBe('Ask anything');
    expect(String(phone.input.placeholder).length).toBeLessThanOrEqual(16);
  });

  it('shows what was chosen, with a way to take each one back, and says how many in the status line', () => {
    const { page } = fitted();
    const { host, all, byClass, caption } = setup(answering(toCalendar), {}, { page });
    expect(byClass('tray').hidden).toBe(true);
    attach(host, [file('certificate.pdf', 'application/pdf'), file('photo.png')]);
    expect(all('attach-item').map(text).join(' ')).toContain('certificate.pdf');
    expect(all('attach-item').map(text).join(' ')).toContain('photo.png');
    expect(byClass('tray').hidden).toBe(false);
    expect(text(caption)).toBe('2 files attached');
    // Each has a remove button that names what it removes.
    expect(all('attach-x').map(text)).toEqual(['Remove certificate.pdf', 'Remove photo.png']);
    all('attach-x')[0]!.fire('click');
    expect(all('attach-item')).toHaveLength(1);
    all('attach-x')[0]!.fire('click');
    expect(byClass('tray').hidden).toBe(true);
  });

  it('turns away what is too many, too large, empty or not a photo or document — and says why, with the real limit', () => {
    const { page } = fitted();
    const { host, all, caption } = setup(answering(toCalendar), {}, { page });
    attach(host, ['a', 'b', 'c', 'd', 'e'].map((n) => file(`${n}.png`)));
    expect(all('attach-item')).toHaveLength(4);
    expect(text(caption)).toContain('up to 4');

    attach(host, [file('setup.exe', 'application/x-msdownload')]);
    expect(text(caption)).toContain('can’t be attached');
    const big = setup(answering(toCalendar), {}, { page: fitted().page });
    attach(big.host, [file('huge.pdf', 'application/pdf', 16 * 1024 * 1024)]);
    expect(text(big.caption)).toContain('15 MB');
    expect(big.all('attach-item')).toHaveLength(0);
    attach(big.host, [file('empty.pdf', 'application/pdf', 0)]);
    expect(text(big.caption)).toContain('empty');
  });

  it('takes a photo pasted into the box and a file dropped on the screen, as it does one chosen', () => {
    const { page } = fitted();
    const { input, screen, all } = setup(answering(toCalendar), {}, { page });
    // The fake event carries only what a test hands it; a browser's paste and drop events carry these.
    const event = (extra: object) => extra as never;
    const pasted = input.fire('paste', event({ clipboardData: { files: [file('pasted.png')] } }));
    expect(pasted.defaultPrevented).toBe(true);
    // Pasting text is left alone.
    expect(input.fire('paste', event({ clipboardData: { files: [] } })).defaultPrevented).toBe(false);
    const over = screen.fire('dragover', event({ dataTransfer: { types: ['Files'] } }));
    expect(over.defaultPrevented).toBe(true);
    screen.fire('drop', event({ dataTransfer: { types: ['Files'], files: [file('dropped.pdf', 'application/pdf')] } }));
    expect(all('attach-item').map(text).join(' ')).toMatch(/pasted\.png.*dropped\.pdf|dropped\.pdf.*pasted\.png/);
    expect(screen.dataset.dropping).toBe('false');
  });

  it('sends only the words to the router, shows the files in the visitor’s message, and empties the tray', async () => {
    const { page, sent } = fitted();
    const routed = answering(toCalendar);
    const { mounted, host, all, thread, byClass } = setup(routed, {}, { page });
    attach(host, [file('certificate.pdf', 'application/pdf')]);
    const done = mounted.ask('where do I put this?');
    await settle(2000);
    await done;
    // The router is handed a string, and nothing else. Never a file, never its name.
    expect(routed.asked).toEqual(['where do I put this?']);
    expect(routed.asked.every((said) => typeof said === 'string' && !said.includes('certificate'))).toBe(true);
    expect(all('msg-file').map(text).join(' ')).toContain('certificate.pdf');
    expect(all('user').map(text).join(' ')).toContain('where do I put this?');
    expect(all('attach-item')).toHaveLength(0);
    expect(byClass('tray').hidden).toBe(true);
    expect(text(thread)).toContain('Opening Calendar');
    expect(sent.events).toHaveLength(1);
  });

  it('hands the files to the page as a cancelable event, with the words and where the visitor was', async () => {
    const { page, sent } = fitted();
    const { mounted, host } = setup(answering(toCalendar), {}, { page, path: '/claims' });
    const files = [file('a.png'), file('b.pdf', 'application/pdf')];
    attach(host, files);
    const done = mounted.ask('this is for my claim');
    await settle(2000);
    await done;
    expect(sent.events[0]!.type).toBe('nextgen:attach');
    expect(sent.events[0]!.detail).toEqual({ files, utterance: 'this is for my claim', route: '/claims' });
  });

  it('says it kept them on the device when the page did not take them, and that it passed them on when it did', async () => {
    const kept = fitted();
    const a = setup(answering(toCalendar), {}, { page: kept.page });
    attach(a.host, [file('a.png')]);
    const first = a.mounted.ask('where does this go?');
    await settle(2000);
    await first;
    expect(text(a.thread)).toContain('stays on this device');
    expect(text(a.thread)).not.toContain('passed your attachment');

    const taken = fitted();
    taken.sent.handle.take = true;
    const b = setup(answering(toCalendar), {}, { page: taken.page });
    attach(b.host, [file('a.png')]);
    const second = b.mounted.ask('where does this go?');
    await settle(2000);
    await second;
    expect(text(b.thread)).toContain('passed your attachment to the app');
    expect(text(b.thread)).not.toContain('stays on this device');
  });

  it('answers a message that is only a file: no router, no refusal, and the one question that lets it help', async () => {
    const { page, sent } = fitted();
    const routed = answering(toCalendar);
    const { mounted, host, thread } = setup(routed, {}, { page });
    attach(host, [file('receipt.pdf', 'application/pdf')]);
    const done = mounted.ask('');
    await settle(2000);
    await done;
    expect(routed.asked).toEqual([]);
    expect(text(thread)).toContain('Thanks — I’ve got it.');
    expect(text(thread)).toContain('nothing leaves your device');
    expect(text(thread)).not.toContain('can’t help with that');
    expect(sent.events).toHaveLength(1);
    expect(sent.events[0]!.detail.utterance).toBe('');
  });

  it('does nothing at all for no words and no file', async () => {
    const routed = answering(toCalendar);
    const { mounted, thread } = setup(routed);
    expect(await mounted.ask('   ')).toBeNull();
    expect(routed.asked).toEqual([]);
    expect(text(thread)).not.toContain('Thanks');
  });

  it('never makes a network request of its own for what was attached', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    try {
      const { page } = fitted();
      const { mounted, host } = setup(answering(toCalendar), {}, { page });
      attach(host, [file('a.png')]);
      const done = mounted.ask('here you go');
      await settle(2000);
      await done;
      expect(fetched).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lets go of what was attached when the conversation is started over', () => {
    const { page } = fitted();
    const { host, all, byClass } = setup(answering(toCalendar), {}, { page });
    attach(host, [file('a.png'), file('b.png')]);
    expect(all('attach-item')).toHaveLength(2);
    byClass('restart').fire('click');
    expect(all('attach-item')).toHaveLength(0);
    expect(byClass('tray').hidden).toBe(true);
  });
});

describe('"Why?"', () => {
  it('every answer carries its own reasons: how it was decided, how long it took, what it weighed', async () => {
    const { mounted, host, byClass, all } = setup(answering(clarifying));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    const details = host.find((el) => el.tagName === 'details')!;
    expect(details.find((el) => el.tagName === 'summary')!.textContent).toBe('Why?');
    expect(byClass('why-how').textContent).toBe('Decided by similarity to what this app declares in 12 ms, with no model call.');
    expect(all('why-name').map((el) => el.textContent)).toEqual(['Calendar', 'Squad']);
    expect(all('why-score').map((el) => el.textContent)).toEqual(['0.50', '0.40']);
  });

  /**
   * ADR-019 (WP-53). A count, never the removed sentence itself — that stayed unsafe or
   * unverifiable to show, and this panel is not a back door around that.
   */
  it('discloses that part of a written answer was left out, without repeating what was removed', async () => {
    const { mounted, byClass } = setup(
      answering({
        ...clarifying,
        prose: null,
        proseRemoved: [{ sentence: 'Try /admin/billing for that too.', reason: 'unknown-reference' }],
      }),
    );
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(byClass('why-removed').textContent).toBe('Part of the answer was left out because it could not be checked.');
    expect(byClass('why-removed').textContent).not.toContain('/admin/billing');
  });

  it('says nothing extra when nothing was removed', async () => {
    const { mounted, byClass } = setup(answering(clarifying));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(byClass('why-removed')).toBeUndefined();
  });

  it('pluralises the count of removed parts', async () => {
    const { mounted, byClass } = setup(
      answering({
        ...clarifying,
        proseRemoved: [
          { sentence: 'a', reason: 'unknown-reference' },
          { sentence: 'b', reason: 'action-claim' },
        ],
      }),
    );
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(byClass('why-removed').textContent).toBe('2 parts of the answer were left out because they could not be checked.');
  });
});

describe('reading answers aloud', () => {
  class Utterance {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    onboundary: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  it('reads a typed answer in a local voice, and stops once the visitor turns it off', async () => {
    const spoken: Utterance[] = [];
    const local = { name: 'US', lang: 'en-US', localService: true, default: true, voiceURI: 'US' } as SpeechSynthesisVoice;
    const synth = { getVoices: () => [local], speak: (u: Utterance) => void spoken.push(u), cancel: () => undefined };
    const { env } = localVoice({
      getUserMedia: null,
      synth: synth as unknown as SpeechSynthesis,
      Utterance: Utterance as unknown as VoiceEnv['Utterance'],
    });
    const { mounted, sound, preferences } = setup(answering(clarifying), { voiceEnv: env });
    expect(sound.hidden).toBe(false);
    expect(sound.getAttribute('aria-pressed')).toBe('true');

    const first = mounted.ask('games');
    await settle(0);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.text.startsWith('Two places could help with that:')).toBe(true);
    expect(spoken[0]!.voice).toBe(local);
    spoken[0]!.onend!();
    await settle(0);
    await first;

    sound.fire('click');
    expect(sound.getAttribute('aria-pressed')).toBe('false');
    expect(preferences.getItem('nextgen:read-aloud')).toBe('off');
    const second = mounted.ask('games again');
    await settle(3000);
    await second;
    expect(spoken).toHaveLength(1);
  });

  it('reads a greeting as sentences: a title that ends in punctuation is not given another full stop', async () => {
    const spoken: Utterance[] = [];
    const local = { name: 'US', lang: 'en-US', localService: true, default: true, voiceURI: 'US' } as SpeechSynthesisVoice;
    const synth = { getVoices: () => [local], speak: (u: Utterance) => void spoken.push(u), cancel: () => undefined };
    const { env } = localVoice({
      getUserMedia: null,
      synth: synth as unknown as SpeechSynthesis,
      Utterance: Utterance as unknown as VoiceEnv['Utterance'],
    });
    const { mounted } = setup(answering(toCalendar), { voiceEnv: env });
    const asking = mounted.ask('hi');
    await settle(0);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.text).toBe('Hi! How can I help? Tell me what you want to do, in your own words, and I’ll take you there.');
    spoken[0]!.onend!();
    await settle(0);
    await asking;
  });
});

describe('hands-free voice', () => {
  it('the microphone button turns listening on and off, and remembers the choice', async () => {
    const { env, made, tracks } = localVoice();
    const { mic, screen, caption, preferences } = setup(answering({}), { voiceEnv: env });
    await settle(0);
    expect(mic.hidden).toBe(false);

    mic.fire('click');
    await settle(50);
    expect(screen.dataset.open).toBe('true');
    expect(preferences.getItem('nextgen:hands-free')).toBe('on');
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    expect(made).toHaveLength(1);
    expect(made[0]!.processLocally).toBe(true);
    expect(caption.textContent).toBe('Listening…');

    mic.fire('click');
    await settle(0);
    expect(preferences.getItem('nextgen:hands-free')).toBe('off');
    expect(mic.getAttribute('aria-pressed')).toBe('false');
    expect(tracks[0]!.stopped).toBe(1);
  });

  it('a remembered choice listens when the screen opens; a spoken question is answered, and leaving closes the microphone', async () => {
    const { env, made, tracks } = localVoice();
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:hands-free', 'on');
    const assistant = answering(toCalendar);
    const { orb, moves } = setup(assistant, { voiceEnv: env, preferences });
    await settle(0);
    expect(made).toHaveLength(0); // nothing listens on the original pages

    orb.fire('click');
    await settle(50);
    expect(made).toHaveLength(1);
    made[0]!.onresult!(heard('where is the calendar'));
    await settle(4000);
    expect(assistant.asked).toEqual(['where is the calendar']);
    expect(moves).toEqual(['/calendar']);
    expect(tracks[0]!.stopped).toBe(1);
  });

  it('stops listening while it answers, so it never hears itself, and listens again afterwards', async () => {
    const { env, made } = localVoice();
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:hands-free', 'on');
    const { orb, caption } = setup(answering(clarifying), { voiceEnv: env, preferences });
    await settle(0);
    orb.fire('click');
    await settle(50);
    made[0]!.onresult!(heard('games'));
    await settle(0);
    expect(made[0]!.aborted).toBe(true);
    await settle(3000);
    expect(made).toHaveLength(2);
    expect(made[1]!.started).toBe(true);
    expect(caption.textContent).toBe('Listening…');
  });

  it('the landing page listens straight away for a visitor who turned it on before', async () => {
    const { env, made } = localVoice();
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:hands-free', 'on');
    setup(answering({}), { voiceEnv: env, preferences, home: ['/home'] });
    await settle(100);
    expect(made).toHaveLength(1);
    expect(made[0]!.processLocally).toBe(true);
  });
});

describe('setting voice up', () => {
  it('never downloads a speech pack without a tap; the landing page says what to do instead', async () => {
    const { env, made, installed } = localVoice({}, { status: 'downloadable' });
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:hands-free', 'on');
    const { caption } = setup(answering({}), { voiceEnv: env, preferences, home: ['/home'] });
    await settle(100);
    expect(installed).toHaveLength(0);
    expect(made).toHaveLength(0);
    expect(caption.textContent).toBe('Tap the microphone to set up voice on this device. It downloads once.');
  });

  it('tapping the microphone installs the pack, then listens', async () => {
    const { env, made, installed } = localVoice({}, { status: 'downloadable' });
    const { mic } = setup(answering({}), { voiceEnv: env });
    await settle(0);
    mic.fire('click');
    await settle(50);
    expect(installed).toEqual([{ langs: ['en-US'], processLocally: true }]);
    expect(made).toHaveLength(1);
    expect(made[0]!.started).toBe(true);
  });

  it('a download that fails does not stick: the next tap tries again', async () => {
    const { env, made, installed } = localVoice({}, { status: 'downloadable', installs: false });
    const { mic, caption } = setup(answering({}), { voiceEnv: env });
    await settle(0);
    mic.fire('click');
    await settle(50);
    expect(installed).toHaveLength(1);
    expect(made).toHaveLength(0);
    expect(caption.textContent).toBe('Tap the microphone to set up voice on this device. It downloads once.');
    mic.fire('click'); // off
    mic.fire('click'); // on again
    await settle(50);
    expect(installed).toHaveLength(2);
  });
});

describe('spoken commands', () => {
  it('act at once instead of being asked: menu opens the menu, fechar closes the screen', async () => {
    const assistant = answering({});
    const { mounted, screen, drawer } = setup(assistant, {}, { page: clubPage });
    await mounted.ask('menu');
    expect(screen.dataset.open).toBe('true');
    expect(drawer.dataset.open).toBe('true');
    await mounted.ask('Fechar, por favor.');
    expect(screen.dataset.open).toBe('false');
    expect(assistant.asked).toEqual([]);
  });

  it('voltar goes back a page', async () => {
    const assistant = answering({});
    const { mounted, doc } = setup(assistant);
    mounted.open();
    await mounted.ask('voltar');
    expect(doc.defaultView!.wentBack).toBe(1);
    expect(assistant.asked).toEqual([]);
  });

  it('anything longer is still a question for the router', async () => {
    const assistant = answering(clarifying);
    const { mounted } = setup(assistant);
    const done = mounted.ask('fechar a inscrição do meu filho');
    await settle(2000);
    await done;
    expect(assistant.asked).toEqual(['fechar a inscrição do meu filho']);
  });

  it('a hands-free "fechar" closes the screen, and the microphone with it', async () => {
    const { env, made, tracks } = localVoice();
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:hands-free', 'on');
    const assistant = answering({});
    const { orb, screen } = setup(assistant, { voiceEnv: env, preferences });
    await settle(0);
    orb.fire('click');
    await settle(50);
    made[0]!.onresult!(heard('fechar'));
    await settle(0);
    expect(screen.dataset.open).toBe('false');
    expect(tracks[0]!.stopped).toBe(1);
    expect(assistant.asked).toEqual([]);
  });
});

describe('when routing fails', () => {
  it('says so, and moves nothing', async () => {
    const broken: Routable = { registry, route: () => Promise.reject(new Error('boom')) };
    const { mounted, thread, moves } = setup(broken);
    const done = mounted.ask('anything');
    await settle(3000);
    await done;
    expect(thread.textContent).toContain('Something went wrong');
    expect(moves).toEqual([]);
  });
});

describe('the conversation is a chat', () => {
  const messages = (thread: FakeElement): FakeElement[] => thread.children.filter((el) => /(^|\s)msg(\s|$)/.test(String(el.className)));
  const who = (el: FakeElement): 'user' | 'assistant' => (/(^|\s)user(\s|$)/.test(String(el.className)) ? 'user' : 'assistant');
  const has = (el: FakeElement, name: string): boolean => new RegExp(`(^|\\s)${name}(\\s|$)`).test(String(el.className));

  it('is a log that starts with the greeting as the assistant’s first message', () => {
    const { thread, screen, byClass } = setup(answering({}));
    expect(thread.getAttribute('role')).toBe('log');
    expect(messages(thread).map(who)).toEqual(['assistant']);
    expect(byClass('greeting').textContent).toBe('Ready when you are.');
    expect(screen.dataset.conversation).toBe('false');
  });

  it('adds the visitor’s own words, then the answer, and becomes a conversation', async () => {
    const { mounted, thread, screen } = setup(answering(clarifying));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(messages(thread).map(who)).toEqual(['assistant', 'user', 'assistant']);
    expect(messages(thread)[1]!.textContent).toBe('games');
    expect(screen.dataset.conversation).toBe('true');
  });

  it('keeps every turn, in order, with the earlier options still there to follow', async () => {
    const { mounted, thread, all } = setup(answering(clarifying, clarifying));
    for (const question of ['games', 'more games']) {
      const done = mounted.ask(question);
      await settle(2000);
      await done;
    }
    expect(messages(thread).map(who)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(messages(thread).filter((m) => who(m) === 'user').map((m) => m.textContent)).toEqual(['games', 'more games']);
    expect(all('chip')).toHaveLength(4);
  });

  it('shows that it is thinking while it works, and nothing left over once it has answered', async () => {
    let answer!: (turn: TurnTrace) => void;
    const slow: Routable = { registry, route: () => new Promise<TurnTrace>((resolve) => (answer = resolve)) };
    const { mounted, thread, all } = setup(slow);
    const done = mounted.ask('where is the calendar');
    await settle(10);
    expect(all('typing')).toHaveLength(1);
    expect(messages(thread).map(who)).toEqual(['assistant', 'user', 'assistant']);
    expect(has(messages(thread)[2]!, 'typing')).toBe(true);
    answer(trace(clarifying));
    await settle(3000);
    await done;
    expect(all('typing')).toHaveLength(0);
    expect(messages(thread)).toHaveLength(3);
  });

  it('answers a failure as a message too, and the conversation goes on', async () => {
    const broken: Routable = { registry, route: () => Promise.reject(new Error('boom')) };
    const { mounted, thread, all } = setup(broken);
    const done = mounted.ask('anything');
    await settle(3000);
    await done;
    expect(messages(thread).map(who)).toEqual(['assistant', 'user', 'assistant']);
    expect(messages(thread)[2]!.textContent).toContain('Something went wrong');
    expect(all('typing')).toHaveLength(0);
  });

  it('shows what the visitor typed as text and never as markup', async () => {
    const hostile = '<img src=x onerror="alert(1)"> **bold**';
    const { mounted, thread, host } = setup(answering(clarifying));
    const done = mounted.ask(hostile);
    await settle(2000);
    await done;
    expect(messages(thread)[1]!.textContent).toBe(hostile);
    expect(host.findAll((el) => el.tagName === 'img')).toHaveLength(0);
  });

  it('scrolls to the newest message', async () => {
    const { mounted, thread } = setup(answering(clarifying));
    thread.scrollHeight = 480;
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(thread.scrollTop).toBe(480);
  });

  it('stays a bounded page: the greeting and the latest turns, not everything ever said', async () => {
    const { mounted, thread } = setup(answering(clarifying));
    for (let i = 0; i < 45; i++) {
      const done = mounted.ask(`question ${i}`);
      await settle(2000);
      await done;
    }
    const all = messages(thread);
    expect(all.length).toBeLessThanOrEqual(60);
    expect(all[0]!.textContent).toMatch(/^Ready when you are\./);
    expect(all[all.length - 1]!.textContent).toContain('Two places could help with that:');
    expect(all[all.length - 2]!.textContent).toBe('question 44');
  });

  it('keeps the dialog named by the greeting, which is still in the page', () => {
    const { screen, byClass } = setup(answering({}));
    expect(screen.getAttribute('aria-labelledby')).toBe('nextgen-greeting');
    expect(byClass('greeting').id).toBe('nextgen-greeting');
  });
});

describe('chat extras — start over, copy, recall', () => {
  const messages = (thread: FakeElement): FakeElement[] => thread.children.filter((el) => /(^|\s)msg(\s|$)/.test(String(el.className)));
  const withClipboard = (writeText: (text: string) => Promise<void>) => (doc: FakeDocument) => {
    (doc.defaultView as unknown as { navigator: unknown }).navigator = { clipboard: { writeText } };
  };
  const answer = async (mounted: { ask: (q: string) => Promise<unknown> }, question: string) => {
    const done = mounted.ask(question);
    await settle(2000);
    await done;
  };

  it('offers to start over only once there is something to start over from', async () => {
    const { mounted, byClass } = setup(answering(clarifying));
    const restart = byClass('restart');
    expect(restart.hidden).toBe(true);
    await answer(mounted, 'games');
    expect(restart.hidden).toBe(false);
  });

  it('starts over: the greeting again, the landing page again, and the composer ready', async () => {
    const { mounted, thread, screen, byClass, all, input, doc } = setup(answering(clarifying));
    await answer(mounted, 'games');
    expect(messages(thread)).toHaveLength(3);
    byClass('restart').fire('click');
    await settle(10);
    expect(messages(thread).map((m) => m.textContent)).toEqual([`Ready when you are.${WORDS.en.greetingHint}`]);
    expect(screen.dataset.conversation).toBe('false');
    expect(byClass('restart').hidden).toBe(true);
    expect(all('chip')).toHaveLength(0);
    expect(doc.activeElement).toBe(input);
  });

  it('does not let an answer that was still being worked out arrive into the fresh conversation', async () => {
    let resolve!: (turn: TurnTrace) => void;
    const slow: Routable = { registry, route: () => new Promise<TurnTrace>((r) => (resolve = r)) };
    const { mounted, thread, byClass, all } = setup(slow);
    const done = mounted.ask('games');
    await settle(10);
    byClass('restart').fire('click');
    resolve(trace(clarifying));
    await settle(3000);
    await done;
    expect(messages(thread)).toHaveLength(1);
    expect(all('typing')).toHaveLength(0);
    expect(all('chip')).toHaveLength(0);
  });

  it('copies an answer as plain text, says so, and stops saying so', async () => {
    const copied: string[] = [];
    const { mounted, all, caption } = setup(answering(clarifying), {}, { page: withClipboard(async (text) => void copied.push(text)) });
    await answer(mounted, 'games');
    all('copy')[0]!.fire('click');
    await settle(10);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain('Two places could help with that:');
    expect(copied[0]).toContain('Calendar');
    expect(copied[0]).toContain('/calendar');
    expect(caption.textContent).toBe('Copied');
    await settle(2500);
    expect(caption.textContent).toBe('');
  });

  it('says so when the browser will not let it copy, rather than pretending it did', async () => {
    const { mounted, all, caption } = setup(answering(clarifying), {}, { page: withClipboard(() => Promise.reject(new Error('denied'))) });
    await answer(mounted, 'games');
    all('copy')[0]!.fire('click');
    await settle(10);
    expect(caption.textContent).toBe('Could not copy');
  });

  it('offers no copy where the browser has no clipboard to offer', async () => {
    const { mounted, all } = setup(answering(clarifying));
    await answer(mounted, 'games');
    expect(all('copy')).toHaveLength(0);
  });

  it('keeps "Why?" and Copy together in one quiet row under the answer', async () => {
    const { mounted, all } = setup(answering(clarifying), {}, { page: withClipboard(async () => undefined) });
    await answer(mounted, 'games');
    const tools = all('msg-tools');
    expect(tools).toHaveLength(1);
    expect(tools[0]!.findAll((el) => /(^|\s)copy(\s|$)/.test(String(el.className)))).toHaveLength(1);
    expect(tools[0]!.findAll((el) => /(^|\s)why(\s|$)/.test(String(el.className)))).toHaveLength(1);
  });

  it('recalls what was asked with the arrow keys, as any chat does — and never over what is being typed', async () => {
    const { mounted, input } = setup(answering(clarifying, clarifying));
    await answer(mounted, 'first question');
    await answer(mounted, 'second question');
    expect(input.value).toBe('');
    expect(input.fire('keydown', { key: 'ArrowUp' }).defaultPrevented).toBe(true);
    expect(input.value).toBe('second question');
    input.fire('keydown', { key: 'ArrowUp' });
    expect(input.value).toBe('first question');
    input.fire('keydown', { key: 'ArrowUp' });
    expect(input.value).toBe('first question');
    input.fire('keydown', { key: 'ArrowDown' });
    expect(input.value).toBe('second question');
    input.fire('keydown', { key: 'ArrowDown' });
    expect(input.value).toBe('');
    input.value = 'half a thought';
    expect(input.fire('keydown', { key: 'ArrowUp' }).defaultPrevented).toBe(false);
    expect(input.value).toBe('half a thought');
  });
});

describe('the composer’s edge light', () => {
  it('rests with the screen shut, in the accent of the page it sits on', () => {
    const { byClass, host } = setup(answering({}));
    const composer = byClass('composer');
    expect(composer.getAttribute('data-state')).toBe('idle');
    expect(composer.children.some((el) => el.getAttribute('aria-hidden') === 'true' && String(el.className) === 'beam')).toBe(true);
    for (const name of ['--ng-beam-1', '--ng-beam-2', '--ng-beam-3', '--ng-beam-e']) expect(host.style[name]).toMatch(/^rgb\(/);
  });

  it('thinks while the router works, and rests once it has answered', async () => {
    let answer!: (turn: TurnTrace) => void;
    const slow: Routable = { registry, route: () => new Promise<TurnTrace>((resolve) => (answer = resolve)) };
    const { mounted, byClass } = setup(slow);
    const composer = byClass('composer');
    const done = mounted.ask('where is the calendar');
    await settle(10);
    expect(composer.getAttribute('data-state')).toBe('thinking');
    answer(trace(clarifying));
    await settle(5000);
    await done;
    expect(composer.getAttribute('data-state')).toBe('idle');
  });

  it('holds the danger colour when routing fails, then rests', async () => {
    const broken: Routable = { registry, route: () => Promise.reject(new Error('boom')) };
    const { mounted, byClass } = setup(broken);
    const composer = byClass('composer');
    const done = mounted.ask('anything');
    await settle(50);
    expect(composer.getAttribute('data-state')).toBe('error');
    await settle(2000);
    await done;
    expect(composer.getAttribute('data-state')).toBe('idle');
  });
});

describe('destroy', () => {
  it('removes the layer and gives the page its scrolling back', async () => {
    const { mounted, doc, orb } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    mounted.destroy();
    expect(doc.body.children.some((el) => el.hasAttribute('data-nextgen-assistant'))).toBe(false);
    expect(doc.documentElement.style.overflow).toBe('');
  });
});
