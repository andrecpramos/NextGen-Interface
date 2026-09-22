// A reply to what the assistant just offered: "yes", "the second one", "neither".
//
// Until 2026-09-22 every message was a new question. After "You probably want Medical status", a visitor
// who said "yes" was told "Okay. Tell me what you'd like to do" — small talk, because "yes" on its own
// is small talk — and one who said "the second one" was routed as if they had asked for a screen called
// that. A conversation that forgets what it just said is the plainest way to seem unintelligent.
//
// So when the last answer offered places, a short reply is first read as a reply to it. Matched exactly,
// like `chat.ts` and `commands.ts`: the whole message, after case, accents and punctuation are dropped,
// is a known reply or is not one. "Yes, but where are the fees?" is a question, and goes to the router.

import { normalise } from './commands.ts';

export type FollowUp =
  /** Take what was offered: the likely one, or the only one. */
  | { readonly kind: 'accept' }
  /** Take this one of what was offered, counted from 0. -1 is the last. */
  | { readonly kind: 'pick'; readonly index: number }
  /** None of those. */
  | { readonly kind: 'reject' };

// Written normalised: lower case, no accents, no punctuation — so an apostrophe is a space.
const ACCEPT = new Set([
  'yes', 'yeah', 'yep', 'yup', 'yes please', 'sure', 'that one', 'this one', 'that', 'go', 'go there',
  'take me there', 'open it', 'open that', 'do it', 'correct', 'right', 'exactly', 'perfect', 'please do',
  'sim', 'sim por favor', 'isso', 'isso mesmo', 'esse', 'essa', 'esse mesmo', 'essa mesma', 'este', 'esta',
  'pode ser', 'vamos', 'leva me', 'leva me la', 'abre', 'abre esse', 'abre essa', 'abre isso', 'claro',
  'certo', 'exato', 'exatamente', 'perfeito', 'e esse', 'e essa', 'e isso',
]);

const REJECT = new Set([
  'no', 'nope', 'neither', 'none', 'none of them', 'none of these', 'none of those', 'neither of them',
  'not that', 'not those', 'wrong', 'no thanks', 'no neither',
  'nao', 'nenhum', 'nenhuma', 'nenhum deles', 'nenhuma delas', 'nao e isso', 'nao e nenhum',
  'nao e nenhuma', 'errado', 'nem um nem outro', 'nem uma nem outra', 'nenhum destes', 'nenhuma destas',
  'nao obrigado', 'nao obrigada',
]);

/**
 * A position said as a word or a number, in either language. Not "one", "um" or "uma": they are the
 * filler in "the second one" and the article in "uma consulta", far more often than a position.
 */
const ORDINAL: Readonly<Record<string, number>> = {
  first: 0, '1st': 0, '1': 0, primeiro: 0, primeira: 0, '1o': 0, '1a': 0,
  second: 1, '2nd': 1, two: 1, '2': 1, segundo: 1, segunda: 1, '2o': 1, '2a': 1, dois: 1, duas: 1,
  third: 2, '3rd': 2, three: 2, '3': 2, terceiro: 2, terceira: 2, '3o': 2, '3a': 2, tres: 2,
  last: -1, ultimo: -1, ultima: -1,
};

/** The words around a position that say nothing else: "the second one", "a opção 2", "leva-me ao primeiro". */
const AROUND = new Set([
  'the', 'one', 'option', 'choice', 'number', 'go', 'to', 'take', 'me', 'open', 'i', 'want', 'please', 'link',
  'o', 'a', 'opcao', 'hipotese', 'numero', 'leva', 'ao', 'para', 'abre', 'quero', 'por', 'favor', 'esse', 'essa', 'do', 'da',
]);

/** What `text` says about the places just offered, or `null` when it is something else. */
export function followUpFor(text: string): FollowUp | null {
  const said = normalise(text).replace(/^(?:ok|okay)\s+/, '');
  if (!said || said.length > 60) return null;
  if (ACCEPT.has(said)) return { kind: 'accept' };
  if (REJECT.has(said)) return { kind: 'reject' };
  const words = said.split(' ');
  // Own keys only: `in` would also find "constructor" and "toString" on the object's prototype.
  const isPosition = (w: string): boolean => Object.hasOwn(ORDINAL, w);
  const positions = words.filter(isPosition);
  if (positions.length !== 1 || !words.every((w) => isPosition(w) || AROUND.has(w))) return null;
  return { kind: 'pick', index: ORDINAL[positions[0]!]! };
}
