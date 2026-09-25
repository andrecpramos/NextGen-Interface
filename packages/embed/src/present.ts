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

import { isLocaleParam } from '@nextgen/core-capability';
import { isActionRequest, type Capability, type Registry, type TurnTrace } from '@nextgen/core-intent/browser';

import type { Smalltalk } from './chat.ts';
import type { FollowUp } from './followup.ts';

export type Tone = 'go' | 'explain' | 'choose' | 'limit' | 'unsure' | 'chat' | 'answer';

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
  /**
   * Set on an `answer`: the adopter's own assistant wrote it, not this one (ADR-026). Shown under the
   * answer, so it is never mistaken for something this assistant decided or checked.
   */
  readonly from?: string;
}

export interface Words {
  readonly label: string;
  readonly placeholder: string;
  readonly submit: string;
  readonly thinking: string;
  readonly going: (title: string) => string;
  readonly alreadyHere: (title: string) => string;
  readonly open: (title: string) => string;
  /** One screen is plainly ahead, or is the only one: ask about it — "Are you looking for X?" */
  readonly probably: (title: string) => string;
  /** The same, when what was asked is a task ("book a training"), not a where. */
  readonly probablyTask: (title: string) => string;
  /** Two screens are about as likely: one question, never a list — "X or Y?" (ADR-026). */
  readonly eitherOr: (a: string, b: string) => string;
  /** A decided move, asked first because the adopter set `decide: 'confirm'` (ADR-027). */
  readonly confirmGo: (title: string) => string;
  /** The app's own search, offered for what no screen matched (`search`, ADR-027). */
  readonly searchFor: (query: string) => string;
  /** What to say to small talk. It never refuses: `title` first, then the friendlier `body`. */
  readonly talk: Readonly<Record<Smalltalk, { readonly title: string; readonly body: string }>>;
  /** Follows the `help` body when there are real places to begin. */
  readonly helpStart: string;
  /** A reply to what was just offered (followup.ts). */
  readonly followUp: {
    /** "Yes" to two places, neither of them the likely one. */
    readonly which: string;
    /** "Neither": the way on is to say more. */
    readonly neither: { readonly title: string; readonly body: string };
  };
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
  /** A limit that points somewhere: it is doing, not helping, that is refused ("I can't do that for you"). */
  readonly limitDoTitle: string;
  /** Leads into that screen: "You can do it yourself here:". */
  readonly limitDoHere: string;
  /** Leads into where the adopter said the visitor can get help instead (`helpAt`). */
  readonly limitHelpHere: string;
  /** Beneath "I can't do that for you", when the screen where it is handled is the one they are on (Rule 20). */
  readonly limitHandledHere: string;
  /** Keyboard mashing (ADR-039): not understood, and where to begin. */
  readonly mashed: string;
  readonly limitFallback: string;
  /** After a refusal that points nowhere, so it is never a dead end: one short line on what it *can* do. */
  readonly limitNext: string;
  readonly unsure: string;
  /** Nothing the visitor said matched anything in the app: say so, and offer places to begin. */
  readonly unsureHelp: string;
  readonly needsItem: string;
  /** The same, when the app has a screen listing those items: "open X, choose the one you want" (ADR-028). */
  readonly needsItemFrom: (list: string) => string;
  /** Under a list offered for an item screen: what to do there. */
  readonly fromList: (screen: string) => string;
  readonly error: string;
  readonly greeting: string;
  /** Under the greeting, before anything is asked: what this is for, to someone who has never seen it. */
  readonly greetingHint: string;
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
  /** No microphone could be opened (ADR-037). */
  readonly voiceNoMic: string;
  /** The app's speech-to-text could not be reached, or refused (ADR-037). */
  readonly voiceServiceDown: string;
  /** What was said is being turned into text on the app's own server (ADR-037). */
  readonly transcribing: string;
  readonly here: (title: string) => string;
  /** Make the panel fill the screen, and back. */
  readonly expand: string;
  readonly collapse: string;
  readonly readAloud: string;
  /** The adopter's own assistant, when it does not give itself a name (ADR-026). */
  readonly companion: string;
  /** The button that opens the adopter's own assistant, with everything it does. */
  readonly openCompanion: (name: string) => string;
  /** Under an answer the adopter's own assistant wrote. */
  readonly answeredBy: (name: string) => string;
  /** Under a message whose attachment was passed to the adopter's own assistant. */
  readonly attachToCompanion: (name: string) => string;
  /** Clears the conversation back to the greeting. */
  readonly startOver: string;
  /** The panel's two views, as a tab list (ADR-035): its accessible name. */
  readonly views: string;
  /** The tab that shows the conversation. */
  readonly chat: string;
  /** The tab that lists the app's tours. */
  readonly tutorials: string;
  /** Above the list of tours. */
  readonly toursTitle: string;
  /** Under it: the page the tours are for. */
  readonly toursOn: (page: string) => string;
  /** When the app has no tour for the page the visitor is on. */
  readonly noTours: string;
  readonly copy: string;
  readonly copied: string;
  readonly copyFailed: string;
  /**
   * Under an answer a model decided or wrote (ADR-017's disclosure, kept when "Why?" went — ADR-030).
   * The only mechanics a visitor is shown; the rest of the turn's record goes to the page (`nextgen:turn`).
   */
  readonly byModel: string;
  /** Announced when it pressed the control that starts what was asked (ADR-031). */
  readonly opened: (name: string) => string;
  /** Beside a control it points at rather than presses: the visitor's tap. */
  readonly tapToStart: (name: string) => string;
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
    alreadyHere: (title) => `You’re on ${title}`,
    open: (title) => `Open ${title}`,
    probably: (title) => `Looking for ${title}?`,
    probablyTask: (title) => `That’s in ${title}. Open it?`,
    eitherOr: (a, b) => `${a} or ${b}?`,
    confirmGo: (title) => `Open ${title}?`,
    searchFor: (query) => `Search for “${query}”`,
    talk: {
      greeting: { title: 'Hi. What do you need?', body: '' },
      thanks: { title: 'You’re welcome.', body: '' },
      goodbye: { title: 'Bye.', body: '' },
      howAreYou: { title: 'All good. What do you need?', body: '' },
      identity: { title: 'I’m this app’s assistant.', body: 'I take you to the right screen. I don’t change anything.' },
      help: { title: 'Tell me what you need.', body: 'I’ll take you to the right screen.' },
      ok: { title: 'Okay.', body: '' },
      thisPage: { title: 'I have no description of this page.', body: '' },
    },
    helpStart: 'Start here:',
    followUp: {
      which: 'Which one?',
      neither: { title: 'Okay.', body: 'Tell me more.' },
    },
    attach: 'Attach a photo or file',
    attachCamera: 'Take a photo',
    removeFile: (name) => `Remove ${name}`,
    attachedFiles: (n) => (n === 1 ? '1 file attached' : `${n} files attached`),
    attachTooMany: (max) => `You can attach up to ${max} files at a time.`,
    attachTooLarge: (megabytes) => `That file is too large. The most is ${megabytes} MB.`,
    attachUnsupported: 'That kind of file can’t be attached. Photos, PDFs and common documents can.',
    attachEmpty: 'That file is empty.',
    attachKept: 'I can’t read it, and it stays on this device. Add it on that page.',
    attachHanded: 'File sent to the app.',
    attachOnly: {
      title: 'Got it.',
      body: 'I can’t read files, and nothing leaves your device. What do you want to do with it?',
    },
    limitTitle: 'I can’t help with that.',
    limitDoTitle: 'I can’t do that for you.',
    limitDoHere: 'Do it here:',
    limitHelpHere: 'Try here:',
    limitHandledHere: 'It’s handled on this screen.',
    mashed: 'I didn’t catch that. Tell me where you want to go, or start here:',
    limitFallback: 'I can take you to any screen in this app.',
    limitNext: 'Ask me where to find something else.',
    unsure: 'I didn’t get that. Try other words.',
    unsureHelp: 'Not sure what you need. Start here:',
    needsItem: 'Open the item first, then ask again.',
    needsItemFrom: (list) => `Open ${list} and pick one.`,
    fromList: (screen) => `Pick one to see its ${screen}.`,
    error: 'Something went wrong. Nothing changed.',
    greeting: 'What do you need?',
    greetingHint: 'Say it in your own words. I’ll take you to the right screen.',
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
    voiceNoMic: 'No microphone could be opened. Check that one is connected and not in use.',
    voiceServiceDown: 'Voice is not working right now. Type your question instead.',
    transcribing: 'Writing down what you said…',
    here: (title) => `You are on ${title}`,
    expand: 'Full screen',
    collapse: 'Smaller',
    readAloud: 'Read answers aloud',
    companion: 'the app’s assistant',
    openCompanion: (name) => `Open ${name}`,
    answeredBy: (name) => `Answered by ${name}`,
    attachToCompanion: (name) => `Your attachment went to ${name}.`,
    startOver: 'Start over',
    views: 'Chat or tutorials',
    chat: 'Chat',
    tutorials: 'Tutorials',
    toursTitle: 'Tutorials for this page',
    toursOn: (page) => `On ${page}`,
    noTours: 'There is no tutorial for this page. Move to another screen to see its tutorials.',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy',
    byModel: 'Answered with help from a model.',
    opened: (name) => `Opened “${name}”.`,
    tapToStart: (name) => `Tap “${name}” to start.`,
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
    probably: (title) => `Procura ${title}?`,
    probablyTask: (title) => `Isso faz-se em ${title}. Abrir?`,
    eitherOr: (a, b) => `${a} ou ${b}?`,
    confirmGo: (title) => `Abrir ${title}?`,
    searchFor: (query) => `Pesquisar «${query}»`,
    talk: {
      greeting: { title: 'Olá. Do que precisa?', body: '' },
      thanks: { title: 'De nada.', body: '' },
      goodbye: { title: 'Até já.', body: '' },
      howAreYou: { title: 'Tudo bem. Do que precisa?', body: '' },
      identity: { title: 'Sou o assistente desta aplicação.', body: 'Levo-o ao ecrã certo. Não altero nada.' },
      help: { title: 'Diga do que precisa.', body: 'Levo-o ao ecrã certo.' },
      ok: { title: 'Certo.', body: '' },
      thisPage: { title: 'Não tenho descrição desta página.', body: '' },
    },
    helpStart: 'Comece aqui:',
    followUp: {
      which: 'Qual deles?',
      neither: { title: 'Certo.', body: 'Diga-me mais.' },
    },
    attach: 'Anexar uma foto ou ficheiro',
    attachCamera: 'Tirar uma fotografia',
    removeFile: (name) => `Remover ${name}`,
    attachedFiles: (n) => (n === 1 ? '1 ficheiro anexado' : `${n} ficheiros anexados`),
    attachTooMany: (max) => `Pode anexar até ${max} ficheiros de cada vez.`,
    attachTooLarge: (megabytes) => `Esse ficheiro é demasiado grande. O máximo é ${megabytes} MB.`,
    attachUnsupported: 'Esse tipo de ficheiro não pode ser anexado. Fotos, PDF e documentos comuns podem.',
    attachEmpty: 'Esse ficheiro está vazio.',
    attachKept: 'Não o consigo ler, e fica neste dispositivo. Junte-o nessa página.',
    attachHanded: 'Ficheiro enviado para a aplicação.',
    attachOnly: {
      title: 'Recebido.',
      body: 'Não consigo ler ficheiros, e nada sai do seu dispositivo. O que quer fazer com ele?',
    },
    limitTitle: 'Não posso ajudar com isso.',
    limitDoTitle: 'Não posso fazer isso por si.',
    limitDoHere: 'Faça-o aqui:',
    limitHelpHere: 'Veja aqui:',
    limitHandledHere: 'É tratado neste ecrã.',
    mashed: 'Não percebi. Diga-me para onde quer ir, ou comece aqui:',
    limitFallback: 'Posso levá-lo a qualquer ecrã desta aplicação.',
    limitNext: 'Pergunte-me onde encontrar outra coisa.',
    unsure: 'Não percebi. Tente outras palavras.',
    unsureHelp: 'Não percebi do que precisa. Comece aqui:',
    needsItem: 'Abra primeiro o item e pergunte de novo.',
    needsItemFrom: (list) => `Abra ${list} e escolha um.`,
    fromList: (screen) => `Escolha um para ver ${screen}.`,
    error: 'Algo correu mal. Nada foi alterado.',
    greeting: 'Do que precisa?',
    greetingHint: 'Diga por palavras suas. Eu levo-o ao ecrã certo.',
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
    voiceNoMic: 'Não foi possível abrir um microfone. Verifique se está ligado e livre.',
    voiceServiceDown: 'A voz não está a funcionar agora. Escreva a sua pergunta.',
    transcribing: 'A escrever o que disse…',
    here: (title) => `Está em ${title}`,
    expand: 'Ecrã inteiro',
    collapse: 'Mais pequeno',
    readAloud: 'Ler as respostas em voz alta',
    companion: 'o assistente da aplicação',
    openCompanion: (name) => `Abrir ${name}`,
    answeredBy: (name) => `Respondido por ${name}`,
    attachToCompanion: (name) => `O seu anexo foi para ${name}.`,
    startOver: 'Recomeçar',
    views: 'Conversa ou tutoriais',
    chat: 'Conversa',
    tutorials: 'Tutoriais',
    toursTitle: 'Tutoriais desta página',
    toursOn: (page) => `Em ${page}`,
    noTours: 'Não há nenhum tutorial para esta página. Mude de ecrã para ver os tutoriais dessa área.',
    copy: 'Copiar',
    copied: 'Copiado',
    copyFailed: 'Não foi possível copiar',
    byModel: 'Respondido com a ajuda de um modelo.',
    opened: (name) => `Abri «${name}».`,
    tapToStart: (name) => `Toque em «${name}» para começar.`,
    guideLabel: 'Guia',
    guideStep: (n, total) => `Passo ${n} de ${total}`,
    guideBack: 'Anterior',
    guideNext: 'Seguinte',
    guideDone: 'Concluir',
  },
};

