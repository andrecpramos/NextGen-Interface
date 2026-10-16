/**
 * Is this a request to *do* something the application does not do?
 *
 * [ADR-015](../../../.claude/decisions/ADR-015.md), accepted 2026-09-10, amending
 * ADR-009. The declared-boundary mechanism is sound; its only input was topic
 * similarity, and **what makes "book my son a hospital appointment" out-of-scope
 * is its verb, not its subject.** A medical page and a request to book a medical
 * appointment are about the same thing, so cosine ranks them together. Section-scoped
 * boundaries were built to fix that; they raised the boundary's score and moved
 * detection by exactly nothing.
 *
 * Improving retrieval then produced the strongest evidence for this ADR from the other
 * direction: improving *topical* retrieval made refusal measurably **worse**
 * (out-of-scope 32.4% → 26.5%), because ranking real capabilities higher offers
 * the model more plausible wrong answers. Topic is not the signal.
 *
 * ## Measured before it was proposed
 *
 * On a real application's golden set, `nomic-embed-text`, held-out split:
 *
 * | | flagged as an action request |
 * |---|---|
 * | the 34 hand-written out-of-scope requests | **88.2%** |
 * | the 176 in-domain questions | **2.8%** |
 *
 * Out-of-scope refused **model-free** goes 20.0% → **45.0%** at zero in-domain
 * false refusals. The mechanism is both better and cheaper than the 38.2% that
 * currently needs a model call.
 *
 * ## Two things this deliberately is not
 *
 * **Not imperativeness.** Navigation is imperative too — *"abre o calendário"*,
 * *"show me"*, *"take me to"*. The discriminator is *which* verb: ones the
 * assistant performs versus ones it does not.
 *
 * **Not a keyword match.** A first-person instructional frame is not a request
 * to act: *"Como criar uma nova época?"* is a user asking how to do it
 * themselves, which is exactly what this product is for. Removing that frame cut
 * in-domain false flags 11.4% → 2.8%. Note what is excluded from the exclusion:
 * *"podes marcar…"* / *"can you book…"* is interrogative and still an action
 * request, because it asks the **assistant** to act. First person asks for
 * directions; second person asks for service.
 *
 * ## The honest limitation
 *
 * The verb lists are Portuguese and English, the two languages the tool
 * supports. **This is per-adopter vocabulary in engine code**, which is
 * the wrong home for it long-term — a Spanish adopter gets no signal at all and
 * silently falls back to the topic-only behaviour, which is the pre-ADR-015
 * state rather than a failure. ADR-015 records this as accepted for now and owed
 * a move into the generated registry.
 */

import { normalize, tokens } from './text.ts';

/**
 * Verbs that ask the assistant to perform something it does not perform.
 *
 * A verb belongs here only if doing it would change something, send something,
 * or reach outside the application. Every verb meaning "take me there" or "show
 * me" is deliberately absent — those are the product.
 *
 * Grouped by **concept**, not by language — and that grouping is load-bearing
 * rather than tidiness.
 *
 * Measured, not assumed. The guard below asks whether the application itself does
 * the thing being requested, and an app may document itself in Portuguese while
 * its users ask in both languages. The registry says *"pode **eliminar** uma
 * tarefa"*; the question says *"I want to **delete** a task"*. With two flat
 * per-language lists those never meet, so the guard could not see that the app
 * has a delete-a-task screen, and four in-domain questions about that screen
 * stayed flagged as out-of-scope action requests.
 *
 * Under a zero-false-refusal constraint, four is enough to block every margin —
 * which is exactly what happened, and it is why ADR-015's measured gain did not
 * survive contact with a real registry until this was fixed.
 */
const ACTION_CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  book: ['marca', 'marcar', 'agenda', 'agendar', 'reserva', 'reservar', 'book', 'schedule', 'reserve', 'arrange'],
  pay: ['paga', 'pagar', 'transfere', 'transferir', 'processa', 'processar', 'encomenda', 'encomendar',
    'pay', 'transfer', 'process', 'purchase', 'buy', 'order'],
  send: ['envia', 'enviar', 'manda', 'mandar', 'liga', 'ligar', 'publica', 'publicar',
    'send', 'email', 'message', 'call', 'publish', 'post'],
  delete: ['apaga', 'apagar', 'elimina', 'eliminar', 'remove', 'remover', 'delete', 'erase'],
  cancel: ['cancela', 'cancelar', 'cancel'],
  edit: ['altera', 'alterar', 'muda', 'mudar', 'edita', 'editar', 'atualiza', 'atualizar',
    'change', 'edit', 'update', 'modify', 'rename'],
  create: ['cria', 'criar', 'adiciona', 'adicionar', 'create', 'add'],
  fill: ['preenche', 'preencher', 'fill', 'submit'],
  negotiate: ['negoceia', 'negocia', 'negociar', 'negotiate'],
  print: ['imprime', 'imprimir', 'print'],
  translate: ['traduz', 'traduzir', 'translate'],
  recommend: ['recomenda', 'recomendar', 'recommend'],
  write: ['escreve', 'escrever', 'write'],
};

