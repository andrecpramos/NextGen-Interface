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
  },
];

/**
 * The boundaries worth declaring for this application.
 *
 * Relevance is judged from the routes themselves, so a catalogue entry is never
 * emitted on the strength of a guess about the domain.
 */
export function synthesiseBoundaries(routes: readonly DiscoveredRoute[]): Capability[] {
  const surface = routes.map((route) => `${route.path} ${route.feature ?? ''}`).join(' ');
  return CATALOGUE.filter((entry) => entry.relevantWhen === null || entry.relevantWhen.test(surface)).map(
    (entry) => ({
      id: entry.id,
      kind: 'unsupported',
      route: null,
      title: entry.title,
      description: entry.description,
      refusal: entry.refusal,
      examples: [...entry.examples],
    }),
  );
}
