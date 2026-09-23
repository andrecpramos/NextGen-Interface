import type { Capability } from '@nextgen/core-capability';

import type { DiscoveredRoute } from './types.ts';

/**
 * What the application deliberately does not do (Rule 13, ADR-009).
 *
 * These are the entries that make refusal work **without a model call** — the
 * single most important mechanism in the product (PLAN.md §1.2: declared
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
   * `'action'` when the entry is about the assistant *doing* something, and so refuses only a request to
   * act (ADR-025). Its examples share their topics with real screens — an injury, a son, an email — and
   * refusing on topic alone refused "injury info for my kid" as if it were "book a physio for my son".
   */
  readonly refuses?: 'action';
  /**
   * The same limit in another language, by two-letter code, for an application whose primary language
   * it is. A Portuguese app used to declare "Processing a payment" and refuse in English to visitors who
   * had asked in Portuguese (Pilot-A field report, 2026-09-23, P3-1). The examples stay bilingual either way.
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
      'book a physio appointment for my son',
      'send an email to the coach about this',
      'schedule a doctor’s visit for this injury',
      'marca uma consulta para o meu filho',
      'envia um email ao treinador',
    ],
    relevantWhen: null,
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
  {
    id: 'unsupported.data_changes',
    title: 'Changing records for you',
    description:
      'Creating, editing or deleting a record. This assistant takes the user to the screen where they can do it themselves; it never fills a form or saves a change on their behalf.',
    refusal:
      'I can take you to the right screen and tell you what to do there, but I don’t create, change or delete records myself.',
    examples: [
      'delete this record for me',
      'change the date on this for me',
      'fill in this form for me',
      'apaga este registo por mim',
      'altera a data disto por mim',
    ],
    relevantWhen: null,
    refuses: 'action',
    localized: {
      pt: {
        title: 'Alterar registos por si',
        description:
          'Criar, editar ou apagar um registo. Este assistente leva o utilizador ao ecrã onde o pode fazer; nunca preenche um formulário nem grava uma alteração em seu nome.',
        refusal: 'Posso levá-lo ao ecrã certo e dizer-lhe o que fazer lá, mas não crio, altero nem apago registos por conta própria.',
      },
    },
  },
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
 * emitted on the strength of a guess about the domain.
 */
export function synthesiseBoundaries(routes: readonly DiscoveredRoute[], language = 'en', others: readonly string[] = []): Capability[] {
  const surface = routes.map((route) => `${route.path} ${route.feature ?? ''}`).join(' ');
  const code = language.toLowerCase().slice(0, 2);
  return CATALOGUE.filter((entry) => entry.relevantWhen === null || entry.relevantWhen.test(surface)).map((entry) => {
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