/** surface word -> concept. */
const CONCEPT_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(ACTION_CONCEPTS).flatMap(([concept, words]) => words.map((w) => [w, concept] as const)),
);

/**
 * "Marcar como lida", "marcar todos presentes": Portuguese marks things as well as booking them. Before
 * these words, "marca"/"marcar" is marking, and carries no concept (ADR-042: a "Marcar todas como lidas"
 * control said a parent's app books appointments, and dropped the limit that says it does not).
 */
const MARKING_NEXT: ReadonlySet<string> = new Set(['como', 'todos', 'todas', 'tudo']);

/**
 * "Transferir JSON", "transferir o PDF": in Portuguese a file is downloaded with the verb money is moved
 * with. Before a file — straight after the verb or after an article — it is downloading, and carries no
 * concept (ADR-042: a "Transferir JSON" control said a parent's app moves money).
 */
const FILE_WORDS: ReadonlySet<string> = new Set([
  'json', 'csv', 'pdf', 'xlsx', 'excel', 'zip', 'ficheiro', 'ficheiros', 'arquivo', 'arquivos', 'dados',
  'documento', 'documentos', 'relatorio', 'relatorios', 'copia', 'recibo', 'recibos', 'fatura', 'faturas',
]);
const ARTICLES: ReadonlySet<string> = new Set(['o', 'a', 'os', 'as', 'um', 'uma']);

/** The concept `words[i]` carries, in the light of the words after it. */
function conceptAt(words: readonly string[], i: number): string | undefined {
  const word = words[i]!;
  const next = words[i + 1] ?? '';
  if ((word === 'marca' || word === 'marcar') && MARKING_NEXT.has(next)) return undefined;
  if (word === 'transfere' || word === 'transferir') {
    const object = ARTICLES.has(next) ? (words[i + 2] ?? '') : next;
    if (FILE_WORDS.has(object)) return undefined;
  }
  return CONCEPT_OF.get(word);
}

/** First-person instructional framing — asking how, not asking for it to be done. */
const HOW_TO_FRAME = new RegExp(
  [
    '\\b(como (faço|posso|se faz|é que)|how (do|can) i|what should i|o que (faço|devo)|where do i|onde (posso|faço))\\b',
    // Portuguese "como" + infinitive — "como adicionar", "como criar". A general
    // rule of the language, not a pattern fitted to this golden set.
    '\\bcomo\\s+\\p{L}+(ar|er|ir)\\b',
    '\\bhow to\\s+\\p{L}+',
  ].join('|'),
  'iu',
);

/**
 * Is the user asking what something *is*, rather than to be taken to it?
 *
 * Explanations are declared, generated and served verbatim; this knows that a
 * turn *asked* for one. Rather than a second frame detector alongside ADR-015's,
 * it reuses that frame layer, so it lives here, next to `HOW_TO_FRAME`, sharing
 * the same shape and the same discipline.
 *
 * **This changes no routing decision.** The capability still resolves, the route
 * still resolves, and Rule 7 still holds — every screen the assistant can reach
 * stays reachable. All it does is tell a surface which half of the promise to
 * lead with: *take them there* or *tell them what is there*. That is why it can
 * land without recalibration and without moving a single scorecard number.
 *
 * Deliberately narrow. *"Where do I record an injury?"* is **not** here: it asks
 * for a destination and the answer is navigation. Only the frames that ask about
 * a thing's nature or purpose qualify.
 */
const EXPLANATION_FRAME = new RegExp(
  [
    // "what is X", "what does X do/show/mean"
    "\\bwhat (is|are|does|do)\\b",
    "\\bwhat'?s\\b",
    // "o que é", "o que são", "o que faz".
    //
    // The trailing boundary is a lookahead, NOT `\b`. JavaScript's `\b` is
    // ASCII-only, so there is no boundary between the "é" of "o que é" and the
    // space after it, and this alternative silently never matched — which is
    // exactly the bug an earlier `stripGreeting` shipped with ("Olá!"), caught
    // then and re-made here. Every accented alternative below needs the same
    // care.
    '\\bo que\\s+(e|é|sao|são|faz|fazem|significa)(?=\\s|$|[?!.,])',
    // "para que serve" — the single most common phrasing in the golden set
    '\\bpara que serv[ei]',
    // "why would I see", "porque"
    '\\bwhy (would|do|does|is)\\b',
    // Same ASCII-`\b` trap as above: "porquê" ends in a non-ASCII letter.
    '\\bporqu[eê](?=\\s|$|[?!.,])',
    // "tell me about", "explain"
    '\\b(tell me about|explain)\\b',
    '\\bexplica\\b',
  ].join('|'),
  'iu',
);

