// Shared text normalisation. Used by every stage, so it has to be cheap
// and stable — changing it invalidates cached embeddings and shifts every score.

const PUNCT = /[^\p{L}\p{N}\s€$£%.,-]/gu;
const COMBINING = /[̀-ͯ]/g;

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(PUNCT, ' ')
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
export function stem(word: string): string {
  if (word.length <= 3) return word;
  for (const suffix of ['ing', 'ed', 'es', 's', 'ly']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/** Content words only, stemmed. */
export function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/** Character n-grams over the normalised string — catches morphology the stemmer misses. */
export function charGrams(text: string, n = 4): string[] {
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
