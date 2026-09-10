/**
 * Is this a request to *do* something the application does not do?
 *
 * [ADR-015](../../../.claude/decisions/ADR-015.md), accepted 2026-09-10, amending
 * ADR-009. The declared-boundary mechanism is sound; its only input was topic
 * similarity, and **what makes "book my son a hospital appointment" out-of-scope
 * is its verb, not its subject.** A medical page and a request to book a medical
 * appointment are about the same thing, so cosine ranks them together — WP-39
 * built section-scoped boundaries to fix that, raised the boundary's score, and
 * moved detection by exactly nothing.
 *
 * WP-38 then produced the strongest evidence for this ADR from the other
 * direction: improving *topical* retrieval made refusal measurably **worse**
 * (out-of-scope 32.4% → 26.5%), because ranking real capabilities higher offers
 * the model more plausible wrong answers. Topic is not the signal.
 *
 * ## Measured before it was proposed
 *
 * `eval/fut-app/experiment-action-verbs.mjs`, `nomic-embed-text`, held-out split:
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
 * The verb lists are Portuguese and English, because that is what the pilot
 * application ships. **This is per-adopter vocabulary in engine code**, which is
 * the wrong home for it long-term — a Spanish adopter gets no signal at all and
 * silently falls back to the topic-only behaviour, which is the pre-ADR-015
 * state rather than a failure. ADR-015 records this as accepted for now and owed
 * a move into the generated registry.
 */

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
 * WP-40 measured why. The guard below asks whether the application itself does
 * the thing being requested, and `fut-app` documents itself in Portuguese while
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
 * Does this utterance ask the assistant to perform an action?
 *
 * Word-boundary match on a closed list, minus the instructional frame.
 * Model-free by construction, which is the whole point: ADR-009 exists because a
 * safety property that depends on a model call is not a safety property on a
 * small model, and FINDINGS Finding 7 measured a 1B model emitting the
 * out-of-scope sentinel zero times in 140 calls.
 */
export function isActionRequest(utterance: string): boolean {
  return actionConceptsIn(utterance).length > 0;
}

/** The action CONCEPTS this utterance carries, or none if it is an instructional frame. */
function actionConceptsIn(utterance: string): string[] {
  if (HOW_TO_FRAME.test(utterance)) return [];
  const out = new Set<string>();
  for (const word of utterance.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
    const concept = CONCEPT_OF.get(word);
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
 * ## Why `kind` alone is not enough — measured, WP-40
 *
 * The ADR framed the guard as "the top candidate is not `write`/`destructive`".
 * On a hand-written registry that works. On a **generated** one it is inert: the
 * generator emits `kind: 'navigate'` for every capability, because it derives
 * them from routes and a route has no verb. So the guard never fired, and four
 * of the five in-domain questions it should have protected were about
 * `fut-app`'s own *"Delete task"* screen:
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
  capabilities: readonly { readonly title?: string; readonly description?: string }[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const cap of capabilities) {
    const words = `${cap.title ?? ''} ${cap.description ?? ''}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/);
    for (const word of words) { const concept = CONCEPT_OF.get(word); if (concept) out.add(concept); }
  }
  return out;
}