/**
 * Does this utterance ask what something is, rather than to go there?
 *
 * Model-free, like every other frame here. A false negative costs nothing — the
 * turn navigates and the explanation is served as a caption anyway — so this
 * errs narrow rather than clever.
 */
export function isExplanationRequest(utterance: string): boolean {
  return EXPLANATION_FRAME.test(utterance);
}

/**
 * Does this utterance ask the assistant to perform an action?
 *
 * Word-boundary match on a closed list, minus the instructional frame.
 * Model-free by construction, which is the whole point: ADR-009 exists because a
 * safety property that depends on a model call is not a safety property on a
 * small model: a 1B model was measured emitting the out-of-scope sentinel zero
 * times in 140 calls.
 */
export function isActionRequest(utterance: string): boolean {
  return actionConceptsIn(utterance).length > 0;
}

/**
 * The concepts that START something new — a booking, a record, a form — which the visitor then does on
 * the screen that starts it (ADR-031). Every other concept asks for something that exists to be changed,
 * sent, paid or removed, or for the assistant to do a job itself (ADR-041).
 */
const START_CONCEPTS: ReadonlySet<string> = new Set(['book', 'create', 'fill']);

/** Asking where a thing is done is asking for a place: "where do I change my email", "onde mudo a conta". */
const WHERE_FRAME = /\b(where|onde)\b/iu;

/**
 * A question about how much, when, which or whether — "quanto tenho de pagar este mês?", "há faturas por
 * pagar?" — names a thing to look at, not a job to do (ADR-042: on a real app both were answered as
 * requests to pay). At the start of the sentence only, and with a lookahead rather than `\b`, which is
 * ASCII-only and never ends a match on "há".
 */
const QUESTION_FRAME = /^\s*(?:quant[oa]s?|quando|qual|quais|h[aá]|how (?:much|many)|when|which|is there|are there)(?=\s|$|[?!.,])/iu;

/**
 * Does this utterance ask the assistant to change something that exists, or to do a job for the visitor,
 * rather than to start something new or to find where a thing is done? (Rule 20, ADR-041.)
 *
 * The assistant never acts, so such a request is never followed to a screen as if it were a destination:
 * the visitor is told it cannot be done for them and offered the screen where it is handled. A request to
 * *start* something ("marcar um treino", "add a player") is not one of these: it still moves and opens
 * the form, because the visitor does the task there. Model-free, a closed list, like everything here.
 */
export function isChangeRequest(utterance: string): boolean {
  if (WHERE_FRAME.test(utterance) || HOW_TO_FRAME.test(utterance) || QUESTION_FRAME.test(utterance)) return false;
  const words = utterance.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.some((word, i) => {
    const concept = conceptAt(words, i);
    if (!concept || START_CONCEPTS.has(concept)) return false;
    // "avisos por email", "any new messages", "my orders" name a thing, not a job: a word that is
    // also a noun counts only as a command — first, or after "please", "you" or "to".
    return !NOUN_TOO.has(word) || i === 0 || COMMAND_LEAD.has(words[i - 1]!);
  });
}

/** Action words that are as often the name of a thing. Counted by `isChangeRequest` only as a command. */
const NOUN_TOO: ReadonlySet<string> = new Set([
  'email', 'message', 'call', 'post', 'order', 'change', 'update', 'transfer', 'process', 'print',
]);
const COMMAND_LEAD: ReadonlySet<string> = new Set(['please', 'you', 'to', 'favor']);

/** The action CONCEPTS this utterance carries, or none if it is an instructional frame. */
function actionConceptsIn(utterance: string): string[] {
  if (HOW_TO_FRAME.test(utterance)) return [];
  const out = new Set<string>();
  const words = utterance.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/);
  for (const [i] of words.entries()) {
    const concept = conceptAt(words, i);
    if (concept) out.add(concept);
  }
  return [...out];
}

