// What to show for one turn, and whether to move the browser.
//
// Pure: a trace in, a view out. The widget only draws what this decides, so every
// rule that matters is testable without a browser, and the script tag cannot
// grow a second, drifting copy of the policy apps/web already follows.
//
// The rules are `destinationFor()`'s (apps/web/lib/navigation.ts, WP-35), plus two
// that only a script tag needs:
//
// 1. It never acts. There is no dispatcher and no stage 3 here, so a `read`,
//    `write` or `destructive` capability is shown as a link, never performed.
//    Only `navigate` moves the browser, because moving is all navigate does.
// 2. It never navigates to a route with an unfilled parameter. `/my/children/
//    :childId/medical` means nothing without a child. A parameter is filled
//    only from the page the user is already on, the one value the user has
//    already chosen for themselves. Otherwise the widget explains and stays put.

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

export type Tone = 'go' | 'explain' | 'choose' | 'limit' | 'unsure';

export interface Choice {
  readonly label: string;
  /** A real path. Rendered as a link, so it works without the assistant (Rule 7). */
  readonly route: string;
}

export interface View {
  readonly tone: Tone;
  readonly title: string;
  readonly body: string | null;
  /** Where to move the browser now; `null` to stay where the user is. */
  readonly destination: string | null;
  readonly choices: readonly Choice[];
}

export interface Words {
  readonly label: string;
  readonly placeholder: string;
  readonly submit: string;
  readonly thinking: string;
  readonly going: (title: string) => string;
  readonly alreadyHere: (title: string) => string;
  readonly open: (title: string) => string;
  readonly whichOne: string;
  readonly limitTitle: string;
  readonly limitFallback: string;
  readonly unsure: string;
  readonly needsItem: string;
  readonly error: string;
  readonly greeting: string;
  readonly composer: string;
  readonly openAssistant: string;
  readonly close: string;
  readonly listen: string;
  readonly listening: string;
  readonly preparingVoice: string;
  readonly voiceTypeInstead: string;
  readonly micDenied: string;
  readonly here: (title: string) => string;
  readonly menu: string;
  readonly closeMenu: string;
  readonly readAloud: string;
  readonly why: string;
  /** How a turn was decided, from `TurnTrace.decidedAt` and its total latency. */
  readonly whyHow: (stage: string, ms: number | null) => string;
  readonly whyConsidered: string;
  readonly whyChosen: string;
  readonly guideLabel: string;
  readonly guideStep: (n: number, total: number) => string;
  readonly guideBack: string;
  readonly guideNext: string;
  readonly guideDone: string;
}

