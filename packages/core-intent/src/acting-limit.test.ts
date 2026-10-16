import { describe, expect, it } from 'vitest';
import { capabilityDocument, defineBoundary, defineCapability, type Capability } from '@nextgen/core-capability';

import { actionVocabularyOf } from './action.ts';
import { THRESHOLD_PROFILES } from './config.ts';
import { HashingEmbedder } from './embedder.ts';
import { stage2 } from './stages.ts';
import type { Registry } from './types.ts';

/**
 * ADR-025: a limit about the assistant *acting* refuses only a request to act.
 *
 * The generator's catalogue declares "Acting outside this application" with examples like "schedule a
 * doctor's visit for this injury" and "book a physio appointment for my son". Those share their topic
 * with a real screen — the child's medical status — and on topic alone they refused "injury info for my
 * kid" (found in a probe of everyday questions, 2026-09-22). What makes a request one of those is the
 * verb, which the engine already reads (ADR-015); what the adopter declares as a subject the app does not
 * cover ("payments") is still refused on topic.
 */

const capabilities: Capability[] = [
  defineCapability({
    id: 'guardian.medical', kind: 'navigate', route: '/my/children/medical',
    title: 'Medical status', description: 'Whether my child is fit to play, and how an injury is healing',
    explanation: 'Where a guardian sees a child’s medical status: fit to play, and how an injury is healing.',
    examples: ['medical status of my son', 'is my kid injured', 'how is the injury healing'],
  }),
  {
    ...defineBoundary({
      id: 'unsupported.external_actions', title: 'Acting outside this application',
      description: 'Booking an appointment or sending a message on the visitor’s behalf.',
      examples: ['book a physio appointment for my son', 'schedule a doctor’s visit for this injury', 'send an email to the coach'],
      refusal: 'I cannot act for you.',
    }),
    refuses: 'action',
  },
  defineBoundary({
    id: 'unsupported.declared.fees', title: 'Fees',
    description: 'Membership fees and invoices are handled by the office.',
    examples: ['how much do I owe', 'my son’s fees this month', 'when is the invoice due'],
    refusal: 'Fees are handled by the office.',
  }),
];

async function build(caps: Capability[] = capabilities): Promise<{ registry: Registry; embedder: HashingEmbedder }> {
  const embedder = new HashingEmbedder();
  const documents = caps.map(capabilityDocument);
  embedder.fit(documents);
  const vectors = await embedder.embedAll(documents);
  const registry: Registry = {
    schemaVersion: 1,
    domainDescription: 'A club.',
    capabilities: caps,
    byId: new Map(caps.map((c) => [c.id, c])),
    triggerIndex: new Map(),
    documents,
    vectors,
    enums: {},
    boundaryIds: new Set(caps.filter((c) => c.kind === 'unsupported').map((c) => c.id)),
    actionVocabulary: actionVocabularyOf(caps.filter((c) => c.kind !== 'unsupported')),
  };
  return { registry, embedder };
}

const base = THRESHOLD_PROFILES.hashing;
// Close to the limit's examples in topic, with no verb in it asking the assistant to act.
const about = 'appointment for this injury';

describe('stage 2 — an acting limit refuses only a request to act (ADR-025)', () => {
  it('refuses on topic alone when it is not marked — as every limit did before', async () => {
    const plain = capabilities.map((c): Capability => {
      const { refuses: _, ...rest } = c;
      return rest;
    });
    const { registry, embedder } = await build(plain);
    const s = await stage2(about, registry, embedder, base);
    expect(s.decision).toBe('refuse');
    expect(s.boundaryId).toBe('unsupported.external_actions');
  });

  // The trade, stated rather than hidden (ADR-025, Consequences): with no verb, the router cannot tell
  // "injury info for my kid" (a real question) from "appointment for this injury" (a request the app
  // cannot meet). Marked, both are asked about rather than refused — the cheaper of the two errors, and
  // the one this product already prefers. The verb-less out-of-scope request is the cost.
  it('once marked, asks rather than refuses a question with no request to act in it', async () => {
    const { registry, embedder } = await build();
    const s = await stage2(about, registry, embedder, base);
    expect(s.decision).not.toBe('refuse');
    expect(s.candidates[0]!.capabilityId).toBe('guardian.medical');
  });

  it('still refuses a request to act', async () => {
    const { registry, embedder } = await build();
    for (const said of ['book a physio appointment for my son', 'send an email to the coach']) {
      const s = await stage2(said, registry, embedder, base);
      expect(s.decision, said).toBe('refuse');
      expect(s.boundaryId, said).toBe('unsupported.external_actions');
    }
  });

  it('leaves a limit about a subject refusing on topic, act or not', async () => {
    const { registry, embedder } = await build();
    const s = await stage2('how much do I owe for my son’s fees', registry, embedder, base);
    expect(s.decision).toBe('refuse');
    expect(s.boundaryId).toBe('unsupported.declared.fees');
  });
});

/**
 * Rule 19's reading, for a refusal (ADR-042). "apaga a ficha médica do meu filho" was refused as "fees are
 * handled by the office", by 0.004, on the words "meu filho" — which the child's medical screen declares
 * too. Words both declare are not evidence for either; a limit refuses only on a word that is its own.
 */
describe('stage 2 — a limit does not refuse on words the best screen shares', () => {
  const caps: Capability[] = [
    defineCapability({
      id: 'guardian.medical', kind: 'navigate', route: '/my/children/medical',
      title: 'Estado médico', description: 'Se o meu filho pode jogar.',
      explanation: 'O estado médico do educando.',
      examples: ['estado médico do meu filho', 'o meu filho está lesionado', 'ficha médica'],
    }),
    defineBoundary({
      id: 'unsupported.declared.fees', title: 'Quotas',
      description: 'As quotas do meu filho são tratadas na secretaria.',
      examples: ['quota do meu filho', 'fatura do meu filho', 'quanto devo pelo meu filho'],
      refusal: 'As quotas são tratadas na secretaria.',
    }),
  ];
  const leadsOnSharedWords = { ...base, boundaryMargin: 0, actionBoundaryMargin: 0 };

  it('does not refuse when every word tying the request to the limit is the screen’s too', async () => {
    const { registry, embedder } = await build(caps);
    const s = await stage2('apaga tudo do meu filho', registry, embedder, leadsOnSharedWords);
    expect(s.all[0]!.capabilityId).toBe('unsupported.declared.fees');
    expect(s.decision).not.toBe('refuse');
  });

  it('still refuses on a word that is the limit’s own', async () => {
    const { registry, embedder } = await build(caps);
    const s = await stage2('a quota do meu filho', registry, embedder, leadsOnSharedWords);
    expect(s.decision).toBe('refuse');
    expect(s.boundaryId).toBe('unsupported.declared.fees');
  });
});