/**
 * The page's own language decides the widget's — the registry was written in it too. The widget speaks
 * English (the default, for any page not in Portuguese) and Portuguese; an adopter can still replace any
 * line through `words`.
 */
export function wordsFor(lang: string | null | undefined): Words {
  return lang?.toLowerCase().startsWith('pt') ? WORDS.pt : WORDS.en;
}

const primaryTag = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0]!;

/** `tag` itself among `tags`, else the same language ("pt" for "pt-PT", "pt-BR" for "pt"), else null. */
function matchTag(tag: string, tags: Iterable<string>): string | null {
  const all = [...tags];
  return all.find((t) => t.toLowerCase() === tag.toLowerCase()) ?? all.find((t) => primaryTag(t) === primaryTag(tag)) ?? null;
}

/**
 * The one language a visitor reads (ADR-030): the page's, when the registry has the app's words in it;
 * otherwise English, the default, if the app ships it; otherwise the registry's own — so the assistant's
 * words and the app's are never two languages at once.
 * A registry with no `language` (written before ADR-030) is taken to be in the page's.
 */
export function displayLanguage(pageLang: string | null | undefined, registry: Registry): string {
  const own = registry.language;
  if (!own) return pageLang || 'en';
  if (!pageLang) return own;
  const offered = new Set<string>([own]);
  for (const c of registry.capabilities) for (const tag of Object.keys(c.translations ?? {})) offered.add(tag);
  // A page in a language the app does not ship: English, the default, where the app has it.
  return matchTag(pageLang, offered) ?? matchTag('en', offered) ?? own;
}