export const WORDS: Readonly<Record<'en' | 'pt', Words>> = {
  en: {
    label: 'Ask where to go',
    placeholder: 'e.g. where do I see the calendar?',
    submit: 'Ask',
    thinking: 'Looking…',
    going: (title) => `Opening ${title}`,
    alreadyHere: (title) => `You are already on ${title}`,
    open: (title) => `Open ${title}`,
    whichOne: 'Which of these do you mean?',
    limitTitle: 'That is not something I can do here',
    limitFallback: 'I can take you anywhere in this application and explain what you find there.',
    unsure: 'I did not understand that. Could you say it another way?',
    needsItem: 'This page is about one specific item. Open that item in the application, then ask again.',
    error: 'Something went wrong. Nothing was changed.',
    greeting: 'Ready when you are.',
    composer: 'Ask anything about this app',
    openAssistant: 'Open the assistant',
    close: 'Close',
    listen: 'Listen hands-free',
    listening: 'Listening…',
    preparingVoice: 'Preparing on-device voice…',
    voiceTypeInstead: 'Voice-to-text is not available on this device. Type your question instead.',
    micDenied: 'The microphone was not allowed.',
    here: (title) => `You are on ${title}`,
    menu: 'Menu',
    closeMenu: 'Close the menu',
    readAloud: 'Read answers aloud',
    why: 'Why?',
    whyHow: (stage, ms) => {
      const how =
        stage === 'deterministic' ? 'by an exact match'
          : stage === 'embedding' ? 'by similarity to what this app declares'
            : stage === 'llm' ? 'with the help of a model'
              : 'without reaching a decision';
      return `Decided ${how}${ms === null ? '' : ` in ${ms} ms`}${stage === 'llm' ? '' : ', with no model call'}.`;
    },
    whyConsidered: 'What it considered',
    whyChosen: 'chosen',
    guideLabel: 'Guide',
    guideStep: (n, total) => `Step ${n} of ${total}`,
    guideBack: 'Back',
    guideNext: 'Next',
    guideDone: 'Done',
  },
  pt: {
    label: 'Pergunte para onde quer ir',
    placeholder: 'Ex.: onde vejo o calendário?',
    submit: 'Perguntar',
    thinking: 'A procurar…',
    going: (title) => `A abrir ${title}`,
    alreadyHere: (title) => `Já está em ${title}`,
    open: (title) => `Abrir ${title}`,
    whichOne: 'Qual destes procura?',
    limitTitle: 'Isso não é algo que eu possa fazer aqui',
    limitFallback: 'Posso levá-lo a qualquer ecrã desta aplicação e explicar o que lá encontra.',
    unsure: 'Não percebi. Pode dizer de outra forma?',
    needsItem: 'Esta página é sobre um item concreto. Abra-o na aplicação e pergunte de novo.',
    error: 'Algo correu mal. Nada foi alterado.',
    greeting: 'Pronto quando quiser.',
    composer: 'Pergunte algo sobre esta aplicação',
    openAssistant: 'Abrir o assistente',
    close: 'Fechar',
    listen: 'Ouvir sem usar as mãos',
    listening: 'A ouvir…',
    preparingVoice: 'A preparar a voz no dispositivo…',
    voiceTypeInstead: 'A conversão de voz em texto não está disponível neste dispositivo. Escreva a sua pergunta.',
    micDenied: 'O microfone não foi autorizado.',
    here: (title) => `Está em ${title}`,
    menu: 'Menu',
    closeMenu: 'Fechar o menu',
    readAloud: 'Ler as respostas em voz alta',
    why: 'Porquê?',
    whyHow: (stage, ms) => {
      const how =
        stage === 'deterministic' ? 'por correspondência exata'
          : stage === 'embedding' ? 'por semelhança com o que esta aplicação declara'
            : stage === 'llm' ? 'com a ajuda de um modelo'
              : 'sem chegar a uma decisão';
      return `Decidido ${how}${ms === null ? '' : ` em ${ms} ms`}${stage === 'llm' ? '' : ', sem chamar nenhum modelo'}.`;
    },
    whyConsidered: 'O que considerou',
    whyChosen: 'escolhido',
    guideLabel: 'Guia',
    guideStep: (n, total) => `Passo ${n} de ${total}`,
    guideBack: 'Anterior',
    guideNext: 'Seguinte',
    guideDone: 'Concluir',
  },
};

/** The page's own language decides the widget's. The registry was written in it too. */
export function wordsFor(lang: string | null | undefined): Words {
  return lang?.toLowerCase().startsWith('pt') ? WORDS.pt : WORDS.en;
}

const strip = (path: string): string => path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';

/** As apps/web's `isSamePlace`: moving to where you already are only breaks the back button. */
export function isSamePlace(destination: string, currentPath: string): boolean {
  return strip(destination) === strip(currentPath);
}

/**
 * Fill a route's `:params` from the page the user is on, or return null.
 *
 * The values are learned by matching the current path against the registry's
 * own route patterns. So `/my/children/42/development` teaches `childId = 42`,
 * and `/my/children/:childId/medical` becomes `/my/children/42/medical`. A
 * parameter the current page does not carry makes the route unusable, and it
 * is never guessed.
 */
export function fillParams(route: string | null, currentPath: string, patterns: readonly string[]): string | null {
  if (!route || !route.startsWith('/')) return null;
  const segments = route.split('/');
  if (!segments.some((s) => s.startsWith(':'))) return route;

  const here = strip(currentPath).split('/');
  const known = new Map<string, string>();
  for (const pattern of patterns) {
    const parts = pattern.split('/');
    if (parts.length !== here.length) continue;
    const values = new Map<string, string>();
    const matches = parts.every((part, i) => {
      if (part.startsWith(':')) {
        values.set(part.slice(1).replace(/\?$/, ''), here[i]!);
        return here[i] !== '';
      }
      return part === here[i];
    });
    if (matches && values.size > 0) {
      for (const [name, value] of values) known.set(name, value);
      break;
    }
  }

  const filled: string[] = [];
  for (const segment of segments) {
    if (!segment.startsWith(':')) {
      filled.push(segment);
      continue;
    }
    const optional = segment.endsWith('?');
    const value = known.get(segment.slice(1).replace(/\?$/, ''));
    if (value !== undefined) filled.push(value);
    else if (!optional) return null;
  }
  return filled.join('/') || '/';
}

