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
    // A panel beside the page, not a modal over it — until it is expanded.
    expect(screen.getAttribute('aria-modal')).toBe('false');
    expect(screen.dataset.size).toBe('compact');
    expect(screen.hasAttribute('inert')).toBe(true);
  });

  it('writes nothing beside the orb, pointed at or focused: its name is for a screen reader only', () => {
    const { orb, bubble } = setup(answering({}));
    orb.fire('pointerenter', { pointerType: 'mouse' } as never);
    orb.fire('focus');
    expect(bubble.textContent).toBe('');
    expect(String(bubble.className).split(' ')).toContain('sr-only');
    expect(orb.getAttribute('aria-label')).toBe('Open the assistant');
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

/** What the page's own scrolling is set to, with nothing set read as the page's own default. */
const overflow = (doc: FakeDocument): string => doc.documentElement.style.overflow ?? '';

describe('the landing page', () => {
  it('on a home route the panel opens by itself, with focus in the composer', async () => {
    const { screen, doc, input } = setup(answering({}), { home: ['/home'] });
    await settle(100);
    expect(screen.dataset.open).toBe('true');
    expect(screen.dataset.size).toBe('compact');
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
    expect(overflow(doc)).toBe('');
  });

  it('taking the user to the landing route keeps the panel open there, rather than leaving a note', async () => {
    const { mounted, screen, bubble, moves } = setup(answering(toCalendar), { home: ['/calendar'] });
    void mounted.ask('where is the calendar');
    await settle(3500);
    expect(moves).toEqual(['/calendar']);
    expect(screen.dataset.open).toBe('true');
    expect(bubble.textContent).toBe('');
  });
});

describe('opening the panel', () => {
  it('moves focus in, leaves the page scrolling beside it, and offers no pre-written questions', async () => {
    const { orb, screen, input, doc, host, byClass } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    expect(screen.dataset.open).toBe('true');
    expect(screen.dataset.size).toBe('compact');
    expect(screen.hasAttribute('inert')).toBe(false);
    expect(doc.activeElement).toBe(input);
    expect(overflow(doc)).toBe('');
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
    expect(overflow(doc)).toBe('');
  });

  it('lets Tab walk on into the page: a panel beside it is not a trap', async () => {
    const { orb, screen, send } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    send.focus();
    expect(screen.fire('keydown', { key: 'Tab' }).defaultPrevented).toBe(false);
  });

  it('has every control of the full screen: expand, start over, and close — and no menu of its own', async () => {
    const { orb, host, byClass } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    for (const name of ['expand', 'restart', 'close']) expect(byClass(name).hidden, name).not.toBe(true);
    expect(host.find((el) => String(el.className ?? '').split(' ').some((c) => c === 'menu' || c === 'drawer'))).toBeUndefined();
  });
});

describe('expanding the panel', () => {
  it('fills the screen as a modal: the page stops scrolling, Tab stays in, and the button says it shrinks', async () => {
    const { orb, screen, doc, byClass, send } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    const expand = byClass('expand');
    expand.fire('click');
    expect(screen.dataset.size).toBe('full');
    expect(screen.getAttribute('aria-modal')).toBe('true');
    expect(expand.getAttribute('aria-pressed')).toBe('true');
    expect(expand.textContent).toBe('Smaller');
    expect(overflow(doc)).toBe('hidden');
    send.focus();
    expect(screen.fire('keydown', { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(expand);

    expand.fire('click');
    expect(screen.dataset.size).toBe('compact');
    expect(screen.getAttribute('aria-modal')).toBe('false');
    expect(overflow(doc)).toBe('');
  });

  it('can be asked for by the page: open({ expanded: true })', async () => {
    const { mounted, screen, doc } = setup(answering({}));
    mounted.open({ expanded: true });
    await settle(50);
    expect(screen.dataset.size).toBe('full');
    mounted.close();
    expect(overflow(doc)).toBe('');
    // Closed and opened again, it is the panel again.
    mounted.open();
    expect(screen.dataset.size).toBe('compact');
  });

  it("leaves the app's own sidebar in view, and returns to its corner when the visitor reaches for it", async () => {
    const { orb, screen, byClass, doc } = setup(answering({}), {}, {
      page: (d) => {
        const aside = d.createElement('aside');
        aside.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 768 });
        d.body.append(aside);
      },
    });
    orb.fire('click');
    await settle(50);
    byClass('expand').fire('click');
    expect(screen.style['--ng-frame-left']).toBe('240px');
    expect(screen.style['--ng-frame-top']).toBe('0px');
    // A press on the page — here, its sidebar — goes past the panel's own layer.
    for (const listener of doc.defaultView!.listeners.get('pointerdown') ?? []) (listener as (e: unknown) => void)({ target: doc.body });
    expect(screen.dataset.size).toBe('compact');
    expect(screen.dataset.open).toBe('true');
  });
});

describe('a turn that resolves to a place', () => {
  it('says where it is going and moves at once — not after the answer is read — with the panel still open beside the page', async () => {
    const { mounted, thread, screen, moves, storage } = setup(answering(toCalendar));
    void mounted.ask('where is the calendar');
    await settle(0);
    expect(thread.textContent).toContain('Opening Calendar');
    expect(moves).toEqual(['/calendar']);
    expect(screen.dataset.open).toBe('true');
    await settle(400);
    // The conversation already said where; the note is used up, not repeated.
    expect(storage.items.size).toBe(0);
  });

  it('shrinks back to its corner to move, so the new page can be seen', async () => {
    const { mounted, screen, byClass, moves } = setup(answering(toCalendar));
    mounted.open({ expanded: true });
    await settle(50);
    expect(byClass('expand').getAttribute('aria-pressed')).toBe('true');
    void mounted.ask('where is the calendar');
    await settle(0);
    expect(moves).toEqual(['/calendar']);
    expect(screen.dataset.size).toBe('compact');
  });

  it('moves without waiting for a voice that is still reading the answer aloud', async () => {
    const spoken: string[] = [];
    const local = { name: 'US', lang: 'en-US', localService: true, default: true, voiceURI: 'US' } as SpeechSynthesisVoice;
    const synth = { getVoices: () => [local], speak: (u: { text: string }) => void spoken.push(u.text), cancel: () => undefined };
    class Utterance {
      text: string;
      lang = '';
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onboundary: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const { env } = localVoice({
      getUserMedia: null,
      synth: synth as unknown as SpeechSynthesis,
      Utterance: Utterance as unknown as VoiceEnv['Utterance'],
    });
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:read-aloud', 'on');
    const { mounted, moves } = setup(answering(toCalendar), { voiceEnv: env, preferences });
    void mounted.ask('where is the calendar');
    await settle(0);
    // The voice never says it has finished; the move has happened all the same.
    expect(spoken).toHaveLength(1);
    expect(moves).toEqual(['/calendar']);
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

  it('does not go anywhere once the user has closed it while it was still working the answer out', async () => {
    const { mounted, moves, storage } = setup(answering(toCalendar));
    void mounted.ask('where is the calendar');
    mounted.close();
    await settle(4000);
    expect(moves).toEqual([]);
    expect(storage.items.size).toBe(0);
  });
});

describe('the next page', () => {
  it('picks up the note: the orb is already on that side, and says where the user is to a screen reader only', async () => {
    const storage = new MemoryStorage();
    storage.setItem('nextgen:arrival', JSON.stringify({ title: 'Calendar', side: 'left', at: Date.now() }));
    const { orb, bubble } = setup(answering({}), { storage, dockSide: 'auto' });
    expect(orb.dataset.side).toBe('left');
    await settle(60);
    expect(bubble.textContent).toBe('You are on Calendar');
    expect(bubble.getAttribute('role')).toBe('status');
    expect(String(bubble.className).split(' ')).toContain('sr-only');
    expect(storage.items.size).toBe(0);
    await settle(5000);
    expect(bubble.textContent).toBe('');
  });

  it('ignores a stale note', async () => {
    const storage = new MemoryStorage();
    storage.setItem('nextgen:arrival', JSON.stringify({ title: 'Calendar', side: 'left', at: Date.now() - 60_000 }));
    const { bubble } = setup(answering({}), { storage });
    await settle(60);
    expect(bubble.textContent).toBe('');
    expect(storage.items.size).toBe(0);
  });

  it('ignores a note it cannot trust', async () => {
    const storage = new MemoryStorage();
    storage.setItem('nextgen:arrival', '{"title": 3, "side": "up"}');
    const { bubble } = setup(answering({}), { storage });
    await settle(60);
    expect(bubble.textContent).toBe('');
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
    expect(bubble.textContent).toBe('');
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

  it('makes way for the guide when a move from the open panel lands on a screen with steps', async () => {
    const toExpense: Partial<TurnTrace> = { capabilityId: 'expenses.new' };
    const { mounted, guide, screen, moves } = setup(answering(toExpense));
    void mounted.ask('new expense');
    await settle(0);
    expect(moves).toEqual(['/expenses/new']);
    await settle(400);
    expect(screen.dataset.open).toBe('false');
    expect(guide.hidden).toBe(false);
  });

  it('starts the steps of the page the visitor is on when they ask for the tour', async () => {
    const { mounted, guide, screen } = setup(answering({}), {}, { path: '/expenses/new' });
    await mounted.ask('tutorial');
    expect(screen.dataset.open).toBe('false');
    expect(guide.hidden).toBe(false);
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

/**
 * A conversation remembers what it just said (followup.ts, 2026-09-22). Before this, "yes" after "You
 * probably want Calendar" was answered as small talk, "the second one" was routed as a search for a
 * screen called that, and a detail added to a question the router asked about was read on its own.
 */
describe('the conversation remembers what it offered', () => {
  const leads = {
    outcome: 'clarify',
    decidedAt: 'embedding',
    latency: { total: 5 },
    candidates: [
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'squad.list', score: 0.1 },
    ],
  } as unknown as Partial<TurnTrace>;
  const even = { ...leads, candidates: [{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.list', score: 0.28 }] } as unknown as Partial<TurnTrace>;
  const text = (el: FakeElement): string => String(el.textContent);
  // An answer is "spoken" for up to 2.2 s without a voice, and a move includes the orb's flight.
  const say = async (mounted: { ask(q: string): Promise<unknown> }, q: string) => {
    const done = mounted.ask(q);
    await vi.advanceTimersByTimeAsync(6000);
    await done;
  };

  it('takes "yes" as the likely one, and goes there without asking the router again', async () => {
    const routed = answering(leads);
    const { mounted, moves, thread } = setup(routed);
    await say(mounted, 'games');
    await say(mounted, 'yes');
    expect(routed.asked).toEqual(['games']);
    expect(moves).toEqual(['/calendar']);
    expect(text(thread)).toContain('Opening Calendar');
    expect(text(thread)).not.toContain('Okay.');
  });

  it('takes a position — "the second one", "o segundo", "2" — as that place', async () => {
    for (const reply of ['the second one', 'o segundo', '2']) {
      const routed = answering(even);
      const { mounted, moves } = setup(routed);
      await say(mounted, 'games');
      await say(mounted, reply);
      expect(moves, reply).toEqual(['/squad']);
      expect(routed.asked, reply).toEqual(['games']);
    }
  });

  it('asks which, when "yes" could mean either of two equals', async () => {
    const { mounted, moves, thread, all } = setup(answering(even));
    await say(mounted, 'games');
    await say(mounted, 'yes');
    expect(moves).toEqual([]);
    expect(text(thread)).toContain('Which one?');
    // …and both are offered again, so a tap still works.
    expect(all('chip').slice(-2).map((a) => a.href)).toEqual(['/calendar', '/squad']);
  });

  it('hears "neither", and asks for more rather than repeating itself', async () => {
    const routed = answering(leads);
    const { mounted, moves, thread } = setup(routed);
    await say(mounted, 'games');
    await say(mounted, 'neither');
    expect(moves).toEqual([]);
    expect(routed.asked).toEqual(['games']);
    expect(text(thread)).toContain('No problem.');
  });

  it('reads a short detail together with the question it adds to, and keeps that reading only if it settles it', async () => {
    // First "games" clarifies; then "on saturday" alone clarifies; the two together settle on Calendar.
    const routed = answering(leads, leads, toCalendar);
    const { mounted, moves } = setup(routed);
    await say(mounted, 'games');
    await say(mounted, 'on saturday');
    expect(routed.asked).toEqual(['games', 'on saturday', 'games on saturday']);
    expect(moves).toEqual(['/calendar']);
  });

  it('never turns a refusal into a move, and forgets the open question once somewhere was chosen', async () => {
    const refused = { outcome: 'out_of_scope', decidedAt: 'embedding', candidates: [{ capabilityId: 'unsupported.payments', score: 0.4 }] } as unknown as Partial<TurnTrace>;
    const routed = answering(leads, refused, leads);
    const { mounted, moves } = setup(routed);
    await say(mounted, 'games');
    await say(mounted, 'pay the fees');
    // A refusal is not read together with what came before.
    expect(routed.asked).toEqual(['games', 'pay the fees']);
    expect(moves).toEqual([]);
    // Nothing was offered by the refusal, so "yes" now is small talk, not a move.
    await say(mounted, 'yes');
    expect(moves).toEqual([]);
  });

  it('answers "what is this page?" from the screen the visitor is on', async () => {
    const routed = answering(toCalendar);
    const { mounted, thread } = setup(routed, {}, { path: '/calendar' });
    await say(mounted, 'what is this page?');
    expect(routed.asked).toEqual([]);
    expect(text(thread)).toContain('You are on Calendar');
    expect(text(thread)).toContain('Training and matches by day.');
  });
});

describe('a clear leader, asked about as the likely one', () => {
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

  it('asks one question about the likely one, with what it is for — and offers nothing else to pick from', async () => {
    const { mounted, thread, all } = setup(answering(leading));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    const chips = all('chip');
    expect(chips.map((a) => a.href)).toEqual(['/calendar']);
    expect(classes(chips[0]!)).toContain('lead');
    expect(thread.textContent).toContain('Are you looking for Calendar?');
    expect(thread.textContent).toContain('Open Calendar');
    expect(thread.textContent).toContain('Training and matches by day.');
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

  it('asks "this, or that?" between two equals: no likely one, two places, one question', async () => {
    const { mounted, thread, all } = setup(answering(clarifying));
    const done = mounted.ask('games');
    await settle(2000);
    await done;
    expect(all('lead')).toHaveLength(0);
    expect(all('chip')).toHaveLength(2);
    expect(thread.textContent).toContain('Do you mean Calendar, or Squad?');
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
    const { host, byClass, input, screen, all, mounted } = setup(answering(toCalendar), { attach: false }, { page });
    expect(byClass('attach').hidden).toBe(true);
    expect(byClass('camera').hidden).toBe(true);
    // …and pasting or dropping a file does not sneak one in.
    const event = (extra: object) => extra as never;
    expect(input.fire('paste', event({ clipboardData: { files: [file('a.png')] } })).defaultPrevented).toBe(false);
    expect(screen.fire('dragover', event({ dataTransfer: { types: ['Files'] } })).defaultPrevented).toBe(false);
    attach(host, [file('a.png')]);
    expect(all('attach-item')).toHaveLength(0);
    // Without the paperclip and camera, even a phone's full-screen box has room for the whole sentence.
    mounted.open({ expanded: true });
    expect(input.placeholder).toBe('Ask anything about this app');
  });

  it('asks in fewer words where the row is crowded, so the box is not clipped mid-sentence', () => {
    // The corner panel is narrow on any device.
    const desktop = setup(answering(toCalendar), {}, { page: fitted(false).page });
    expect(desktop.input.placeholder).toBe('Ask anything');
    // Expanded on a desktop, there is room for the whole sentence…
    desktop.mounted.open({ expanded: true });
    expect(desktop.input.placeholder).toBe('Ask anything about this app');
    // …but not on a phone, where the row still holds four buttons.
    const phone = setup(answering(toCalendar), {}, { page: fitted(true).page });
    phone.mounted.open({ expanded: true });
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

  it('is silent until the visitor turns it on — a talking page is a surprise in an office', async () => {
    const spoken: Utterance[] = [];
    const local = { name: 'US', lang: 'en-US', localService: true, default: true, voiceURI: 'US' } as SpeechSynthesisVoice;
    const synth = { getVoices: () => [local], speak: (u: Utterance) => void spoken.push(u), cancel: () => undefined };
    const { env } = localVoice({
      getUserMedia: null,
      synth: synth as unknown as SpeechSynthesis,
      Utterance: Utterance as unknown as VoiceEnv['Utterance'],
    });
    const { mounted, sound } = setup(answering(clarifying), { voiceEnv: env });
    expect(sound.hidden).toBe(false);
    expect(sound.getAttribute('aria-pressed')).toBe('false');
    const asking = mounted.ask('games');
    await settle(3000);
    await asking;
    expect(spoken).toHaveLength(0);
  });

  it('reads a typed answer in a local voice once turned on, and stops once the visitor turns it off', async () => {
    const spoken: Utterance[] = [];
    const local = { name: 'US', lang: 'en-US', localService: true, default: true, voiceURI: 'US' } as SpeechSynthesisVoice;
    const synth = { getVoices: () => [local], speak: (u: Utterance) => void spoken.push(u), cancel: () => undefined };
    const { env } = localVoice({
      getUserMedia: null,
      synth: synth as unknown as SpeechSynthesis,
      Utterance: Utterance as unknown as VoiceEnv['Utterance'],
    });
    const { mounted, sound, preferences } = setup(answering(clarifying), { voiceEnv: env });
    sound.fire('click');
    expect(sound.getAttribute('aria-pressed')).toBe('true');
    expect(preferences.getItem('nextgen:read-aloud')).toBe('on');

    const first = mounted.ask('games');
    await settle(0);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.text.startsWith('Do you mean Calendar, or Squad?')).toBe(true);
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
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:read-aloud', 'on');
    const { mounted } = setup(answering(toCalendar), { voiceEnv: env, preferences });
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

  it('a remembered choice listens when the panel opens; a spoken question is answered, the conversation carries on there, and closing ends it', async () => {
    const { env, made, tracks } = localVoice();
    const preferences = new MemoryStorage();
    preferences.setItem('nextgen:hands-free', 'on');
    const assistant = answering(toCalendar);
    const { orb, moves, mounted } = setup(assistant, { voiceEnv: env, preferences });
    await settle(0);
    expect(made).toHaveLength(0); // nothing listens on the original pages

    orb.fire('click');
    await settle(50);
    expect(made).toHaveLength(1);
    made[0]!.onresult!(heard('where is the calendar'));
    await settle(4000);
    expect(assistant.asked).toEqual(['where is the calendar']);
    expect(moves).toEqual(['/calendar']);
    // The panel stayed open beside the new page, so it is still listening there.
    expect(tracks[0]!.stopped).toBe(0);
    mounted.close();
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
  it('act at once instead of being asked: fechar closes the panel', async () => {
    const assistant = answering({});
    const { mounted, screen } = setup(assistant, {}, { page: clubPage });
    mounted.open();
    expect(screen.dataset.open).toBe('true');
    await mounted.ask('Fechar, por favor.');
    expect(screen.dataset.open).toBe('false');
    expect(assistant.asked).toEqual([]);
  });

  it('asks the router about "tutorial" when there is no tour and this page has no steps', async () => {
    const assistant = answering(clarifying);
    const { mounted } = setup(assistant);
    const done = mounted.ask('tutorial');
    await settle(2000);
    await done;
    expect(assistant.asked).toEqual(['tutorial']);
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
    expect(all[all.length - 1]!.textContent).toContain('Do you mean Calendar, or Squad?');
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

  it('always offers to start over, so a visitor never has to find out when it appears', async () => {
    const { mounted, byClass } = setup(answering(clarifying));
    const restart = byClass('restart');
    expect(restart.hidden).not.toBe(true);
    await answer(mounted, 'games');
    expect(restart.hidden).not.toBe(true);
  });

  it('starts over: the greeting again, the landing page again, and the composer ready', async () => {
    const { mounted, thread, screen, byClass, all, input, doc } = setup(answering(clarifying));
    await answer(mounted, 'games');
    expect(messages(thread)).toHaveLength(3);
    byClass('restart').fire('click');
    await settle(10);
    expect(messages(thread).map((m) => m.textContent)).toEqual([`Ready when you are.${WORDS.en.greetingHint}`]);
    expect(screen.dataset.conversation).toBe('false');
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
    expect(copied[0]).toContain('Do you mean Calendar, or Squad?');
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

/**
 * The app already has an assistant of its own — a model-backed chat, a tour (ADR-026). The visitor meets
 * one entry point, loses nothing either had, and is never unsure which one said what.
 */
describe('the app’s own assistant, merged in', () => {
  const nothing = { outcome: 'clarify', decidedAt: 'embedding', latency: { total: 5 }, candidates: [{ capabilityId: 'calendar.overview', score: 0 }] } as unknown as Partial<TurnTrace>;
  const text = (el: FakeElement): string => String(el.textContent);
  const run = async (mounted: { ask(q: string): Promise<unknown> }, q: string) => {
    const done = mounted.ask(q);
    await settle(3000);
    return done;
  };
  const companionOf = (answer: string | null | Error = 'Three players are injured this week.') => {
    const asked: { text: string; files: readonly File[]; route: string }[] = [];
    return {
      asked,
      companion: {
        name: 'Club assistant',
        ask: async (request: { text: string; files: readonly File[]; route: string }) => {
          asked.push(request);
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
    };
  };

  it('answers what this assistant cannot place, in the conversation, under the other one’s name — never with a "Why?"', async () => {
    const { companion, asked } = companionOf();
    const { mounted, thread, all } = setup(answering(nothing), { companion });
    await run(mounted, 'how many players are injured');
    expect(asked).toEqual([{ text: 'how many players are injured', files: [], route: '/home' }]);
    expect(text(thread)).toContain('Three players are injured this week.');
    expect(text(thread)).toContain('Answered by Club assistant');
    expect(all('why')).toHaveLength(0);
  });

  it('is not asked when the router has somewhere to offer: that question stays this assistant’s', async () => {
    const { companion, asked } = companionOf();
    const { mounted } = setup(answering(clarifying), { companion });
    await run(mounted, 'games');
    expect(asked).toEqual([]);
  });

  it('gets a topic the registry puts outside the app, but never a refusal to act', async () => {
    const acting = caps.map((c) => (c.id === 'unsupported.payments' ? { ...c, refuses: 'action' } : c));
    const actingRegistry = { capabilities: acting, byId: new Map(acting.map((c) => [c.id, c])), boundaryIds: registry.boundaryIds } as unknown as Registry;
    const refused: Partial<TurnTrace> = { outcome: 'out_of_scope', capabilityId: 'unsupported.payments', candidates: [] };
    const acts: Routable = { registry: actingRegistry, route: async () => trace(refused) };
    const first = companionOf();
    const a = setup(acts, { companion: first.companion });
    await run(a.mounted, 'pay my invoice');
    expect(first.asked).toEqual([]);
    expect(text(a.thread)).toContain('I cannot move money.');

    // The same limit, as a topic rather than an act, is theirs to answer.
    const second = companionOf();
    const b = setup(answering(refused), { companion: second.companion });
    await run(b.mounted, 'tell me about payments');
    expect(second.asked).toHaveLength(1);
  });

  it('leaves the turn to this assistant when it declines or fails', async () => {
    for (const answer of [null, '   ', new Error('down')]) {
      const { companion } = companionOf(answer);
      const { mounted, thread } = setup(answering(nothing), { companion });
      await run(mounted, 'quero falar com alguém');
      expect(text(thread), String(answer)).toContain('not sure what you’re after');
      expect(text(thread)).not.toContain('Answered by');
    }
  });

  it('turns the paperclip on, and takes what is attached — with the words — instead of the page', async () => {
    const { companion, asked } = companionOf('That is a medical certificate for Rui.');
    const events: unknown[] = [];
    const { mounted, host, thread } = setup(answering(nothing), { companion }, {
      page: (doc) => {
        (doc.defaultView as unknown as Record<string, unknown>).dispatchEvent = (e: unknown) => void events.push(e);
      },
    });
    const clip = host.find((el) => String(el.className ?? '').split(' ').includes('attach'))!;
    expect(clip.hidden).toBe(false);
    const picker = host.findAll((el) => el.tagName === 'input' && el.type === 'file')[0]!;
    const pdf = { name: 'atestado.pdf', type: 'application/pdf', size: 2048 } as unknown as File;
    picker.files = [pdf];
    picker.fire('change');
    await run(mounted, 'what is this?');
    expect(asked).toEqual([{ text: 'what is this?', files: [pdf], route: '/home' }]);
    expect(events).toEqual([]);
    expect(text(thread)).toContain('That is a medical certificate for Rui.');
    expect(text(thread)).toContain('Your attachment went to Club assistant.');
  });

  it('is opened whole from the panel, which steps aside for it', async () => {
    let opened = 0;
    const { orb, screen, byClass } = setup(answering({}), { companion: { name: 'Club assistant', open: () => void opened++ } });
    orb.fire('click');
    await settle(50);
    const button = byClass('companion');
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Open Club assistant');
    button.fire('click');
    expect(opened).toBe(1);
    expect(screen.dataset.open).toBe('false');
  });

  it('offers no such button when there is nothing to open', () => {
    const { byClass } = setup(answering({}));
    expect(byClass('companion').hidden).toBe(true);
  });

  it('starts the app’s own tour when the visitor asks for one, on the page they are on', async () => {
    const tours: string[] = [];
    const routed = answering({});
    const { mounted, screen } = setup(routed, { companion: { tour: (route: string) => void tours.push(route) } }, { path: '/calendar' });
    mounted.open();
    await mounted.ask('visita guiada');
    expect(tours).toEqual(['/calendar']);
    expect(screen.dataset.open).toBe('false');
    expect(routed.asked).toEqual([]);
  });

  it('hides the app’s own launchers while it runs, and gives them back when it goes', () => {
    let head: FakeElement | null = null;
    const { mounted } = setup(answering({}), { companion: { hide: ['#club-chat', '[data-tour-prompt]'] } }, {
      page: (doc) => {
        head = doc.createElement('head');
        (doc as unknown as { head: FakeElement }).head = head;
      },
    });
    expect(head!.children).toHaveLength(1);
    expect(head!.children[0]!.textContent).toBe('#club-chat, [data-tour-prompt] { display: none !important; }');
    mounted.destroy();
    expect(head!.children).toHaveLength(0);
  });
});

/**
 * What the adopter tunes and what visitors teach (ADR-027). Every app is different, so how bold the
 * assistant is, where content questions go, and what it learns from real use are the adopter's to set.
 */
describe('the adopter’s dial — how readily it moves', () => {
  const leading = {
    outcome: 'clarify', decidedAt: 'embedding', latency: { total: 5 },
    candidates: [{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.list', score: 0.1 }],
  } as unknown as Partial<TurnTrace>;
  const run = async (mounted: { ask(q: string): Promise<unknown> }, q: string) => {
    const done = mounted.ask(q);
    await settle(3000);
    return done;
  };

  it('balanced (the default): moves on a decision, asks about a leader', async () => {
    const decided = setup(answering(toCalendar));
    await run(decided.mounted, 'calendar');
    expect(decided.moves).toEqual(['/calendar']);
    const led = setup(answering(leading));
    await run(led.mounted, 'games');
    expect(led.moves).toEqual([]);
  });

  it('confirm: never moves without a yes — even a decided turn is asked, and "yes" takes it', async () => {
    const { mounted, moves, thread } = setup(answering(toCalendar), { decide: 'confirm' });
    await run(mounted, 'calendar');
    expect(moves).toEqual([]);
    expect(String(thread.textContent)).toContain('Shall I open Calendar?');
    await run(mounted, 'yes');
    expect(moves).toEqual(['/calendar']);
  });

  it('eager: also moves when one place is plainly ahead — but never on a lone weak match, or two equals', async () => {
    const led = setup(answering(leading), { decide: 'eager' });
    await run(led.mounted, 'games');
    expect(led.moves).toEqual(['/calendar']);
    const weak = setup(answering({ ...leading, candidates: [{ capabilityId: 'calendar.overview', score: 0.1 }] } as never), { decide: 'eager' });
    await run(weak.mounted, 'games');
    expect(weak.moves).toEqual([]);
    const tie = setup(answering(clarifying), { decide: 'eager' });
    await run(tie.mounted, 'games');
    expect(tie.moves).toEqual([]);
  });

  it('never changes a refusal, whatever the dial says', async () => {
    const { mounted, moves, thread } = setup(answering({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments' }), { decide: 'eager' });
    await run(mounted, 'pay my invoice');
    expect(moves).toEqual([]);
    expect(String(thread.textContent)).toContain('I cannot move money.');
  });
});

describe('the app’s own search, for what no screen matches', () => {
  const nothing = { outcome: 'clarify', decidedAt: 'embedding', latency: { total: 5 }, candidates: [{ capabilityId: 'calendar.overview', score: 0 }] } as unknown as Partial<TurnTrace>;

  it('offers a search for the visitor’s own words first, when nothing matched', async () => {
    const { mounted, all } = setup(answering(nothing), { search: '/search?q={query}' });
    const done = mounted.ask('photos of Ana in Porto');
    await settle(3000);
    await done;
    const chips = all('chip');
    expect(chips[0]!.href).toBe('/search?q=photos%20of%20Ana%20in%20Porto');
    expect(chips[0]!.textContent).toBe('Search for “photos of Ana in Porto”');
  });

  it('treats faint matches as no match: search first, and no "X, or Y?" about two unrelated screens', async () => {
    const faint = { outcome: 'clarify', decidedAt: 'embedding', latency: { total: 5 }, candidates: [{ capabilityId: 'calendar.overview', score: 0.06 }, { capabilityId: 'squad.list', score: 0.04 }] } as unknown as Partial<TurnTrace>;
    const { mounted, all, thread } = setup(answering(faint), { search: '/search?q={query}' });
    const done = mounted.ask('fotos de Ana en Oporto');
    await settle(3000);
    await done;
    expect(all('chip')[0]!.href).toBe('/search?q=fotos%20de%20Ana%20en%20Oporto');
    expect(String(thread.textContent)).toContain('not sure what you’re after');
    expect(String(thread.textContent)).not.toContain('Do you mean');

    // …and the app's own assistant is asked about it too, as about anything else this one cannot place.
    const asked: string[] = [];
    const withCompanion = setup(answering(faint), { companion: { ask: async ({ text }) => (asked.push(text), 'Ana has 3 albums.') } });
    const again = withCompanion.mounted.ask('fotos de Ana en Oporto');
    await settle(3000);
    await again;
    expect(asked).toEqual(['fotos de Ana en Oporto']);
  });

  it('is not offered when a screen matched, or when the template is not a path on this app', async () => {
    const matched = setup(answering(clarifying), { search: '/search?q={query}' });
    const a = matched.mounted.ask('games');
    await settle(3000);
    await a;
    expect(matched.all('chip').map((c) => c.href)).not.toContain('/search?q=games');
    for (const template of ['https://evil.test/?q={query}', '//evil.test/{query}', '/search']) {
      const bad = setup(answering(nothing), { search: template });
      const b = bad.mounted.ask('anything');
      await settle(3000);
      await b;
      expect(bad.all('chip').some((c) => String(c.href).includes('evil') || c.href === '/search'), template).toBe(false);
    }
  });
});

describe('what visitors teach it', () => {
  const run = async (mounted: { ask(q: string): Promise<unknown> }, q: string) => {
    const done = mounted.ask(q);
    await settle(3000);
    return done;
  };
  const lessons = () => {
    const got: unknown[] = [];
    return { got, onLearn: (lesson: unknown) => void got.push(lesson) };
  };

  it('is told when a visitor picks a place for a question it could not settle — by tap', async () => {
    const { got, onLearn } = lessons();
    const { mounted, all } = setup(answering(clarifying), { onLearn });
    await run(mounted, 'games');
    all('chip')[1]!.fire('click', { button: 0 });
    expect(got).toEqual([{ question: 'games', route: '/squad', how: 'chose', from: '/home', offered: ['/calendar', '/squad'] }]);
  });

  it('…by saying which, and when they say neither', async () => {
    const chose = lessons();
    const a = setup(answering(clarifying), { onLearn: chose.onLearn });
    await run(a.mounted, 'games');
    await run(a.mounted, 'the second one');
    expect(chose.got).toMatchObject([{ question: 'games', route: '/squad', how: 'chose' }]);

    const rejected = lessons();
    const b = setup(answering(clarifying), { onLearn: rejected.onLearn });
    await run(b.mounted, 'games');
    await run(b.mounted, 'neither');
    expect(rejected.got).toMatchObject([{ question: 'games', route: null, how: 'rejected' }]);
  });

  it('is told about a question nothing in the app matched', async () => {
    const { got, onLearn } = lessons();
    const nothing = { outcome: 'clarify', decidedAt: 'embedding', latency: { total: 5 }, candidates: [{ capabilityId: 'calendar.overview', score: 0 }] } as unknown as Partial<TurnTrace>;
    const { mounted } = setup(answering(nothing), { onLearn });
    await run(mounted, 'quero falar com alguém');
    expect(got).toMatchObject([{ question: 'quero falar com alguém', route: null, how: 'unplaced' }]);
  });

  it('learns nothing from a decision it made itself, from small talk, or from a refusal', async () => {
    const { got, onLearn } = lessons();
    const decided = setup(answering(toCalendar), { onLearn });
    await run(decided.mounted, 'calendar');
    await run(decided.mounted, 'thanks');
    const refused = setup(answering({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments' }), { onLearn });
    await run(refused.mounted, 'pay my invoice');
    expect(got).toEqual([]);
  });

  it('survives a page handler that throws', async () => {
    const { mounted, all, moves } = setup(answering(clarifying), { onLearn: () => { throw new Error('page bug'); } });
    await run(mounted, 'games');
    all('chip')[0]!.fire('click', { button: 0 });
    await settle(500);
    expect(moves).toEqual(['/calendar']);
  });
});

describe('a navigation that is not a <nav>', () => {
  it('is found by the selector the adopter gives, for places to begin and for the full-screen frame', async () => {
    const { mounted, all, byClass, screen } = setup(
      answering({ outcome: 'clarify', decidedAt: 'embedding', latency: { total: 5 }, candidates: [{ capabilityId: 'calendar.overview', score: 0 }] } as never),
      { navigation: '[data-sidebar]' },
      {
        page: (doc) => {
          const side = doc.createElement('div');
          side.setAttribute('data-sidebar', '');
          side.getBoundingClientRect = () => ({ left: 0, top: 0, width: 220, height: 800 });
          for (const [href, text] of [['/calendar', 'Agenda'], ['/competition/standings', 'Table']] as const) {
            const a = doc.createElement('a');
            a.setAttribute('href', href);
            a.textContent = text;
            side.append(a);
          }
          doc.body.append(side);
        },
      },
    );
    const done = mounted.ask('help me, I am lost here');
    await settle(3000);
    await done;
    expect(all('chip').map((c) => c.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Agenda')]));
    byClass('expand').fire('click');
    expect(screen.style['--ng-frame-left']).toBe('220px');
  });
});

describe('where it sits', () => {
  it('keeps the distance from the corner the adopter asks for, so it clears the app’s own buttons', () => {
    const { host, orb } = setup(answering({}), { inset: { x: 24, y: 144 } });
    expect(host.style['--ng-inset-x']).toBe('24px');
    expect(host.style['--ng-inset-y']).toBe('144px');
    // 1200 × 800 window: the orb's 92px box ends 24px from the right and 144px from the bottom.
    const scale = Number(orb.style['--s']);
    expect(Number.parseFloat(String(orb.style['--x']))).toBeCloseTo(1200 - 24 - 46 - (320 * scale) / 2, 0);
    expect(Number.parseFloat(String(orb.style['--y']))).toBeCloseTo(800 - 144 - 46 - (320 * scale) / 2, 0);
  });
});

describe('destroy', () => {
  it('removes the layer and gives the page its scrolling back', async () => {
    const { mounted, doc, orb } = setup(answering({}));
    orb.fire('click');
    await settle(50);
    mounted.open({ expanded: true });
    expect(overflow(doc)).toBe('hidden');
    mounted.destroy();
    expect(doc.body.children.some((el) => el.hasAttribute('data-nextgen-assistant'))).toBe(false);
    expect(overflow(doc)).toBe('');
  });
});
