import { describe, expect, it } from 'vitest';
import { capabilityDocument, defineCapability } from '@nextgen/core-capability';
import type { CompletionRequest, CompletionResult, LlmRuntime } from '@nextgen/core-inference';

import { actionVocabularyOf } from './action.ts';
import { route } from './cascade.ts';
import { HashingEmbedder } from './embedder.ts';
import { isMashing } from './mashing.ts';
import { OUTCOME, STAGE, type Registry } from './types.ts';

/**
 * ADR-039. Keyboard mashing is recognised from the app's own letter pairs, before stage 1, and never
 * reaches a model. Measured on every committed registry (the family fixture's three roles, the reference
 * fixture): 0 false positives over every golden question, every registry phrase and a few names and
 * foreign sentences; 10 of 12 mashed strings caught.
 */

const ex = (...phrases: string[]) => phrases;
const capabilities = [
  defineCapability({
    id: 'calendar.overview', kind: 'navigate', route: '/calendar', title: 'Calendário',
    description: 'Os treinos e os jogos da equipa, dia a dia, com a hora e o local de cada um',
    explanation: 'Os treinos e os jogos, dia a dia.',
    examples: ex('quando é o próximo treino', 'abre o calendário', 'que jogos temos este mês', 'when is the next training session', 'show me the calendar'),
  }),
  defineCapability({
    id: 'squad.overview', kind: 'navigate', route: '/squad', title: 'Plantel',
    description: 'Os jogadores da equipa, com a posição, a idade e o estado de cada um',
    explanation: 'Os jogadores da equipa.',
    examples: ex('ver os jogadores', 'quem está no plantel', 'lista da equipa', 'show my players', 'who is on the team'),
  }),
  defineCapability({
    id: 'notifications.inbox', kind: 'navigate', route: '/notifications', title: 'Notificações',
    description: 'Os avisos que a aplicação envia sobre o que aconteceu de novo na equipa',
    explanation: 'Os avisos da aplicação.',
    examples: ex('tenho avisos novos', 'ver as notificações', 'o que aconteceu de novo', 'any new notifications', 'open my alerts'),
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
      domainDescription: 'Uma aplicação de um clube de futebol: treinos, jogos, jogadores e avisos.',
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

class CountingRuntime implements LlmRuntime {
  readonly name = 'counting';
  calls = 0;
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async complete<T>(_request: CompletionRequest): Promise<CompletionResult<T>> {
    this.calls++;
    return { value: null, latencyMs: 0, parseFailed: true };
  }
}

describe('isMashing', () => {
  it.each(['asdkj qwpeo zxmn', 'asdasdasd', 'xcvbnm asdf', 'jkjkjkjk'])('"%s" is mashing', async (said) => {
    const { registry } = await build();
    expect(isMashing(said, registry)).toBe(true);
  });

  it.each([
    'quando é o próximo treino?',
    'who is injured on the team',
    'tenho avisos por ler',
    'Kvaratskhelia',
    'ok',
    'sim',
    'hi',
    'jogo 12345',
    'wie spät ist es',
  ])('"%s" is not', async (said) => {
    const { registry } = await build();
    expect(isMashing(said, registry)).toBe(false);
  });
});

describe('the cascade — mashing ends the turn before any stage, and before any model', () => {
  it('clarifies at once, with nothing to offer as a match and no model call', async () => {
    const { registry, embedder } = await build();
    const runtime = new CountingRuntime();
    const trace = await route('asdkj qwpeo zxmn', { route: '/', today: '2026-09-25' }, { registry, embedder, runtime, useStage3: true });
    expect(trace.mashing).toBe(true);
    expect(trace.outcome).toBe(OUTCOME.CLARIFY);
    expect(trace.decidedAt).toBe(STAGE.DETERMINISTIC);
    expect(trace.candidates).toEqual([]);
    expect(runtime.calls).toBe(0);
  });

  it('routes a real question as it always has', async () => {
    const { registry, embedder } = await build();
    const trace = await route('abre o calendário', { route: '/', today: '2026-09-25' }, { registry, embedder, useStage3: false });
    expect(trace.mashing).toBe(false);
    expect(trace.candidates[0]?.capabilityId).toBe('calendar.overview');
  });
});
