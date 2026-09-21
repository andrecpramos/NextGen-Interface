import { describe, expect, it } from 'vitest';
import { capabilityDocument, defineBoundary, defineCapability } from '@nextgen/core-capability';

import { actionVocabularyOf } from './action.ts';
import { THRESHOLD_PROFILES } from './config.ts';
import { HashingEmbedder } from './embedder.ts';
import { stage2 } from './stages.ts';
import type { Registry } from './types.ts';

/**
 * A limit must be evidence, not merely the best of a poor lot.
 *
 * The router refuses when a declared limit *leads* the best real screen by a margin. On an app it has
 * not been calibrated for, and which it can describe only by its own labels, every real screen scores ~0
 * for an everyday question — and a limit that shares a single word with it (0.07–0.16) then leads by
 * enough and wins. Found on a real one-page site: 7 of 12 ordinary questions were refused ("how do I
 * sign up" as "changing records"), while genuine out-of-scope requests scored 0.19–0.32.
 *
 * `boundaryFloor` is the second half of the rule: the limit's own score must clear it. It is absent from
 * every calibrated profile — a sweep decides those — and set only on a bundle built with no calibration
 * at all, where refusal is the one claim nothing has measured.
 */

const ex = (...phrases: string[]) => phrases;

const capabilities = [
  defineCapability({
    id: 'timetable.view', kind: 'navigate', route: '/timetable',
    title: 'Class timetable', description: 'The weekly timetable of classes at the gym',
    explanation: 'The timetable of classes for every day of the week.',
    triggers: ['timetable'], examples: ex('open the timetable', 'show the classes', 'when are the classes'),
  }),
  defineBoundary({
    id: 'unsupported.other_applications', title: 'Questions about anything else',
    description: 'General knowledge, other software, or any subject this application does not cover.',
    examples: ex("what's the weather tomorrow", 'write me a poem about summer', 'what is the capital of france'),
    refusal: 'I only know this application.',
  }),
  defineBoundary({
    id: 'unsupported.external_actions', title: 'Acting outside this application',
    description: 'Booking an appointment, sending an email or a message on the visitor’s behalf.',
    examples: ex('book an appointment for me', 'send an email to the trainer', 'schedule a visit for me'),
    refusal: 'I cannot act for you.',
  }),
];

async function build(): Promise<{ registry: Registry; embedder: HashingEmbedder }> {
  const embedder = new HashingEmbedder();
  const documents = capabilities.map(capabilityDocument);
  embedder.fit(documents);
  const vectors = await embedder.embedAll(documents);
  const registry: Registry = {
    schemaVersion: 1,
    domainDescription: 'A gym.',
    capabilities,
    byId: new Map(capabilities.map((c) => [c.id, c])),
    triggerIndex: new Map(),
    documents,
    vectors,
    enums: {},
    boundaryIds: new Set(capabilities.filter((c) => c.kind === 'unsupported').map((c) => c.id)),
    actionVocabulary: actionVocabularyOf(capabilities.filter((c) => c.kind !== 'unsupported')),
  };
  return { registry, embedder };
}

const base = THRESHOLD_PROFILES.hashing;
const boundaryScore = (s: Awaited<ReturnType<typeof stage2>>, registry: Registry): number =>
  s.all.filter((c) => registry.boundaryIds.has(c.capabilityId))[0]!.score;

describe('stage 2 — a declared limit has to clear an absolute floor to refuse', () => {
  // Shares one word ("software") with a limit and nothing with any screen: the case that was refused.
  const everyday = 'does this work with my software';

  it('refuses on a weak overlap when there is no floor, exactly as it always has', async () => {
    const { registry, embedder } = await build();
    const s = await stage2(everyday, registry, embedder, base);
    expect(s.decision).toBe('refuse');
    expect(boundaryScore(s, registry)).toBeGreaterThan(0);
  });

  it('asks instead of refusing when the limit scores below the floor', async () => {
    const { registry, embedder } = await build();
    const score = boundaryScore(await stage2(everyday, registry, embedder, base), registry);
    const s = await stage2(everyday, registry, embedder, { ...base, boundaryFloor: score + 0.01 });
    expect(s.decision).not.toBe('refuse');
    expect(s.decision).toBe('escalate');
  });

  it('still refuses when the limit clears the floor: the floor is a bar, not a switch', async () => {
    const { registry, embedder } = await build();
    const score = boundaryScore(await stage2(everyday, registry, embedder, base), registry);
    expect((await stage2(everyday, registry, embedder, { ...base, boundaryFloor: score })).decision).toBe('refuse');
    expect((await stage2(everyday, registry, embedder, { ...base, boundaryFloor: score - 0.01 })).decision).toBe('refuse');
  });

  it('keeps refusing what is plainly out of scope at a floor of 0.15', async () => {
    const { registry, embedder } = await build();
    for (const said of ["what's the weather tomorrow", 'write me a poem about summer', 'what is the capital of france']) {
      const s = await stage2(said, registry, embedder, { ...base, boundaryFloor: 0.15 });
      expect(s.decision, said).toBe('refuse');
    }
  });

  it('leaves a request that asks the assistant to act to the verb evidence, which is independent of topic (ADR-015)', async () => {
    const { registry, embedder } = await build();
    const said = 'send an email to the trainer';
    const s = await stage2(said, registry, embedder, { ...base, boundaryFloor: 1 });
    expect(s.decision).toBe('refuse');
  });

  it('is off when absent or zero, so every calibrated profile behaves as it was calibrated', async () => {
    const { registry, embedder } = await build();
    const off = await stage2(everyday, registry, embedder, base);
    expect((await stage2(everyday, registry, embedder, { ...base, boundaryFloor: 0 })).decision).toBe(off.decision);
    expect('boundaryFloor' in THRESHOLD_PROFILES.hashing).toBe(false);
    expect('boundaryFloor' in THRESHOLD_PROFILES.ollama).toBe(false);
  });
});