const localized = new WeakMap<Registry, Map<string, Registry>>();

/**
 * The registry as a visitor reading `lang` sees it: each capability's `title`, `explanation` and `refusal`
 * in that language (ADR-030). What a translation does not have is left out rather than shown in another
 * language — except a name, which is a name in any language. Display only: the router keeps the registry
 * it was given, so no decision and no score changes. Built once per language.
 */
export function inLanguage(registry: Registry, lang: string): Registry {
  // Already in it: the registry's own language, or one it does not name.
  if (!registry.language || matchTag(lang, [registry.language])) return registry;
  let views = localized.get(registry);
  if (!views) localized.set(registry, (views = new Map()));
  const cached = views.get(lang);
  if (cached) return cached;
  const capabilities = registry.capabilities.map((c): Capability => {
    const tag = matchTag(lang, Object.keys(c.translations ?? {}));
    const text = tag ? c.translations![tag] : undefined;
    const { explanation: _explanation, refusal: _refusal, ...rest } = c;
    return {
      ...rest,
      title: text?.title ?? c.title,
      ...(text?.explanation ? { explanation: text.explanation } : {}),
      ...(text?.refusal ? { refusal: text.refusal } : {}),
    };
  });
  const view: Registry = { ...registry, language: lang, capabilities, byId: new Map(capabilities.map((c) => [c.id, c])) };
  views.set(lang, view);
  return view;
}

