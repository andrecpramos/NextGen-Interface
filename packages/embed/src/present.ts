// What to show for one turn, and whether to move the browser.
//
// Pure: a trace in, a view out. The widget only draws what this decides, so every
// rule that matters is testable without a browser, and the script tag cannot
// grow a second, drifting copy of the policy.
//
// The rules are those of the reference web app's `destinationFor()` (WP-35, since removed), plus two
// that only a script tag needs:
//
// 1. It never acts. There is no dispatcher and no stage 3 here, so a `read`,
//    `write` or `destructive` capability is shown as a link, never performed.
//    Only `navigate` moves the browser, because moving is all navigate does.
// 2. It never navigates to a route with an unfilled parameter. `/my/children/
//    :childId/medical` means nothing without a child. A parameter is filled
//    only from the page the user is already on, the one value the user has
//    already chosen for themselves. Otherwise the widget explains and stays put.

import { isActionRequest, type Registry, type TurnTrace } from '@nextgen/core-intent/browser';

import type { Smalltalk } from './chat.ts';

export type Tone = 'go' | 'explain' | 'choose' | 'limit' | 'unsure' | 'chat';

export interface Choice {
  readonly label: string;
  /** A real path. Rendered as a link, so it works without the assistant (Rule 7). */
  readonly route: string;
  /**
   * What the screen is for — one sentence of the adopter's own words, so someone who has never seen
   * the app can tell two names apart. Absent when the adopter declared no purpose; never invented.
   */
  readonly detail?: string;
}

export interface View {
  readonly tone: Tone;
  readonly title: string;
  readonly body: string | null;
  /** Where to move the browser now; `null` to stay where the user is. */
  readonly destination: string | null;
  readonly choices: readonly Choice[];
  /**
   * Set when the first of `choices` is plainly ahead of the rest: it is offered as the likely
   * one, the others as alternatives. Never moves anything — the visitor still taps.
   */
  readonly probable?: boolean;
  /** One quiet line under the answer — what happened to something the visitor attached. */
  readonly note?: string;
}

