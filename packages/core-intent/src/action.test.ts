import { describe, expect, it } from 'vitest';

import {
  isActionRequest,
  isExplanationRequest,
  actionSignalApplies,
  actionVocabularyOf,
  controlFor,
} from './action.ts';

/**
 * ADR-042. Told where a change is made, the visitor is also told with what: the control on that screen
 * the request names — by what it does ("cancela" is "Cancelar sessão") or by what it is about. Model-free,
 * and silent when nothing on the screen answers the request: a wrong control is worse than none.
 */
describe('controlFor — the control a request to do something names', () => {
  const sessions = { actions: ['Cancelar sessão', 'Cancel session', 'Concluir sessão'], opens: ['Nova sessão'] };

  it('finds it by what it does, in the language it was asked in', () => {
    expect(controlFor('cancela o treino de amanhã', sessions)).toBe('Cancelar sessão');
    expect(controlFor('please cancel tomorrow’s training', sessions)).toBe('Cancel session');
  });

  it('prefers what it does over what it shares a word with', () => {
    const notes = { actions: ['Exportar CSV', 'Editar', 'Eliminar'], opens: ['Nova nota'] };
    expect(controlFor('apaga a nota que escrevi sobre o João', notes)).toBe('Eliminar');
  });

  it('knows that publishing is how a message is sent', () => {
    expect(controlFor('envia um email aos pais dos sub-15', { actions: ['Publicar'], opens: ['Nova campanha'] })).toBe('Publicar');
  });

  it('names nothing when nothing on the screen answers the request', () => {
    expect(controlFor('o que é isto', sessions)).toBeNull();
    expect(controlFor('cancela o treino', {})).toBeNull();
    expect(controlFor('muda o capitão', { actions: ['Exportar CSV'] })).toBeNull();
  });
});

/**
 * ADR-015's action signal, and the guard that decides when it means anything.
 *
 * The signal is easy to get right and easy to get subtly wrong: every case below
 * was measured against a real application's golden set, not invented to make
 * the implementation look good.
 */

describe('isActionRequest — what the assistant is being asked to do', () => {
  it.each([
    'marca uma consulta no hospital para o meu filho',
    'paga a minha quota de sócio',
    'reserva-me um voo para o jogo fora',
    'book my son a hospital appointment',
    'send an email to the coach',
  ])('flags a request to act: %s', (u) => {
    expect(isActionRequest(u)).toBe(true);
  });

  /**
   * Navigation is imperative too. If imperativeness were the discriminator, the
   * product's own core use case would be flagged as out of scope.
   */
  it.each([
    'abre o calendário',
    'mostra-me as lesões',
    'take me to the squad list',
    'where can I find the training plan',
  ])('does not flag a navigation request: %s', (u) => {
    expect(isActionRequest(u)).toBe(false);
  });

  /**
   * A first-person instructional frame asks how to do it, which is exactly what
   * this product answers. Removing this frame cut in-domain false flags from
   * 11.4% to 2.8%.
   */
  it.each([
    'Como criar uma nova época?',
    'How do I create a season?',
    'how to add a player',
    'What should I do if a registration does not update?',
  ])('does not flag an instructional frame: %s', (u) => {
    expect(isActionRequest(u)).toBe(false);
  });

  /**
   * The exclusion has its own exclusion. Second person asks for service, and
   * that is still a request to act however politely it is phrased.
   */
  it.each(['podes marcar uma consulta?', 'can you book me a flight?'])(
    'still flags a second-person request: %s',
    (u) => {
      expect(isActionRequest(u)).toBe(true);
    },
  );
});

describe('actionSignalApplies — the guard', () => {
  const vocabularyOfAppThatDeletes = actionVocabularyOf([
    { title: 'Tarefas', description: 'Um director da academia pode eliminar uma tarefa de um atleta.' },
  ]);

  it('is silent when the top candidate is itself a write or destructive capability', () => {
    expect(actionSignalApplies('apaga esse módulo', 'destructive', new Set())).toBe(false);
    expect(actionSignalApplies('cria uma nota', 'write', new Set())).toBe(false);
  });

  /**
   * The measured one. On a generated registry every capability is `navigate`,
   * because the generator derives capabilities from routes and a route has no
   * verb — so the `kind` check alone is inert and the vocabulary carries the
   * guard entirely.
   */
  it('is silent when the application itself does the thing, even if every kind is navigate', () => {
    expect(actionSignalApplies('I want to delete a task', 'navigate', vocabularyOfAppThatDeletes)).toBe(false);
  });

  /**
   * Cross-language, and this is the whole reason verbs are grouped by concept.
   * The app documents itself in Portuguese ("eliminar"); the user asks in
   * English ("delete"). With flat per-language lists these never meet, four
   * in-domain questions stayed flagged, and under a zero-false-refusal
   * constraint that was enough to block every margin.
   */
  it('matches the concept across languages, not the surface word', () => {
    expect(actionSignalApplies('remove a task from the list', 'navigate', vocabularyOfAppThatDeletes)).toBe(false);
    expect(actionSignalApplies('apaga uma tarefa', 'navigate', vocabularyOfAppThatDeletes)).toBe(false);
  });

  it('still fires for an action the application does NOT offer', () => {
    // Nothing in that vocabulary is about booking.
    expect(actionSignalApplies('marca uma consulta no hospital', 'navigate', vocabularyOfAppThatDeletes)).toBe(true);
  });

  it('is silent for anything with no action verb at all', () => {
    expect(actionSignalApplies('onde vejo as lesões', 'navigate', new Set())).toBe(false);
  });
});

