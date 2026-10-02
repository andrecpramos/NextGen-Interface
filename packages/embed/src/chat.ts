// Small talk: the few things a visitor says that are not a question about the app — hello, thanks,
// who are you, what can you do, "I have no idea what to do here".
//
// Matched before routing, and exactly, for the reason `commands.ts` gives: the whole utterance, after
// case, accents and punctuation are dropped. And for a reason of its own. A greeting scores weakly
// against every screen, so a router handed "hi" refuses it — "that is not something I can do here" —
// and a visitor greeted with a refusal has learned the assistant is not for them. Someone who does
// not know the app is exactly who says "help" or "I'm lost", and that has to be the friendliest
// answer the assistant gives, not the coldest.
//
// The list is short and closed, in the two languages the product speaks, and anything longer is a
// question: it goes to the router as one. The one exception is a *leading* greeting, which is let go
// so that "hi, where are my kids?" is routed as "where are my kids?" and not refused for saying hi.

import { normalise } from './commands.ts';

/**
 * `thisPage` is a question about where the visitor is standing ("what is this page?"): answered from the
 * current screen's own description, not routed — routed, it scored every screen alike and offered two.
 */
export type Smalltalk = 'greeting' | 'thanks' | 'goodbye' | 'howAreYou' | 'identity' | 'help' | 'ok' | 'thisPage';

export interface Said {
  readonly kind: Smalltalk;
  /**
   * What is left once a leading greeting is let go — the visitor's real question, in their own words,
   * for the router. Empty when the whole utterance was small talk.
   */
  readonly rest: string;
}

type Phrases = Readonly<Record<Smalltalk, readonly string[]>>;

// Written already normalised: lower case, no accents, no punctuation — so an apostrophe is a space
// ("how's" is "how s"), and each such phrase is also written without it, as it is often typed.
const EN: Phrases = {
  greeting: [
    'hi', 'hello', 'hey', 'hey there', 'hi there', 'hello there', 'good morning', 'good afternoon', 'good evening',
    'howdy', 'yo', 'greetings', 'hello assistant', 'hi assistant', 'hey assistant',
  ],
  thanks: ['thanks', 'thank you', 'thanks a lot', 'thank you very much', 'thanks so much', 'many thanks', 'thx', 'cheers'],
  goodbye: ['bye', 'goodbye', 'bye bye', 'see you', 'see you later', 'see ya', 'cya', 'later', 'good night'],
  howAreYou: ['how are you', 'how are you doing', 'how do you do', 'how s it going', 'hows it going', 'how is it going', 'what s up', 'whats up', 'sup'],
  identity: [
    'who are you', 'what are you', 'are you a bot', 'are you a robot', 'are you an ai', 'are you human', 'are you real',
    'what s your name', 'whats your name', 'what is your name',
  ],
  help: [
    'help', 'help me', 'i need help', 'need help', 'can you help', 'can you help me', 'what can you do', 'what can i ask', 'what can i ask you',
    'what do you do', 'how do you work', 'how does this work', 'how do i use this', 'i don t know what to do', 'i dont know what to do',
    'i don t know', 'i dont know', 'i m lost', 'im lost', 'i am lost', 'i have no idea', 'where do i start', 'where to start',
    'what should i do', 'what now', 'what is this', 'what is this app', 'what is this for', 'what does this do',
    'how does this app work', 'how does it work', 'how do i use this app',
  ],
  ok: ['ok', 'okay', 'k', 'sure', 'cool', 'got it', 'i see', 'understood', 'alright', 'fine', 'great', 'nice', 'yes', 'yeah', 'yep', 'no', 'nope'],
  thisPage: [
    'what is this page', 'what s this page', 'whats this page', 'what is this screen', 'what s this screen',
    'what is this page for', 'what is this screen for', 'what s this page for', 'whats this page for',
    'what s this screen for', 'whats this screen for', 'what does this page do', 'what does this screen do',
    'what can i do here', 'what can i do on this page', 'what can i do on this screen', 'what am i looking at',
    'where am i', 'what page is this', 'which page is this', 'explain this page', 'explain this screen',
    'tell me about this page', 'what is here', 'what s here',
  ],
};