const strip = (path: string): string => path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';

/** What the page knows about a parameter that its URL does not say. Only a locale, for now. */
export interface ParamHints {
  readonly locale?: string | undefined;
}

/**
 * A route the assistant may link to or move the browser to: a path on this site, and nothing that a
 * browser would read as another one. Every destination passes here before it becomes an `href` or a
 * move (ADR-029) — the registry's routes, parameters filled from the URL, the search template, the home
 * route, the app's own navigation — so a value that went wrong anywhere upstream is a missing link, never
 * an open redirect or a script URL. Browsers read `/\evil.example` as `//evil.example`; a control
 * character can hide either. `null` when it is not safe.
 */
export function safeRoute(route: unknown): string | null {
  if (typeof route !== 'string' || route.length === 0 || route.length > 2048) return null;
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(route)) return null;
  try {
    // Only compared, never requested; loopback, so Rule 8's gate agrees.
    const base = 'http://localhost';
    return new URL(route, base).origin === base ? route : null;
  } catch {
    return null;
  }
}

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
    const value = known.get(name) ?? (isLocaleParam(name) ? hints.locale : undefined);
    if (value !== undefined) filled.push(value);
    else if (!optional) return null;
  }
  return filled.join('/') || '/';
}

/**
 * The screen a visitor opens to reach an item-scoped one: `/players/:id/stats` is reached from `/players`.
 * The capability whose route is the longest prefix of this one, cut before its first parameter that picks
 * an item (a locale is not one), and that can be opened from here. `null` when the app declares none.
 *
 * In a complex app most screens are about one item — a player, an invoice, an order — and a visitor on a
 * page that names none could only be told "open that item first" (ADR-028). The list is where they do.
 */
