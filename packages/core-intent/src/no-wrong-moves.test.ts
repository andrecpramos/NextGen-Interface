import { describe, expect, it } from 'vitest';
import { capabilityDocument, defineCapability } from '@nextgen/core-capability';

import { actionVocabularyOf, isChangeRequest } from './action.ts';
import { route } from './cascade.ts';
import { HashingEmbedder } from './embedder.ts';
import { stage2 } from './stages.ts';
import { OUTCOME, type Registry } from './types.ts';
import type { Thresholds } from './config.ts';

/**
 * ADR-041. Two rules about when the router moves a visitor without asking.
 *
 * Rule 19 — with no model, it never moves to a wrong screen: when every word tying the question to the top
 * screen is also the runner-up's, the scores are not evidence for one of them, and it asks. Found on the
 * family fixture, where "tenho avisos por ler" (unread notices) went to notification *settings* because
 * "avisos" is in both screens' words.
 *
 * Rule 20 — the assistant never acts, so a request to change something that exists is never followed to a
 * screen as if it were a destination. It ends with the screen offered. A request to *start* something still
 * moves: the visitor does that task there (ADR-031).
 */

describe('isChangeRequest — change, not start, and not "where"', () => {
  it.each([
    'apaga a ficha médica do meu filho',
    'cancel tomorrow’s session',
    'paga a mensalidade deste mês',
    'change my notification preferences',
    'email the coach about saturday',
    'can you email the coach',
    'order me new boots',
  ])('"%s" asks for a change', (said) => {
    expect(isChangeRequest(said)).toBe(true);
  });

  it.each([
    'quero marcar um treino',
    'add a player to the squad',
    'create a new event',
    'onde mudo a minha conta',
    'where can I cancel my subscription',
    'how do I delete a session',
    'como apagar uma sessão',
    'tenho algum email novo?',
    'desligar os avisos por email',
    'my orders',
    'any new messages',
    'recent changes',
  ])('"%s" does not', (said) => {
    expect(isChangeRequest(said)).toBe(false);
  });
});

const ex = (...phrases: string[]) => phrases;
const capabilities = [
  defineCapability({
    id: 'sessions.list', kind: 'navigate', route: '/sessions',
    title: 'Training sessions', description: 'Every training session scheduled for the team',
    explanation: 'The team’s training sessions, and where a new one is scheduled.',
    examples: ex('open the training sessions', 'show the sessions', 'schedule a training session'),
  }),
  defineCapability({
    id: 'alerts.inbox', kind: 'navigate', route: '/alerts',
    title: 'Alerts', description: 'The alerts the application sends about what happened',
    explanation: 'Every alert the application sent.',
    examples: ex('open my alerts', 'show recent alerts', 'what happened lately'),
  }),
  defineCapability({
    id: 'alerts.settings', kind: 'navigate', route: '/settings/alerts',
    title: 'Alert settings', description: 'Choose which alerts arrive by email',
    explanation: 'Which alerts are sent, and to which email.',
    examples: ex('turn off email alerts', 'change where alerts arrive', 'alerts by email'),
  }),
];

async function build(): Promise<{ registry: Registry; embedder: HashingEmbedder }> {
  const embedder = new HashingEmbedder();
  const documents = capabilities.map(capabilityDocument);
  embedder.fit(documents);
  const vectors = await embedder.embedAll(documents);
  return {
    embedder,
    registry: {
      schemaVersion: 1,
      domainDescription: 'A sports club.',
      capabilities,
      byId: new Map(capabilities.map((c) => [c.id, c])),
      triggerIndex: new Map(),
      documents,
      vectors,
      enums: {},
      boundaryIds: new Set(),
      actionVocabulary: actionVocabularyOf(capabilities),
    },
  };
}

const here = { route: '/', today: '2026-09-25' };

// Accept anything that leads at all, so these tests see the rule and not a threshold.
const eager: Thresholds = { tauHigh: 0, delta: 0, tauFloor: 0, topK: 5, boundaryMargin: 1 };

describe('Rule 19 — no model-free move on words the runner-up shares', () => {
  it('asks when the only word tying the question to the leader is the runner-up’s too', async () => {
    const { registry, embedder } = await build();
    const s = await stage2('alerts', registry, embedder, eager);
    expect(s.top.capabilityId).toMatch(/^alerts\./);
    expect(s.decision).toBe('escalate');
    expect(s.sharedWords).toEqual(['alert']);
  });

  it('moves when a word the visitor said belongs to the leader alone', async () => {
    const { registry, embedder } = await build();
    const s = await stage2('turn off email alerts', registry, embedder, eager);
    expect(s.top.capabilityId).toBe('alerts.settings');
    expect(s.decision).toBe('accept');
    expect(s.sharedWords).toBeUndefined();
  });

  it('says why it did not move, in the turn’s record', async () => {
    const { registry, embedder } = await build();
    const trace = await route('alerts', here, { registry, embedder, thresholds: eager, useStage3: false });
    expect(trace.outcome).toBe(OUTCOME.CLARIFY);
    expect(trace.notes.join(' ')).toMatch(/runner-up too \(Rule 19\)/);
  });
});

describe('Rule 20 — a request to change something is offered its screen, never followed there', () => {
  it('ends out of scope, naming the screen where it is handled', async () => {
    const { registry, embedder } = await build();
    const trace = await route('cancel the training session', here, { registry, embedder, thresholds: eager, useStage3: false });
    expect(trace.changeRequest).toBe(true);
    expect(trace.outcome).toBe(OUTCOME.OUT_OF_SCOPE);
    expect(trace.capabilityId).toBe('sessions.list');
    expect(trace.notes.join(' ')).toMatch(/offered, not opened \(Rule 20\)/);
  });

  it('still moves a request to start something: the visitor does it there', async () => {
    const { registry, embedder } = await build();
    const trace = await route('schedule a training session', here, { registry, embedder, thresholds: eager, useStage3: false });
    expect(trace.changeRequest).toBe(false);
    expect(trace.outcome).toBe(OUTCOME.EXECUTE);
    expect(trace.capabilityId).toBe('sessions.list');
  });
});