const PT: Phrases = {
  greeting: ['ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'ola assistente', 'oi assistente', 'boas'],
  thanks: ['obrigado', 'obrigada', 'muito obrigado', 'muito obrigada', 'obrigadinho', 'obg', 'valeu', 'agradeco'],
  goodbye: ['adeus', 'tchau', 'xau', 'ate logo', 'ate ja', 'ate amanha', 'ate breve'],
  howAreYou: ['tudo bem', 'como estas', 'como esta', 'como vais', 'como vai', 'como estas tu', 'e entao'],
  identity: [
    'quem es tu', 'quem es', 'quem e voce', 'quem e', 'o que es', 'es um robo', 'es um bot', 'es humano', 'voce e um robo',
    'como te chamas', 'qual e o teu nome', 'como se chama',
  ],
  help: [
    'ajuda', 'ajuda me', 'ajudas', 'podes ajudar', 'podes ajudar me', 'preciso de ajuda', 'o que sabes fazer', 'o que podes fazer',
    'o que consegues fazer', 'o que fazes', 'como funciona', 'como funcionas', 'como uso isto', 'nao sei o que fazer', 'nao sei',
    'estou perdido', 'estou perdida', 'nao faco ideia', 'por onde comeco', 'por onde comecar', 'por onde devo comecar', 'o que faco',
  ],
  ok: ['ok', 'okey', 'sim', 'nao', 'percebi', 'certo', 'pois', 'claro', 'entendi', 'beleza', 'esta bem', 'bom', 'otimo', 'boa'],
  thisPage: [
    'o que e esta pagina', 'o que e este ecra', 'que pagina e esta', 'que ecra e este', 'para que serve esta pagina',
    'para que serve este ecra', 'o que faz esta pagina', 'o que faz este ecra', 'o que posso fazer aqui',
    'o que posso fazer nesta pagina', 'o que posso fazer neste ecra', 'onde estou', 'onde e que estou',
    'explica esta pagina', 'explica me esta pagina', 'explica este ecra', 'o que e que esta aqui', 'o que ha aqui',
    'o que tem aqui', 'o que vejo aqui',
  ],
};

const POLITE = /^(?:por favor|please)\s+|\s+(?:por favor|please)$/g;

/** Guards the work done, not the meaning: nothing a visitor pastes makes this slow. */
const MAX_CHARS = 300;
const MAX_WORDS = 30;
const MAX_VOCABULARY_WORDS = 12;

/** "hiii", "heyyy", "helloooo": a stretched word is the word. Applied to both sides, so "hello" is still "hello". */
const fold = (text: string): string => text.replace(/(\p{L})\1+/gu, '$1');

function indexOf(table: Phrases): Map<string, Smalltalk> {
  const index = new Map<string, Smalltalk>();
  for (const kind of Object.keys(table) as Smalltalk[]) for (const phrase of table[kind]) index.set(fold(phrase), kind);
  return index;
}

const EN_INDEX = indexOf(EN);
const PT_INDEX = indexOf(PT);

/** Every greeting, longest first, as words — so "good morning" is let go whole and "hey there" before "hey". */
const GREETINGS: readonly (readonly string[])[] = [...EN.greeting, ...PT.greeting]
  .map((phrase) => fold(phrase).split(' '))
  .sort((a, b) => b.length - a.length);

/**
 * The second way to recognise small talk, for what cannot be listed: an utterance *made only of*
 * generic words, with at least one that says what it is. Being lost is said a hundred ways — "I have
 * no idea what to do here", "I'm new and totally lost" — and each one the exact list misses is a
 * refusal to the visitor who most needs help. `filler` holds only function words and words that are
 * about the app in general, never about anything in it: one word outside both lists (appointment,
 * calendar, fees, medical) and the utterance is a question, and goes to the router.
 *
 * Written normalised, in both languages: a contraction is two words ("don't" is "don t").
 */
interface Vocabulary {
  readonly marks: ReadonlySet<string>;
  readonly filler: ReadonlySet<string>;
  /**
   * Marks that are phrases of generic words, none a mark alone: "don't know", "what do I do". "I don't
   * know what to do here" is the plainest way to be lost, and until 2026-09-22 it had no marker word in
   * it, so it went to the router and got two unrelated screens. Matched as whole words.
   */
  readonly phrases?: readonly string[];
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean).map(fold));

