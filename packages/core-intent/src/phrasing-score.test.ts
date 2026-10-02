import { describe, expect, it } from 'vitest';
import { capabilityDocument, defineCapability } from '@nextgen/core-capability';

import { actionVocabularyOf } from './action.ts';
import { THRESHOLD_PROFILES } from './config.ts';
import { cosine, HashingEmbedder } from './embedder.ts';
import { stage2 } from './stages.ts';
import type { Registry } from './types.ts';

/**
 * ADR-032. A screen is scored as the average of two things: the question against everything the screen is
 * (its document), and against the one of its own phrasings — its title or an example — closest to the
 * question. The document alone blurs a short, specific question into everything else the screen says.
 */

const capabilities = [
  defineCapability({
    id: 'inbox.notifications', kind: 'navigate', route: '/notifications',
    title: 'Notifications', description: 'Every notification the app sent you, newest first, read and unread, with filters by type and date, and links to what each is about.',
    explanation: 'Your notifications.', examples: ['unread notifications', 'open my notifications', 'what did I miss'],
  }),
  defineCapability({
    id: 'settings.notifications', kind: 'navigate', route: '/settings/notifications',
    title: 'Notification settings', description: 'Choose which notifications you receive and how: email, push or none, per kind of notification.',
    explanation: 'How you are notified.', examples: ['change notification settings', 'stop email notifications', 'notification preferences'],
  }),
];

async function build(): Promise<{ registry: Registry; embedder: HashingEmbedder }> {
  const embedder = new HashingEmbedder();
  const documents = capabilities.map(capabilityDocument);
  embedder.fit(documents);
  const registry: Registry = {
    schemaVersion: 1,
    domainDescription: 'An app.',
    capabilities,
    byId: new Map(capabilities.map((c) => [c.id, c])),
    triggerIndex: new Map(),
    documents,
    vectors: await embedder.embedAll(documents),
    enums: {},
    boundaryIds: new Set(),
    actionVocabulary: actionVocabularyOf(capabilities),
  };
  return { registry, embedder };
}

describe('stage 2 — the whole screen and its nearest phrasing', () => {
  it('scores each screen as the mean of its document and its closest own phrasing', async () => {
    const { registry, embedder } = await build();
    const question = 'any unread notifications?';
    const result = await stage2(question, registry, embedder, THRESHOLD_PROFILES.hashing);
    const q = await embedder.embed(question);
    for (const [i, cap] of capabilities.entries()) {
      const whole = cosine(q, registry.vectors[i]!);
      const phrasings = [cap.title, ...(cap.examples as string[])].map((t) => embedder.embedSparse(t));
      const nearest = Math.max(...phrasings.map((p) => cosine(q, p)));
      const got = result.candidates.find((c) => c.capabilityId === cap.id)!.score;
      expect(got).toBeCloseTo((whole + nearest) / 2, 10);
    }
  });

  it('tells two screens about the same thing apart by what was actually asked', async () => {
    const { registry, embedder } = await build();
    const inbox = await stage2('any unread notifications?', registry, embedder, THRESHOLD_PROFILES.hashing);
    expect(inbox.candidates[0]!.capabilityId).toBe('inbox.notifications');
    const prefs = await stage2('stop the email notifications', registry, embedder, THRESHOLD_PROFILES.hashing);
    expect(prefs.candidates[0]!.capabilityId).toBe('settings.notifications');
  });
});