export function listFor(capability: Capability, registry: Registry, currentPath: string, patterns: readonly string[], hints: ParamHints = {}): { readonly capability: Capability; readonly route: string } | null {
  const segments = (capability.route ?? '').split('/');
  const cut = segments.findIndex((s) => s.startsWith(':') && !isLocaleParam(s.slice(1).replace(/\?$/, '')));
  if (cut <= 0) return null;
  const prefix = segments.slice(0, cut);
  let best: { capability: Capability; route: string; length: number } | null = null;
  for (const c of registry.capabilities) {
    if (c.kind !== 'navigate' || !c.route || c.id === capability.id) continue;
    const parts = c.route.split('/');
    if (parts.length > prefix.length || parts.length < 2 || !parts.every((p, i) => p === prefix[i])) continue;
    const route = fillParams(c.route, currentPath, patterns, hints);
    if (!route || (best && best.length >= parts.length)) continue;
    best = { capability: c, route, length: parts.length };
  }
  return best ? { capability: best.capability, route: best.route } : null;
}

/**
 * Where a screen sits, in the app's own words: the title of the screen above it (`/finance/settings` sits
 * under `/finance`, "Finanças"), else its route's first segment. How two screens with one name — the
 * "Settings" of Finance and the "Settings" of Squad — are told apart when both are offered.
 */
