import type { Capability } from '@nextgen/core-capability';

import type { DiscoveredRoute } from './types.ts';

/**
 * What the application deliberately does not do (Rule 13, ADR-009).
 *
 * These are the entries that make refusal work **without a model call** — the
 * single most important mechanism in the product (ADR-009: declared
 * boundaries improved refusal accuracy in proportion to how badly the model
 * failed, 0% → 40% on a model that never refused anything on its own).
 *
 * They cannot be discovered by reading routes, because they describe the
 * absence of routes. So they come from a catalogue of what an assistant over a
 * *navigation* registry categorically cannot do, and each entry is emitted only
 * when it is a plausible thing to ask this particular application — a payments
 * refusal in an app with no money anywhere would be noise in the stage-2 corpus
 * rather than a boundary.
 *
 * Every boundary is offered to every role. Rule 17 keeps unreachable
 * capabilities out of a registry; a refusal is the opposite of a capability and
 * discloses nothing about the surface behind it.
 */

interface CatalogueEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly refusal: string;
  readonly examples: readonly string[];
  /**
   * Emit only when the application looks like it has this subject at all.
   * `null` means always — those are true of any navigation assistant.
   */
  readonly relevantWhen: RegExp | null;
  /**
   * Never emit when the application has a control that does one of these (ADR-042) — the action concepts
   * of `core-intent`'s `actionVocabularyOf`. A limit that says the app cannot send a message, on an app
   * with a "Publicar" button, tells the visitor something false and wins over the screen that does it.
   */
  readonly unlessTheAppDoes?: readonly string[];
  /**
   * `'action'` when the entry is about the assistant *doing* something, and so refuses only a request to
   * act (ADR-025). Its examples share their topics with real screens — an appointment, a son, an email —
   * and refusing on topic alone refused "my kid's appointments" as if it were "book an appointment for my son".
   */
  readonly refuses?: 'action';
  /**
   * The same limit in another language, by two-letter code, for an application whose primary language
   * it is. A Portuguese app used to declare "Processing a payment" and refuse in English to visitors who
   * had asked in Portuguese. The examples stay bilingual either way.
   */
  readonly localized?: Readonly<Record<string, { readonly title: string; readonly description: string; readonly refusal: string }>>;
}

const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'unsupported.external_actions',
    title: 'Acting outside this application',
    description:
      'Booking an appointment, sending an email or a message, or doing something in another system on the user’s behalf. This assistant works inside this application only.',
    refusal:
      'I can take you anywhere in this application and explain what you find there, but I can’t book appointments, send messages or act in another system for you.',
    examples: [
      'book an appointment for my son',
      'send an email to the manager about this',
      'schedule a visit for next week',
      'marca uma consulta para o meu filho',
      'envia um email ao responsável',
    ],
    relevantWhen: null,
    unlessTheAppDoes: ['send', 'book'],
    refuses: 'action',
    localized: {
      pt: {
        title: 'Agir fora desta aplicação',
        description:
          'Marcar uma consulta, enviar um email ou uma mensagem, ou fazer algo noutro sistema em nome do utilizador. Este assistente trabalha apenas dentro desta aplicação.',
        refusal:
          'Posso levá-lo a qualquer ecrã desta aplicação e explicar o que lá encontra, mas não marco consultas, não envio mensagens nem ajo noutro sistema por si.',
      },
    },
  },
  // "Changing records for you" was here until ADR-042. That the assistant never changes a record is held
  // by code — a request to change something is offered its screen and never followed there (Rule 20) — so
  // a limit saying so could only ever win over that screen, and tell a coach the app cannot cancel a
  // session it has a "Cancelar sessão" button for.
  {
    id: 'unsupported.payments',
    title: 'Processing a payment',
    description:
      'Paying an invoice, a fee or a salary. The application records and shows financial documents; moving real money is a banking process outside it.',
    refusal:
      'I can take you to the invoices, payments and billing screens, but I can’t process a payment for you.',
    examples: [
      'pay this invoice for me',
      'process my membership fee',
      'transfer the money for this',
      'paga esta fatura por mim',
      'processa a minha quota',
    ],
    relevantWhen: /finance|billing|invoice|payment|payroll|fee|quota|fatura/i,
    unlessTheAppDoes: ['pay'],
    refuses: 'action',
    localized: {
      pt: {
        title: 'Processar um pagamento',
        description:
          'Pagar uma fatura, uma quota ou um salário. A aplicação regista e mostra documentos financeiros; movimentar dinheiro é um processo bancário fora dela.',
        refusal: 'Posso levá-lo aos ecrãs de faturas, pagamentos e cobranças, mas não processo pagamentos por si.',
      },
    },
  },
  {
    id: 'unsupported.other_applications',
    title: 'Questions about anything else',
    description:
      'General knowledge, other software, or any subject this application does not cover. The assistant answers about this application and nothing else.',
    refusal:
      'I only know this application — I can’t help with things outside it.',
    examples: [
      'what’s the weather tomorrow',
      'write me a poem',
      'what’s in my email inbox',
      'como está o tempo amanhã',
      'escreve-me um poema',
    ],
    relevantWhen: null,
    localized: {
      pt: {
        title: 'Perguntas sobre outros assuntos',
        description:
          'Cultura geral, outras aplicações, ou qualquer assunto que esta aplicação não cobre. O assistente responde sobre esta aplicação e mais nada.',
        refusal: 'Só conheço esta aplicação — não consigo ajudar com assuntos fora dela.',
      },
    },
  },
];

/**
 * The boundaries worth declaring for this application.
 *
 * Relevance is judged from the routes themselves, so a catalogue entry is never
 * emitted on the strength of a guess about the domain — and `does`, the action concepts the
 * application's own screens and controls name (ADR-042), keeps out every entry the app contradicts.
 */
export function synthesiseBoundaries(
  routes: readonly DiscoveredRoute[],
  language = 'en',
  others: readonly string[] = [],
  does: ReadonlySet<string> = new Set(),
): Capability[] {
  const surface = routes.map((route) => `${route.path} ${route.feature ?? ''}`).join(' ');
  const code = language.toLowerCase().slice(0, 2);
  const emitted = CATALOGUE.filter(
    (entry) =>
      (entry.relevantWhen === null || entry.relevantWhen.test(surface)) &&
      !(entry.unlessTheAppDoes ?? []).some((concept) => does.has(concept)),
  );
  return emitted.map((entry) => {
    // In the app's own language where the catalogue has it; English otherwise.
    const said = entry.localized?.[code] ?? entry;
    // And in the app's other languages, for a visitor reading one of them (ADR-030).
    const translations: Record<string, { title: string; refusal: string }> = {};
    for (const other of others) {
      const in_ = entry.localized?.[other.toLowerCase().slice(0, 2)] ?? entry;
      if (in_ !== said) translations[other] = { title: in_.title, refusal: in_.refusal };
    }
    return {
      id: entry.id,
      kind: 'unsupported',
      route: null,
      title: said.title,
      description: said.description,
      refusal: said.refusal,
      examples: [...entry.examples],
      ...(entry.refuses ? { refuses: entry.refuses } : {}),
      ...(Object.keys(translations).length > 0 ? { translations } : {}),
    };
  });
}