export interface Words {
  readonly label: string;
  readonly placeholder: string;
  readonly submit: string;
  readonly thinking: string;
  readonly going: (title: string) => string;
  readonly alreadyHere: (title: string) => string;
  readonly open: (title: string) => string;
  /** Introduces what could not be settled: one place, or two. Never more — see `OFFERED`. */
  readonly couldHelp: (n: number) => string;
  /** One screen is plainly ahead: "You probably want X." */
  readonly probably: (title: string) => string;
  /** The same, when what was asked is a task ("book a training"), not a where. */
  readonly probablyTask: (title: string) => string;
  /** Introduces the alternative beneath the likely one. */
  readonly orElse: string;
  /** Under an answer that was a guess: the way out is to say more, not to pick from a list. */
  readonly notThat: string;
  /** What to say to small talk. It never refuses: `title` first, then the friendlier `body`. */
  readonly talk: Readonly<Record<Smalltalk, { readonly title: string; readonly body: string }>>;
  /** Follows the `help` body when there are real places to begin. */
  readonly helpStart: string;
  /** Attaching a photo or a file. Nothing attached is ever sent anywhere by the assistant. */
  readonly attach: string;
  readonly attachCamera: string;
  readonly removeFile: (name: string) => string;
  /** Announced when the tray changes: how many are attached. */
  readonly attachedFiles: (n: number) => string;
  readonly attachTooMany: (max: number) => string;
  readonly attachTooLarge: (megabytes: number) => string;
  readonly attachUnsupported: string;
  readonly attachEmpty: string;
  /** Under an answer, when the page did not take what was attached. */
  readonly attachKept: string;
  /** …and when it did. */
  readonly attachHanded: string;
  /** The reply to a message that was only a photo or a file. */
  readonly attachOnly: { readonly title: string; readonly body: string };
  readonly limitTitle: string;
  readonly limitFallback: string;
  /** Under a refusal, so it is never a dead end: what the assistant *can* do for someone who is stuck. */
  readonly limitNext: string;
  readonly unsure: string;
  /** Nothing the visitor said matched anything in the app: say so, and offer places to begin. */
  readonly unsureHelp: string;
  readonly needsItem: string;
  readonly error: string;
  readonly greeting: string;
  readonly composer: string;
  /** The same, for a phone, where the box shares its row with four buttons. */
  readonly composerShort: string;
  readonly openAssistant: string;
  readonly close: string;
  readonly listen: string;
  readonly listening: string;
  readonly preparingVoice: string;
  readonly setUpVoice: string;
  readonly voiceTypeInstead: string;
  readonly micDenied: string;
  readonly here: (title: string) => string;
  readonly menu: string;
  readonly closeMenu: string;
  readonly readAloud: string;
  /** Clears the conversation back to the greeting. */
  readonly startOver: string;
  readonly copy: string;
  readonly copied: string;
  readonly copyFailed: string;
  readonly why: string;
  /** How a turn was decided, from `TurnTrace.decidedAt` and its total latency. */
  readonly whyHow: (stage: string, ms: number | null) => string;
  readonly whyConsidered: string;
  readonly whyChosen: string;
  /**
   * ADR-019 (WP-53). A count only — never the removed text itself, which was judged
   * unsafe or unverifiable to show and stays that way here.
   */
  readonly whyRemoved: (n: number) => string;
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
    couldHelp: (n) => (n === 1 ? 'This could help:' : 'Two places could help with that:'),
    probably: (title) => `You probably want ${title}.`,
    probablyTask: (title) => `You can probably do that on ${title}.`,
    orElse: 'Or maybe:',
    notThat: 'Not what you meant? Tell me a bit more about what you want to do.',
    talk: {
      greeting: { title: 'Hi! How can I help?', body: 'Tell me what you want to do, in your own words, and I’ll take you there.' },
      thanks: { title: 'You’re welcome!', body: 'Anything else you’d like to do?' },
      goodbye: { title: 'Bye for now!', body: 'I’m here whenever you need to find something.' },
      howAreYou: { title: 'Doing well, thanks!', body: 'What would you like to do here?' },
      identity: { title: 'I’m this app’s assistant.', body: 'I can take you to any screen and tell you what it’s for. I don’t change anything myself.' },
      help: { title: 'Here’s how I can help.', body: 'Say what you want to do, in your own words, and I’ll take you to the right screen and explain what to do there.' },
      ok: { title: 'Okay.', body: 'Tell me what you’d like to do whenever you’re ready.' },
    },
    helpStart: 'Not sure where to start? Try one of these:',
    attach: 'Attach a photo or file',
    attachCamera: 'Take a photo',
    removeFile: (name) => `Remove ${name}`,
    attachedFiles: (n) => (n === 1 ? '1 file attached' : `${n} files attached`),
    attachTooMany: (max) => `You can attach up to ${max} files at a time.`,
    attachTooLarge: (megabytes) => `That file is too large. The most is ${megabytes} MB.`,
    attachUnsupported: 'That kind of file can’t be attached. Photos, PDFs and common documents can.',
    attachEmpty: 'That file is empty.',
    attachKept: 'Your attachment stays on this device. I can’t read it, but you can add it on that page.',
    attachHanded: 'I’ve passed your attachment to the app.',
    attachOnly: {
      title: 'Thanks — I’ve got it.',
      body: 'I can’t read attachments, and nothing leaves your device. Tell me what you want to do with it and I’ll take you where it goes.',
    },
    limitTitle: 'I can’t help with that here',
    limitFallback: 'I can take you anywhere in this application and explain what you find there.',
    limitNext: 'I can help you find your way around this app. Tell me what you’re trying to do.',
    unsure: 'I did not understand that. Could you say it another way?',
    unsureHelp: 'I’m not sure what you’re after. Tell me what you want to do, or start with one of these:',
    needsItem: 'This page is about one specific item. Open that item in the application, then ask again.',
    error: 'Something went wrong. Nothing was changed.',
    greeting: 'Ready when you are.',
    composer: 'Ask anything about this app',
    composerShort: 'Ask anything',
    openAssistant: 'Open the assistant',
    close: 'Close',
    listen: 'Listen hands-free',
    listening: 'Listening…',
    preparingVoice: 'Setting up voice on this device. This happens once…',
    setUpVoice: 'Tap the microphone to set up voice on this device. It downloads once.',
    voiceTypeInstead: 'Voice-to-text is not available on this device. Type your question instead.',
    micDenied: 'The microphone was not allowed.',
    here: (title) => `You are on ${title}`,
    menu: 'Menu',
    closeMenu: 'Close the menu',
    readAloud: 'Read answers aloud',
    startOver: 'Start over',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy',
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
    whyRemoved: (n) => (n === 1 ? 'Part of the answer was left out because it could not be checked.' : `${n} parts of the answer were left out because they could not be checked.`),
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
    couldHelp: (n) => (n === 1 ? 'Isto pode ajudar:' : 'Dois sítios podem ajudar:'),
    probably: (title) => `Provavelmente quer ${title}.`,
    probablyTask: (title) => `Provavelmente faz isso em ${title}.`,
    orElse: 'Ou talvez:',
    notThat: 'Não era isto? Diga-me um pouco mais sobre o que quer fazer.',
    talk: {
      greeting: { title: 'Olá! Como posso ajudar?', body: 'Diga-me o que quer fazer, por palavras suas, e eu levo-o lá.' },
      thanks: { title: 'De nada!', body: 'Precisa de mais alguma coisa?' },
      goodbye: { title: 'Até já!', body: 'Estou aqui sempre que precisar de encontrar algo.' },
      howAreYou: { title: 'Tudo bem por aqui!', body: 'O que gostaria de fazer?' },
      identity: { title: 'Sou o assistente desta aplicação.', body: 'Levo-o a qualquer ecrã e explico para que serve. Não altero nada por conta própria.' },
      help: { title: 'Posso ajudar assim.', body: 'Diga o que quer fazer, por palavras suas, e eu levo-o ao ecrã certo e explico o que fazer lá.' },
      ok: { title: 'Certo.', body: 'Diga-me o que quer fazer quando quiser.' },
    },
    helpStart: 'Sem saber por onde começar? Experimente um destes:',
    attach: 'Anexar uma foto ou ficheiro',
    attachCamera: 'Tirar uma fotografia',
    removeFile: (name) => `Remover ${name}`,
    attachedFiles: (n) => (n === 1 ? '1 ficheiro anexado' : `${n} ficheiros anexados`),
    attachTooMany: (max) => `Pode anexar até ${max} ficheiros de cada vez.`,
    attachTooLarge: (megabytes) => `Esse ficheiro é demasiado grande. O máximo é ${megabytes} MB.`,
    attachUnsupported: 'Esse tipo de ficheiro não pode ser anexado. Fotos, PDF e documentos comuns podem.',
    attachEmpty: 'Esse ficheiro está vazio.',
    attachKept: 'O seu anexo fica neste dispositivo. Não o consigo ler, mas pode juntá-lo nessa página.',
    attachHanded: 'Passei o seu anexo à aplicação.',
    attachOnly: {
      title: 'Obrigado — já recebi.',
      body: 'Não consigo ler anexos, e nada sai do seu dispositivo. Diga-me o que quer fazer com isto e eu levo-o onde deve ir.',
    },
    limitTitle: 'Não consigo ajudar com isso aqui',
    limitFallback: 'Posso levá-lo a qualquer ecrã desta aplicação e explicar o que lá encontra.',
    limitNext: 'Posso ajudá-lo a encontrar o que precisa nesta aplicação. Diga-me o que está a tentar fazer.',
    unsure: 'Não percebi. Pode dizer de outra forma?',
    unsureHelp: 'Não tenho a certeza do que procura. Diga-me o que quer fazer, ou comece por um destes:',
    needsItem: 'Esta página é sobre um item concreto. Abra-o na aplicação e pergunte de novo.',
    error: 'Algo correu mal. Nada foi alterado.',
    greeting: 'Pronto quando quiser.',
    composer: 'Pergunte algo sobre esta aplicação',
    composerShort: 'Pergunte algo',
    openAssistant: 'Abrir o assistente',
    close: 'Fechar',
    listen: 'Ouvir sem usar as mãos',
    listening: 'A ouvir…',
    preparingVoice: 'A ativar a voz neste dispositivo. Só acontece uma vez…',
    setUpVoice: 'Toque no microfone para ativar a voz neste dispositivo. É descarregada uma vez.',
    voiceTypeInstead: 'A conversão de voz em texto não está disponível neste dispositivo. Escreva a sua pergunta.',
    micDenied: 'O microfone não foi autorizado.',
    here: (title) => `Está em ${title}`,
    menu: 'Menu',
    closeMenu: 'Fechar o menu',
    readAloud: 'Ler as respostas em voz alta',
    startOver: 'Recomeçar',
    copy: 'Copiar',
    copied: 'Copiado',
    copyFailed: 'Não foi possível copiar',
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
    whyRemoved: (n) => (n === 1 ? 'Parte da resposta foi omitida por não ter sido possível confirmá-la.' : `${n} partes da resposta foram omitidas por não ter sido possível confirmá-las.`),
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

/** What the page knows about a parameter that its URL does not say. Only a locale, for now. */
export interface ParamHints {
  readonly locale?: string | undefined;
}

/** The parameter an i18n router puts in front of every route: next-intl's `[locale]`, `[lang]`. */
const LOCALE_NAME = /^(?:locale|lang|language|lng)$/i;

/** Moving to where you already are only breaks the back button. */
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
 *
 * One exception, for one kind of parameter: a locale (`:locale`, `:lang`). An i18n router that omits the
 * prefix for its default language (next-intl `localePrefix: 'as-needed'`) leaves those pages with no locale
 * in the URL, and the page's own language (`<html lang>`, which such a router sets to the locale) is what
 * `hints.locale` carries. What the URL says always wins; a hint never fills a parameter that picks an item.
 */
export function fillParams(
  route: string | null,
  currentPath: string,
  patterns: readonly string[],
  hints: ParamHints = {},
): string | null {
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
    const name = segment.slice(1).replace(/\?$/, '');
    const value = known.get(name) ?? (LOCALE_NAME.test(name) ? hints.locale : undefined);
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
export function suggestionsFor(registry: Registry, currentPath: string, max = 4, hints: ParamHints = {}): Choice[] {
  const patterns = registry.capabilities.map((c) => c.route).filter((r): r is string => typeof r === 'string');
  const out: Choice[] = [];
  for (const c of registry.capabilities) {
    if (out.length >= max) break;
    if (c.kind !== 'navigate' || registry.boundaryIds.has(c.id)) continue;
    const route = fillParams(c.route, currentPath, patterns, hints);
    if (!route || isSamePlace(route, currentPath) || out.some((o) => isSamePlace(o.route, route))) continue;
    const detail = gist(c.explanation);
    out.push({ label: c.title, route, ...(detail ? { detail } : {}) });
  }
  return out;
}

/**
 * An answer that asks offers at most this many places. The visitor is assumed to know nothing about
 * the app, so a list is a quiz: they cannot rank three names they have never seen. Measured on the
 * reference app (`eval/frameworks/family`, 21 in-scope turns the router would not act on): the right
 * screen was first in 14, among the first two in 21, and a third place added none. It is a choice
 * of how much to show, not a threshold of the router (Rule 14), and it changes what is drawn only.
 */
const OFFERED = 2;

/**
 * When a clarifying answer names a likely screen (2026-09-21, ADR-023).
 *
 * The router acts only when the leader clears `tauHigh` *and* the runner-up by `delta`, and
 * that is calibrated for a move, which is expensive to get wrong. Offering is cheaper: a wrong
 * suggestion costs one tap, with the alternatives directly beneath it. So a lower bar applies
 * here, and it is the ratio that carries it, not the raw margin: on the reference app's golden
 * set, of the 21 in-scope turns the router asked about, the leader was right in 13, and a
 * margin rule was only 57–67% reliable, while "at least 1.5 times the runner-up" suggested 13
 * and was right in 11. Wrong leaders arrive with a close second.
 *
 * Both numbers are round on purpose and were chosen before that measurement, not fitted to it —
 * n is small. A declared limit counts as a runner-up: if the request is nearly as close to
 * "the app cannot do that" as to a screen, it is a real question.
 */
const LEAD_FLOOR = 0.15;
const LEAD_RATIO = 1.5;

function clearlyLeads(candidates: TurnTrace['candidates']): boolean {
  const [top, next] = candidates;
  if (!top || top.score < LEAD_FLOOR) return false;
  return !next || top.score >= LEAD_RATIO * next.score;
}

/** A screen's purpose as one short sentence: the first, cut at a word if it runs on. */
export function gist(text: string | null | undefined): string | null {
  const first = (text ?? '').trim().split(/(?<=[.!?…])\s+/)[0]?.trim() ?? '';
  if (!first) return null;
  if (first.length <= 140) return first;
  return `${first.slice(0, 140).replace(/\s+\S*$/, '')}…`;
}

/**
 * The answer to small talk (chat.ts). Not a turn the router decided — nothing was asked of the app —
 * so it has no trace, and Rule 9 (every *routed* turn has one) is untouched. It never refuses. When
 * the visitor says they are lost, it offers a few real places to begin, each with what it is for:
 * the same rules as anywhere else, so nothing offered is a limit, needs an item this page cannot
 * supply, or is the page they are already on.
 *
 * `starts` are the places to begin with when the page can say them — the app's own main navigation,
 * in the words the visitor already sees there — and otherwise it falls back to the registry's own
 * order, which is no one's idea of where to start.
 */
export function smalltalkView(
  kind: Smalltalk,
  registry: Registry,
  currentPath: string,
  words: Words,
  starts: readonly Choice[] = [],
  hints: ParamHints = {},
): View {
  const say = words.talk[kind];
  if (kind !== 'help') return { tone: 'chat', title: say.title, body: say.body, destination: null, choices: [] };
  const choices = starts.length > 0 ? starts.slice(0, 3) : suggestionsFor(registry, currentPath, 3, hints);
  return {
    tone: 'chat',
    title: say.title,
    body: choices.length > 0 ? `${say.body} ${words.helpStart}` : say.body,
    destination: null,
    choices,
  };
}

/**
 * The reply to a message that was only a photo or a file. Not a routed turn — nothing was asked of the app —
 * so it has no trace. It never refuses, says plainly that nothing left the device, and asks for the one
 * thing that lets the assistant help: what the visitor wants to do with it.
 */
export function attachmentView(handedToPage: boolean, words: Words): View {
  const body = handedToPage ? words.attachHanded : words.attachOnly.body;
  return { tone: 'chat', title: words.attachOnly.title, body, destination: null, choices: [] };
}

/**
 * `starts` are where to begin when nothing the visitor said matched anything — the app's own main
 * navigation when the page has one (see `smalltalkView`).
 */
export function present(
  trace: TurnTrace,
  registry: Registry,
  currentPath: string,
  words: Words,
  starts: readonly Choice[] = [],
  hints: ParamHints = {},
): View {
  const patterns = registry.capabilities.map((c) => c.route).filter((r): r is string => typeof r === 'string');
  const capability = trace.capabilityId ? registry.byId.get(trace.capabilityId) : undefined;
  const unsure: View = { tone: 'unsure', title: words.unsure, body: null, destination: null, choices: [] };

  if (trace.outcome === 'error' || trace.outcome === null) {
    return { ...unsure, title: words.error };
  }

  // A declared limit is the system working, so it is stated as a limit, not as an apology.
  // ADR-019 (WP-53): the model may have written something more specific than the
  // registry's own fixed refusal text — *"can I change my child's medical status
  // myself?"* deserves an answer synthesised from the limit, not the limit quoted back —
  // and everything it wrote has already been checked against this role's registry
  // before it ever reached this trace. `trace.prose` wins when present; the declared
  // text is the fallback it has always been.
  if (trace.outcome === 'out_of_scope' || capability?.kind === 'unsupported') {
    const refusal = capability?.kind === 'unsupported' ? (capability as { refusal?: string }).refusal : undefined;
    return { tone: 'limit', title: words.limitTitle, body: trace.prose ?? refusal ?? words.limitFallback, destination: null, choices: [] };
  }

  if (trace.outcome !== 'execute' || !capability) {
    // Clarify: offer the screens stage 2 ranked, as links the user picks. That is
    // a choice the user makes, like a menu, so nothing moves without it. Prose can
    // still accompany this — the model tried to help and stage 3 could not settle
    // it alone — validated the same as every other branch.
    const seen = new Set<string>();
    const choices: Choice[] = [];
    let offeredFirst: string | null = null;
    // A score of 0 is no evidence: nothing the visitor said appears anywhere in what the app says, and
    // the "best" screens are whichever came first. That is a ranking of nothing, not a suggestion.
    const evidence = trace.candidates.filter((candidate) => candidate.score > 0);
    for (const candidate of evidence) {
      const c = registry.byId.get(candidate.capabilityId);
      if (!c || c.kind === 'unsupported' || registry.boundaryIds.has(c.id)) continue;
      const route = fillParams(c.route, currentPath, patterns, hints);
      if (!route || seen.has(route)) continue;
      seen.add(route);
      offeredFirst ??= c.id;
      // Every place says what it is for, so two unfamiliar names can be told apart.
      const detail = gist(c.explanation);
      choices.push({ label: c.title, route, ...(detail ? { detail } : {}) });
      if (choices.length === OFFERED) break;
    }
    if (choices.length === 0) {
      if (evidence.length === 0) {
        const places = starts.length > 0 ? starts.slice(0, 3) : suggestionsFor(registry, currentPath, 3, hints);
        if (places.length > 0) return { tone: 'unsure', title: words.unsureHelp, body: null, destination: null, choices: places };
      }
      return unsure;
    }

    // Plainly ahead, and what would be offered first *is* the leader (not something further down
    // because the leader needed an item this page cannot supply): say so. A task ("book a training")
    // is answered as one — where it can be done — and a where as a where. When the model wrote
    // something, its words frame the answer (ADR-019) and this stays out of it.
    if (!trace.prose && clearlyLeads(trace.candidates) && trace.candidates[0]?.capabilityId === offeredFirst) {
      const title = isActionRequest(String(trace.utterance ?? '')) ? words.probablyTask(choices[0]!.label) : words.probably(choices[0]!.label);
      return { tone: 'choose', title, body: null, destination: null, choices, probable: true };
    }
    return { tone: 'choose', title: words.couldHelp(choices.length), body: trace.prose ?? null, destination: null, choices };
  }

  const route = fillParams(capability.route, currentPath, patterns, hints);
  // Same preference: the model's own validated words over the fixed, build-time text.
  const body = trace.prose ?? capability.explanation ?? null;
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
