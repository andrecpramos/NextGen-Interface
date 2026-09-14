import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import { mountAssistant, type AssistantOptions } from './assistant.ts';
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
    answer: byClass('answer'),
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
    const { mounted, answer, screen, orb, bubble, moves, storage } = setup(answering(toCalendar));
    const done = mounted.ask('where is the calendar');
    await settle(0);
    expect(answer.textContent).toContain('Opening Calendar');
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
    expect(spoken[0]!.text.startsWith('Which of these do you mean?')).toBe(true);
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
    const { mounted, answer, moves } = setup(broken);
    const done = mounted.ask('anything');
    await settle(3000);
    await done;
    expect(answer.textContent).toContain('Something went wrong');
    expect(moves).toEqual([]);
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
