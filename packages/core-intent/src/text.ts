// Shared text normalisation. Used by every stage, so it has to be cheap
// and stable — changing it invalidates cached embeddings and shifts every score.

const PUNCT = /[^\p{L}\p{N}\s€$£%.,-]/gu;
const COMBINING = /[̀-ͯ]/g;

/**
 * A full stop or comma that is sentence punctuation rather than part of a number.
 *
 * `PUNCT` keeps `.` and `,` on purpose — `12.50`, `1,234` and `01.02.2026` have
 * to survive for the slot resolvers. But it kept them everywhere, so `"my
 * modules."` normalised to `my modules.` and never met the trigger `my modules`.
 *
 * WP-21 found it, and the way it found it is the point: whisper.cpp ends every
 * transcript with a full stop. Measured on the registered application, 10 of 40
 * spoken utterances routed differently from the same words typed, and most of
 * the ten were this — *"my modules"* resolving at stage 1, *"My modules."*
 * falling through to a clarify. Typed input with a trailing full stop had the
 * same bug all along; nobody types one to an assistant, so nothing noticed.
 *
 * Only a mark with a digit on BOTH sides is kept.
 */
const SENTENCE_PUNCT = /(?<!\d)[.,]|[.,](?!\d)/g;

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(PUNCT, ' ')
    .replace(SENTENCE_PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does',
  'did', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but',
  'i', 'me', 'my', 'mine', 'you', 'your', 'it', 'its', 'that', 'this',
  'can', 'could', 'would', 'should', 'please', 'just', 'want', 'need',
]);

/**
 * Crude suffix stripper. Not linguistically correct and not trying to be —
 * it exists so "spending"/"spend"/"spends" collide in the vocabulary.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  for (const suffix of ['ing', 'ed', 'es', 's', 'ly']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/**
 * Words that carry no intent — function words and the frame a question is
 * wrapped in, in the two languages the pilot application actually ships.
 *
 * **Deliberately separate from `STOP`.** `STOP` feeds `tokens()` and therefore
 * the hashing embedder's vocabulary; this file's own header warns that changing
 * it "invalidates cached embeddings and shifts every score", and it would
 * invalidate the committed scorecard for a reason unrelated to what is being
 * measured. This set is read by stage 1's coverage rule and nothing else.
 *
 * WP-38 lever 1 is why it exists. Triggers went from 0 to 245 and stage 1 fired
 * **twice in 210 turns** — because coverage was measured in *characters* over
 * the raw utterance, and a real question is mostly wrapper. For *"Para que serve
 * a 'Composição corporal'?"* the correct trigger is present and covers 0.53 of
 * the string, against a 0.6 bar. Measured across the golden set: 102 entries had
 * a trigger on the right capability, 2 cleared the bar, and **100 sat below it**.
 *
 * The list is function words and interrogative frames only. It must not grow to
 * include anything that distinguishes one screen from another — a word removed
 * here is a word stage 1 stops requiring, and stage 1 answers with score 1.0 and
 * no escalation.
 */
const FILLER = new Set([
  // English function words and question frames
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'do', 'does', 'did', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from',
  'and', 'or', 'but', 'as', 'by', 'about',
  'i', 'me', 'my', 'mine', 'you', 'your', 'we', 'our', 'it', 'its',
  'that', 'this', 'these', 'those', 'there', 'here',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
  'please', 'just', 'want', 'need', 'how', 'what', 'where', 'which', 'who',
  'when', 'why', 'get', 'go', 'see', 'show', 'find', 'open', 'does', 'screen',
  // Portuguese function words and question frames
  'o', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas',
  'ao', 'aos', 'pelo', 'pela', 'por', 'para', 'com', 'sem', 'em',
  'e', 'ou', 'mas', 'se', 'que', 'qual', 'quais', 'quem', 'onde', 'quando',
  'como', 'porque', 'porquê', 'quanto', 'quanta',
  'eu', 'tu', 'ele', 'ela', 'nos', 'meu', 'minha', 'meus', 'minhas',
  'seu', 'sua', 'teu', 'tua', 'este', 'esta', 'esse', 'essa', 'isso', 'isto',
  'ser', 'serve', 'e', 'sao', 'esta', 'estao', 'ver', 'vejo', 'posso', 'pode',
  'quero', 'preciso', 'faco', 'fazer', 'ir', 'abrir', 'mostrar', 'mostra',
  'chegar', 'aceder', 'consultar', 'ecra', 'pagina',
]);

/**
 * The words in `text` that actually carry intent.
 *
 * Not stemmed, and not the same thing as `tokens()`: this is the denominator of
 * stage 1's coverage rule, so it has to be the words a person chose, not their
 * stems.
 */
export function contentTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w && !FILLER.has(w));
}

/** Content words only, stemmed. */
export function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/** Character n-grams over the normalised string — catches morphology the stemmer misses. */
function charGrams(text: string, n = 4): string[] {
  const s = ` ${normalize(text)} `;
  const out: string[] = [];
  for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}

/** Word unigrams + bigrams + char 4-grams, namespaced so they cannot collide. */
export function features(text: string): string[] {
  const words = tokens(text);
  const out = words.map((w) => `w:${w}`);
  for (let i = 0; i + 1 < words.length; i++) out.push(`b:${words[i]}_${words[i + 1]}`);
  for (const g of charGrams(text)) out.push(`c:${g}`);
  return out;
}