/**
 * Places to offer before anything is asked: screens the user can go to from
 * here, in registry order. The same rules as a clarifying answer — no boundary,
 * no parameter the current page cannot fill, not the page they are already on.
 */
export function suggestionsFor(registry: Registry, currentPath: string, max = 4): Choice[] {
  const patterns = registry.capabilities.map((c) => c.route).filter((r): r is string => typeof r === 'string');
  const out: Choice[] = [];
  for (const c of registry.capabilities) {
    if (out.length >= max) break;
    if (c.kind !== 'navigate' || registry.boundaryIds.has(c.id)) continue;
    const route = fillParams(c.route, currentPath, patterns);
    if (!route || isSamePlace(route, currentPath) || out.some((o) => isSamePlace(o.route, route))) continue;
    out.push({ label: c.title, route });
  }
  return out;
}

export function present(trace: TurnTrace, registry: Registry, currentPath: string, words: Words): View {
  const patterns = registry.capabilities.map((c) => c.route).filter((r): r is string => typeof r === 'string');
  const capability = trace.capabilityId ? registry.byId.get(trace.capabilityId) : undefined;
  const unsure: View = { tone: 'unsure', title: words.unsure, body: null, destination: null, choices: [] };

  if (trace.outcome === 'error' || trace.outcome === null) {
    return { ...unsure, title: words.error };
  }

  // A declared limit is the system working, so it is stated as a limit, not as an apology.
  if (trace.outcome === 'out_of_scope' || capability?.kind === 'unsupported') {
    const refusal = capability?.kind === 'unsupported' ? (capability as { refusal?: string }).refusal : undefined;
    return { tone: 'limit', title: words.limitTitle, body: refusal ?? words.limitFallback, destination: null, choices: [] };
  }

  if (trace.outcome !== 'execute' || !capability) {
    // Clarify: offer the screens stage 2 ranked, as links the user picks. That is
    // a choice the user makes, like a menu, so nothing moves without it.
    const seen = new Set<string>();
    const choices: Choice[] = [];
    for (const candidate of trace.candidates) {
      const c = registry.byId.get(candidate.capabilityId);
      if (!c || c.kind === 'unsupported' || registry.boundaryIds.has(c.id)) continue;
      const route = fillParams(c.route, currentPath, patterns);
      if (!route || seen.has(route)) continue;
      seen.add(route);
      choices.push({ label: c.title, route });
      if (choices.length === 3) break;
    }
    return choices.length > 0 ? { tone: 'choose', title: words.whichOne, body: null, destination: null, choices } : unsure;
  }

  const route = fillParams(capability.route, currentPath, patterns);
  const body = capability.explanation ?? null;
  const link: Choice[] = route ? [{ label: words.open(capability.title), route }] : [];

  // Anything that is not navigation is shown and never performed: there is no dispatcher here.
  if (capability.kind !== 'navigate') {
    return { tone: 'explain', title: capability.title, body, destination: null, choices: link };
  }
  // "What is X?" asks about a screen; it does not ask to be put on it (WP-36).
  if (trace.explanationRequest) {
    return { tone: 'explain', title: capability.title, body, destination: null, choices: link };
  }
  if (!route) {
    return {
      tone: 'explain',
      title: capability.title,
      body: body ? `${body} ${words.needsItem}` : words.needsItem,
      destination: null,
      choices: [],
    };
  }
  if (isSamePlace(route, currentPath)) {
    return { tone: 'explain', title: words.alreadyHere(capability.title), body, destination: null, choices: [] };
  }
  return { tone: 'go', title: words.going(capability.title), body, destination: route, choices: [] };
}