export function areaOf(capability: Capability, registry: Registry): string | null {
  const segments = (capability.route ?? '').split('/').filter((s) => s && !s.startsWith(':'));
  for (let n = segments.length - 1; n >= 1; n--) {
    const prefix = `/${segments.slice(0, n).join('/')}`;
    const parent = registry.capabilities.find((c) => c.kind === 'navigate' && c.route === prefix && c.id !== capability.id);
    if (parent) return parent.title;
  }
  const first = segments[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1).replace(/[-_]/g, ' ') : null;
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

/**
 * No screen is even a likely one: every candidate is below the bar a leader must clear to be offered as
 * one (`LEAD_FLOOR`) — "as likely unrelated as not" (ADR-025). On a content-heavy app, "fotos de Ana en
 * Oporto" shares a stop-word or two with a screen and scores 0.05: that is not a match, and treating it as
 * one offered two unrelated screens where the app's search, or its own assistant, was the answer
 * (ADR-027). Not a new number: the same floor.
 */
export function barelyMatched(candidates: TurnTrace['candidates']): boolean {
  return candidates.every((candidate) => candidate.score < LEAD_FLOOR);
}
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
  // One line under a name, not a paragraph: enough to tell two places apart.
  if (first.length <= 90) return first;
  return `${first.slice(0, 90).replace(/\s+\S*$/, '')}…`;
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
  if (kind === 'thisPage') {
    // Where the visitor is standing, in the app's own words: the screen whose route is this path.
    const patterns = registry.capabilities.map((c) => c.route).filter((r): r is string => typeof r === 'string');
    const here = registry.capabilities.find((c) => {
      if (c.kind === 'unsupported' || registry.boundaryIds.has(c.id)) return false;
      const route = fillParams(c.route, currentPath, patterns, hints);
      return route !== null && isSamePlace(route, currentPath);
    });
    if (here) return { tone: 'explain', title: words.here(here.title), body: here.explanation ?? null, destination: null, choices: [] };
    // A page the registry does not know: say so, and offer places to go rather than guess.
    const choices = starts.length > 0 ? starts.slice(0, 3) : suggestionsFor(registry, currentPath, 3, hints);
    return { tone: 'chat', title: say.title, body: say.body, destination: null, choices };
  }
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
 * The answer to a reply about what was just offered (followup.ts): take the one they named, ask which
 * when "yes" could mean either, or hear "neither". `null` when the reply names a place that was not
 * offered ("the third" of two) — then the message is routed like any other.
 *
 * Not a routed turn: the choice was the router's, a turn ago, and that turn has its trace.
 */
export function followUpView(
  reply: FollowUp,
  offer: { readonly choices: readonly Choice[]; readonly probable: boolean },
  words: Words,
): View | null {
  const { choices } = offer;
  if (reply.kind === 'reject') {
    return { tone: 'chat', title: words.followUp.neither.title, body: words.followUp.neither.body, destination: null, choices: [] };
  }
  let index: number;
  if (reply.kind === 'pick') {
    index = reply.index < 0 ? choices.length + reply.index : reply.index;
  } else if (offer.probable || choices.length === 1) {
    index = 0;
  } else {
    // Two places, neither the likely one: "yes" is not an answer to which.
    return { tone: 'choose', title: words.followUp.which, body: null, destination: null, choices };
  }
  const chosen = choices[index];
  if (!chosen) return null;
  return { tone: 'go', title: words.going(chosen.label), body: null, destination: chosen.route, choices: [] };
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
 * The app's own search, as a place to offer (ADR-027): `template` is a path on this app with `{query}`
 * where the words go — `/search?q={query}`. For an app whose content is people, posts and products
 * rather than screens, "find Ana's photos from Porto" matches no screen, and the app's search is the
 * honest answer. `null` for a template that is not a same-origin path with a `{query}` in it: an
 * attribute or option must never become a link to somewhere else.
 */
export function searchChoice(template: string | null | undefined, query: string, words: Words): Choice | null {
  const said = query.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!template || !said || !template.startsWith('/') || template.startsWith('//') || !template.includes('{query}')) return null;
  return { label: words.searchFor(said), route: template.replace('{query}', encodeURIComponent(said)) };
}

/**
 * How readily the assistant moves the browser — the adopter's dial, not the router's (ADR-027). The
 * router's calibrated decision is the same under all three; what changes is what is done with it:
 *
 * - `confirm`  never moves without a yes. Even a decided turn is asked: "Open Calendar?" — for an app
 *              where a wrong page is costly, or visitors are wary.
 * - `balanced` (default) moves when the router decided; asks one question when it did not.
 * - `eager`    also moves when one place is plainly ahead (the likely-one bar, ADR-023) — fewer
 *              questions, and sometimes a wrong page, which the visitor leaves with "not this".
 *
 * It never touches a limit, a refusal, or a turn where nothing matched.
 */
export type Decide = 'confirm' | 'balanced' | 'eager';
export const DECIDE: readonly Decide[] = ['confirm', 'balanced', 'eager'];

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
  decide: Decide = 'balanced',
): View {
  const patterns = registry.capabilities.map((c) => c.route).filter((r): r is string => typeof r === 'string');
  const capability = trace.capabilityId ? registry.byId.get(trace.capabilityId) : undefined;
  const unsure: View = { tone: 'unsure', title: words.unsure, body: null, destination: null, choices: [] };

  if (trace.outcome === 'error' || trace.outcome === null) {
    return { ...unsure, title: words.error };
  }

  // Keyboard mashing (ADR-039): not understood, said plainly, with places to begin — never a dead end.
  if (trace.mashing) {
    const places = starts.length > 0 ? starts.slice(0, 3) : suggestionsFor(registry, currentPath, 3, hints);
    return { tone: 'unsure', title: words.mashed, body: null, destination: null, choices: places };
  }

  // A declared limit is the system working, so it is stated as a limit, not as an apology.
  // ADR-019 (WP-53): the model may have written something more specific than the
  // registry's own fixed refusal text — *"can I change my child's medical status
  // myself?"* deserves an answer synthesised from the limit, not the limit quoted back —
  // and everything it wrote has already been checked against this role's registry
  // before it ever reached this trace. `trace.prose` wins when present; the declared
  // text is the fallback it has always been.
  if (trace.outcome === 'out_of_scope' || capability?.kind === 'unsupported') {
    // Rule 20 (ADR-041): asked to change something, the assistant says it cannot do it for them, and
    // offers the screen where it is handled — a link the visitor takes, never a move.
    if (trace.changeRequest && capability && capability.kind !== 'unsupported') {
      const route = fillParams(capability.route, currentPath, patterns, hints);
      if (route && isSamePlace(route, currentPath)) {
        return { tone: 'limit', title: words.limitDoTitle, body: words.limitHandledHere, destination: null, choices: [] };
      }
      const detail = gist(capability.explanation);
      const list = route ? null : listFor(capability, registry, currentPath, patterns, hints);
      const place: Choice | null = route
        ? { label: capability.title, route, ...(detail ? { detail } : {}) }
        : list
          ? { label: list.capability.title, route: list.route, detail: words.fromList(capability.title) }
          : null;
      return { tone: 'limit', title: words.limitDoTitle, body: place ? words.limitHelpHere : null, destination: null, choices: place ? [place] : [] };
    }
    const refusal = capability?.kind === 'unsupported' ? (capability as { refusal?: string }).refusal : undefined;
    const said = trace.prose ?? refusal ?? words.limitFallback;
    // The assistant helps; it does not act. A limit can point to where the visitor can do it
    // themselves, and the answer ends there rather than at "no".
    //
    // 1. Where the adopter said (`helpAt`, from knowledge.json): kept per role at build, so every route
    //    is one this visitor can open.
    const toChoice = (c: (typeof registry.capabilities)[number]): Choice | null => {
      const route = fillParams(c.route, currentPath, patterns, hints);
      if (!route || isSamePlace(route, currentPath)) return null;
      const detail = gist(c.explanation);
      return { label: c.title, route, ...(detail ? { detail } : {}) };
    };
    const declared = (capability?.helpAt ?? [])
      .map((route) => registry.capabilities.find((c) => c.kind === 'navigate' && c.route === route))
      .flatMap((c) => (c ? [toChoice(c)] : []))
      .filter((c): c is Choice => c !== null);
    if (declared.length > 0) {
      // "I can't help with that here" would contradict the help beneath it: it is doing, not helping, that is refused.
      return { tone: 'limit', title: words.limitDoTitle, body: `${said} ${words.limitHelpHere}`, destination: null, choices: declared.slice(0, OFFERED) };
    }
    // 2. A limit about *acting* (ADR-025) — "change my notification settings for me" — is about a thing
    //    the app has a screen for: the one the request ranks first, when it is a plain match. The same
    //    "barely a match" bar the likely-one offer uses, not a new number: below it, the screen is as
    //    likely unrelated as not, and a wrong "do it here" is worse than a plain refusal.
    if (capability?.refuses === 'action') {
      const places = trace.candidates
        .filter((c) => c.score >= LEAD_FLOOR && !registry.boundaryIds.has(c.capabilityId))
        .map((c) => registry.byId.get(c.capabilityId))
        .flatMap((c) => (c && c.kind === 'navigate' ? [toChoice(c)] : []))
        .filter((c): c is Choice => c !== null)
        .slice(0, OFFERED);
      if (places.length > 0) {
        return { tone: 'limit', title: words.limitDoTitle, body: `${said} ${words.limitDoHere}`, destination: null, choices: places };
      }
    }
    return { tone: 'limit', title: words.limitTitle, body: said, destination: null, choices: [] };
  }

  if (trace.outcome !== 'execute' || !capability) {
    // Clarify: offer the screens stage 2 ranked, as links the user picks. That is
    // a choice the user makes, like a menu, so nothing moves without it. Prose can
    // still accompany this — the model tried to help and stage 3 could not settle
    // it alone — validated the same as every other branch.
    const seen = new Set<string>();
    const choices: Choice[] = [];
    /** The screen each choice opens, for telling two with one name apart. */
    const owners: Capability[] = [];
    let offeredFirst: string | null = null;
    // A score of 0 is no evidence: nothing the visitor said appears anywhere in what the app says, and
    // the "best" screens are whichever came first. That is a ranking of nothing, not a suggestion.
    const evidence = trace.candidates.filter((candidate) => candidate.score > 0);
    for (const candidate of evidence) {
      const c = registry.byId.get(candidate.capabilityId);
      if (!c || c.kind === 'unsupported' || registry.boundaryIds.has(c.id)) continue;
      let route = fillParams(c.route, currentPath, patterns, hints);
      let owner = c;
      // Every place says what it is for, so two unfamiliar names can be told apart.
      let detail = gist(c.explanation);
      if (!route) {
        // A screen about one item this page does not name: offer the list it is reached from (ADR-028),
        // saying what to do there — rather than drop the screen the visitor most likely meant.
        const list = listFor(c, registry, currentPath, patterns, hints);
        if (!list) continue;
        route = list.route;
        owner = list.capability;
        detail = words.fromList(c.title);
      }
      if (seen.has(route)) continue;
      seen.add(route);
      offeredFirst ??= c.id;
      choices.push({ label: owner.title, route, ...(detail ? { detail } : {}) });
      owners.push(owner);
      if (choices.length === OFFERED) break;
    }
    // Two screens with one name — the "Settings" of two areas — say which area each is in (ADR-028).
    const folded = choices.map((c) => c.label.trim().toLowerCase());
    for (let i = 0; i < choices.length; i++) {
      if (folded.indexOf(folded[i]!) === folded.lastIndexOf(folded[i]!)) continue;
      const area = areaOf(owners[i]!, registry);
      if (area) choices[i] = { ...choices[i]!, label: `${choices[i]!.label} · ${area}` };
    }
    if (choices.length === 0) {
      if (evidence.length === 0) {
        const places = starts.length > 0 ? starts.slice(0, 3) : suggestionsFor(registry, currentPath, 3, hints);
        if (places.length > 0) return { tone: 'unsure', title: words.unsureHelp, body: null, destination: null, choices: places };
      }
      return unsure;
    }

    // One question, never a menu (ADR-026): a visitor who does not know the app cannot rank names they
    // have never seen, but can answer "this, or that?". When one place is plainly ahead — and what would
    // be offered first *is* the leader, not something further down because the leader needed an item
    // this page cannot supply — or is the only one, the question is about it alone, and "yes" takes it
    // (followup.ts). A task ("book a training") is asked as one: where it can be done. When the model
    // wrote something (ADR-019), its words are the body beneath the question.
    const [first, second] = choices as [Choice, Choice | undefined];
    const leads = clearlyLeads(trace.candidates) && trace.candidates[0]?.capabilityId === offeredFirst;
    // The adopter asked for fewer questions (ADR-027): a plain leader is taken, not asked about. A lone
    // weak match is still asked — "eager" moves on a leader, never on the only straw there is.
    // Rule 20 (ADR-041): a request to change something is never followed, even by "eager", and is asked as
    // what it is — the assistant cannot do it; this is where it is handled.
    if (trace.changeRequest) {
      return { tone: 'limit', title: words.limitDoTitle, body: words.limitHelpHere, destination: null, choices: !second || leads ? [first] : [first, second] };
    }
    if (decide === 'eager' && leads && !trace.prose) {
      return { tone: 'go', title: words.going(first.label), body: null, destination: first.route, choices: [] };
    }
    if (!second || leads) {
      const title = isActionRequest(String(trace.utterance ?? '')) ? words.probablyTask(first.label) : words.probably(first.label);
      // Only a real leader is drawn as the likely one; a lone weak match is asked about all the same.
      return { tone: 'choose', title, body: trace.prose ?? null, destination: null, choices: [first], ...(leads ? { probable: true } : {}) };
    }
    return { tone: 'choose', title: words.eitherOr(first.label, second.label), body: trace.prose ?? null, destination: null, choices: [first, second] };
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
    // About one item, and this page names none. Where the app lists them, that is the way there (ADR-028).
    const list = listFor(capability, registry, currentPath, patterns, hints);
    const through = list ? words.needsItemFrom(list.capability.title) : words.needsItem;
    return {
      tone: 'explain',
      title: capability.title,
      body: through,
      destination: null,
      choices: list ? [{ label: list.capability.title, route: list.route, detail: words.fromList(capability.title) }] : [],
    };
  }
  if (isSamePlace(route, currentPath)) {
    return { tone: 'explain', title: words.alreadyHere(capability.title), body: null, destination: null, choices: [] };
  }
  // The adopter asked for nothing to move without a yes (ADR-027): the decision is offered, and "yes",
  // "sim" or a tap takes it (followup.ts).
  if (decide === 'confirm') {
    const detail = gist(capability.explanation);
    return {
      tone: 'choose',
      title: words.confirmGo(capability.title),
      body: trace.prose ?? null,
      destination: null,
      choices: [{ label: capability.title, route, ...(detail ? { detail } : {}) }],
      probable: true,
    };
  }
  // Moving is the answer: "Opening X", and the screen itself says the rest — not its stock description
  // (ADR-030). What a model wrote in reply to the question is an answer, and stays (ADR-019).
  return { tone: 'go', title: words.going(capability.title), body: trace.prose ?? null, destination: route, choices: [] };
}