describe('actionVocabularyOf — what the application says it does', () => {
  it('collects concepts, not words', () => {
    const v = actionVocabularyOf([{ title: 'Pagamentos', description: 'O utilizador pode pagar uma quota.' }]);
    expect(v.has('pay')).toBe(true);
  });

  it('is empty for an application that only shows things', () => {
    const v = actionVocabularyOf([{ title: 'Calendário', description: 'Ver o calendário de treinos.' }]);
    expect(v.size).toBe(0);
  });

  // "Marcar como lida", "Marcar todos presentes": marking something, not booking it — on a control or in a request.
  it('never takes "marcar como" or "marcar todos" for booking', () => {
    expect(actionVocabularyOf([{ actions: ['Marcar todas como lidas', 'Marcar todos presentes', 'Marcar como concluída'] }]).has('book')).toBe(false);
    expect(actionVocabularyOf([{ actions: ['Marcar consulta'] }]).has('book')).toBe(true);
    expect(isActionRequest('marca como lida')).toBe(false);
  });

  // "Transferir JSON", "transferir o PDF": in Portuguese a file is downloaded with the same verb money is moved with.
  it('never takes downloading a file for moving money', () => {
    expect(actionVocabularyOf([{ actions: ['Transferir JSON', 'Transferir o PDF', 'Transferir dados'] }]).has('pay')).toBe(false);
    expect(actionVocabularyOf([{ actions: ['Transferir para o fornecedor'] }]).has('pay')).toBe(true);
  });

  // ADR-042: what a screen's controls do is what the application does, whatever its title says.
  it('reads what the screens’ controls do, and what they open', () => {
    const v = actionVocabularyOf([
      { title: 'Comunicações', description: 'Campanhas e anúncios.', actions: ['Publicar'], opens: ['Nova campanha'] },
    ]);
    expect(v.has('send')).toBe(true);
  });
});

/**
 * Explanation detection, sharing ADR-015's frame layer rather than adding a
 * competing one.
 *
 * It changes no routing decision — the capability and route resolve identically
 * either way — so these assert the discrimination, not an outcome.
 */
describe('isExplanationRequest — asking what something is, not to be taken to it', () => {
  it.each([
    'O que é um processo clínico?',
    'Para que serve o horário escolar?',
    'What is the Mental availability screen?',
    'What does the Compliance overview screen show?',
    "Why would I see a 'Delete task?' option?",
    'Explain the squad overview',
    'tell me about the training calendar',
    // Accented endings, both of which a naive `\b` silently fails to match —
    // JavaScript's `\b` is ASCII-only. An earlier `stripGreeting` shipped with
    // exactly this bug and never fired once across 145 screens.
    'O que é isto?',
    'Porquê esta página?',
  ])('detects an explanation request: %s', (u) => {
    expect(isExplanationRequest(u)).toBe(true);
  });

  /**
   * The discrimination that matters. Both of these mention a screen; only the
   * ones above ask what it *is*. "Where do I record an injury?" asks for a
   * destination, and the answer to it is navigation.
   */
  it.each([
    'Onde posso ver a lista dos membros do staff?',
    'Where do I record an injury?',
    'abre o calendário',
    'take me to the squad list',
    'mostra minhas notas',
  ])('does not treat a navigation request as one: %s', (u) => {
    expect(isExplanationRequest(u)).toBe(false);
  });

  /**
   * The two frames are independent and may both fire — "why would I delete a
   * task?" is a question about a screen that also carries an action verb.
   * Neither detector suppresses the other, because they answer different
   * questions and the caller uses them for different things.
   */
  it('is independent of the action signal', () => {
    const u = 'Why would I delete a task?';
    expect(isExplanationRequest(u)).toBe(true);
    expect(isActionRequest(u)).toBe(true);
  });
});