/**
 * ADR-015's guard: does the verb actually tell us anything about scope *here*?
 *
 * An application that genuinely offers an action must not start refusing it.
 * The registered reference app ships a delete capability; *"apaga isso"* is an action
 * request **and** something the app does. Lowering the boundary bar there would
 * make the assistant refuse its own feature.
 *
 * ## Why `kind` alone is not enough — measured
 *
 * The ADR framed the guard as "the top candidate is not `write`/`destructive`".
 * On a hand-written registry that works. On a **generated** one it is inert: the
 * generator emits `kind: 'navigate'` for every capability, because it derives
 * them from routes and a route has no verb. So the guard never fired, and four
 * of the five in-domain questions it should have protected were about
 * One real app's own *"Delete task"* screen:
 *
 * > *"I need to remove a task from the list."*
 * > *"What is the purpose of the 'Delete task?' screen?"*
 *
 * Those are in-domain by construction — the screen exists — and under a
 * zero-false-refusal constraint five of them are enough to block every margin,
 * which is exactly what happened.
 *
 * The fifth is a different failure and the same fix: *"Where can I find the
 * match schedule?"* flags because `schedule` is on the verb list, where here it
 * is a **noun**. A closed word list cannot tell those apart.
 *
 * ## So the guard asks the registry instead of the taxonomy
 *
 * If the best-ranked capability's own text carries the same verb, the
 * application evidently does that thing — or at least has a screen named for it
 * — and the verb is not evidence of being out of scope. That is true regardless
 * of what `kind` the generator managed to infer, and it disambiguates the noun
 * case for free: a page called *"Match schedule"* contains `schedule`.
 *
 * `kind` is still checked first, because on a hand-written registry it is the
 * more direct statement of the same fact.
 */
export function actionSignalApplies(
  utterance: string,
  topCapabilityKind: string | undefined,
  registryActionVocabulary: ReadonlySet<string> = new Set(),
): boolean {
  if (topCapabilityKind === 'write' || topCapabilityKind === 'destructive') return false;

  const concepts = actionConceptsIn(utterance);
  if (concepts.length === 0) return false;

  // One verb the application also uses is enough to silence the signal.
  // Refusing a real request is the expensive error, so this fails safe.
  return !concepts.some((concept) => registryActionVocabulary.has(concept));
}

/**
 * The action verbs this registry's own capabilities use.
 *
 * Built once at load. A verb here means the application has a screen named for
 * doing that thing, so the verb cannot be evidence that a request is outside the
 * application — whatever retrieval happens to rank first for it.
 */
export function actionVocabularyOf(
  capabilities: readonly {
    readonly title?: string;
    readonly description?: string;
    readonly actions?: readonly string[];
    readonly opens?: readonly string[];
  }[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const cap of capabilities) {
    // ADR-042: a control that does or opens something says what the application does, title or not.
    for (const text of [cap.title ?? '', cap.description ?? '', ...(cap.actions ?? []), ...(cap.opens ?? [])]) {
      for (const concept of conceptsOf(text)) out.add(concept);
    }
  }
  return out;
}

/** The action concepts any of `text`'s words carry — no frame excluded: a control's name is not a question. */
function conceptsOf(text: string): Set<string> {
  const words = normalize(text).split(' ');
  return new Set(words.flatMap((_, i) => conceptAt(words, i) ?? []));
}

/**
 * The control on a screen that a request to do something names (ADR-042) — "cancela o treino de amanhã"
 * names "Cancelar sessão" on the sessions screen — or null when nothing there answers the request.
 *
 * Told where a change is made (Rule 20), the visitor is also told with what. A control is chosen by what it
 * does first (the action concepts above: "envia" is what "Publicar" does), then by the words it shares with
 * the request, then by the words it shares *exactly*, which is how a request asked in English finds the
 * English name of a control the app names in both. Model-free, and silent rather than close: a control
 * named wrongly sends the visitor looking for a button that does something else.
 */
export function controlFor(
  utterance: string,
  capability: { readonly actions?: readonly string[]; readonly opens?: readonly string[] },
): string | null {
  const names = [...(capability.actions ?? []), ...(capability.opens ?? [])];
  if (names.length === 0) return null;
  const asked = conceptsOf(utterance);
  const stems = new Set(tokens(utterance));
  const words = new Set(normalize(utterance).split(' '));
  let best: string | null = null;
  let bestScore = 0;
  for (const name of names) {
    const does = [...conceptsOf(name)].filter((concept) => asked.has(concept)).length;
    const shares = tokens(name).filter((stem) => stems.has(stem)).length;
    const exactly = normalize(name).split(' ').filter((word) => words.has(word)).length;
    const score = does * 2 + shares + exactly / 2;
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}