const LOST: Vocabulary = {
  marks: words(`help lost idea clue confused stuck start begin started beginner
    ajuda ajudar ajudas perdido perdida ideia confuso confusa comecar comeco`),
  filler: words(`i m im me we you it is am are a an the this that here there to do does did don t can could should would will
    what how where when please pls really totally completely very so just quite kind of bit little and or have has had know sure
    not no new need want some any with about for use using understand get getting going around app application site website page
    system platform thing things anything everything something first now yet still at all in on out be been go work works working
    doing s ll ve d
    eu sou nao sei o os as que fazer faco aqui isto isso esta este estou tenho nenhuma nem um uma de do da por onde como devo
    posso podes pode preciso favor muito mesmo e ou mas novo nova aplicacao pagina sistema plataforma usar uso funciona funcionar
    ter ando estar sem coisa coisas tudo nada ja agora ainda em no na para com se perceber percebo entender entendo
    disto disso daqui nisto nisso`),
  phrases: [
    'don t know', 'dont know', 'do not know', 'not sure', 'what do i do', 'what can i do', 'what am i doing',
    'nao sei', 'o que faco', 'o que devo fazer', 'o que posso fazer', 'nao percebo', 'nao entendo',
  ].map(fold),
};

const THANKS: Vocabulary = {
  marks: words('thanks thank thx obrigado obrigada obg valeu agradeco'),
  filler: words(`you so very much a lot for your the help this that all it really appreciate guys assistant many
    muito pela pelo ajuda tudo isso por de mesmo mil vezes assistente`),
};

function madeOf(said: string, vocabulary: Vocabulary): boolean {
  const tokens = said.split(' ');
  if (tokens.length > MAX_VOCABULARY_WORDS) return false;
  const padded = ` ${said} `;
  const marked = tokens.some((t) => vocabulary.marks.has(t)) || (vocabulary.phrases ?? []).some((p) => padded.includes(` ${p} `));
  return marked && tokens.every((t) => vocabulary.marks.has(t) || vocabulary.filler.has(t));
}

function lookup(said: string, lang: string | null | undefined): Smalltalk | null {
  const plain = fold(said.replace(POLITE, '').trim());
  if (!plain) return null;
  const indexes = lang?.toLowerCase().startsWith('pt') ? [PT_INDEX, EN_INDEX] : [EN_INDEX, PT_INDEX];
  for (const index of indexes) {
    const kind = index.get(plain);
    if (kind) return kind;
  }
  // Thanks first: "thanks for the help" contains a word that, on its own, would say help.
  if (madeOf(plain, THANKS)) return 'thanks';
  if (madeOf(plain, LOST)) return 'help';
  return null;
}

/**
 * A word on its own, ignoring punctuation that trails it ("hi," "Olá!") — and `null` for anything with
 * more in it, so "hello-kitty" and "hi-fi" are words of their own and not a greeting and something else.
 */
const WORD = /^[\p{L}\p{M}\p{N}]+[,.!?;:…]*$/u;

function wordAt(tokens: readonly string[], at: number): string | null {
  const token = tokens[at];
  return token !== undefined && WORD.test(token) ? fold(normalise(token)) : null;
}

/** How many words of a greeting start at `at`, or 0. */
function greetingLength(tokens: readonly string[], at: number): number {
  for (const greeting of GREETINGS) {
    if (greeting.every((word, i) => wordAt(tokens, at + i) === word)) return greeting.length;
  }
  return 0;
}

/**
 * The small talk `text` is, or `null` when it is a question. The page's language is tried first.
 *
 * A greeting followed by a question is a question: `rest` is the question, for the router. A greeting
 * followed by more small talk is that small talk ("hi, how are you?" is asking how it is).
 */
export function smalltalkFor(text: string, lang: string | null | undefined): Said | null {
  if (text.length > MAX_CHARS) return null;
  const whole = normalise(text);
  if (!whole) return null;
  const direct = lookup(whole, lang);
  if (direct) return { kind: direct, rest: '' };

  const tokens = text.trim().split(/\s+/);
  if (tokens.length > MAX_WORDS) return null;
  let at = 0;
  for (let n = greetingLength(tokens, at); n > 0; n = greetingLength(tokens, at)) at += n;
  if (at === 0) return null;

  const rest = tokens.slice(at).join(' ').replace(/^[^\p{L}\p{N}]+/u, '');
  const said = normalise(rest);
  if (!said) return { kind: 'greeting', rest: '' };
  const then = lookup(said, lang);
  return then ? { kind: then, rest: '' } : { kind: 'greeting', rest };
}
