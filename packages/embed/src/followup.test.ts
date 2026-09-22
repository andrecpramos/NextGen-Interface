import { describe, expect, it } from 'vitest';

import { followUpFor } from './followup.ts';

/**
 * A reply to what the assistant just offered. Read only when the last answer offered places (the
 * assistant decides that); here, only whether a message is such a reply, and which.
 */
describe('followUpFor — a reply to what was just offered', () => {
  it('takes yes, in either language and however it is written', () => {
    for (const q of ['yes', 'Yes!', 'yes please', 'that one', 'take me there', 'sim', 'Sim, por favor', 'isso mesmo', 'esse', 'pode ser', 'leva-me lá', 'ok, sim']) {
      expect(followUpFor(q), q).toEqual({ kind: 'accept' });
    }
  });

  it('takes a position, said as a word or a number', () => {
    expect(followUpFor('the first one')).toEqual({ kind: 'pick', index: 0 });
    expect(followUpFor('the second one')).toEqual({ kind: 'pick', index: 1 });
    expect(followUpFor('2')).toEqual({ kind: 'pick', index: 1 });
    expect(followUpFor('option 2')).toEqual({ kind: 'pick', index: 1 });
    expect(followUpFor('o segundo')).toEqual({ kind: 'pick', index: 1 });
    expect(followUpFor('a primeira')).toEqual({ kind: 'pick', index: 0 });
    expect(followUpFor('a opção 2')).toEqual({ kind: 'pick', index: 1 });
    expect(followUpFor('leva-me ao primeiro')).toEqual({ kind: 'pick', index: 0 });
    expect(followUpFor('o último')).toEqual({ kind: 'pick', index: -1 });
    expect(followUpFor('the last one')).toEqual({ kind: 'pick', index: -1 });
  });

  it('takes no for none of them', () => {
    for (const q of ['no', 'neither', 'none of those', 'não', 'nenhum', 'não é isso', 'nem um nem outro']) {
      expect(followUpFor(q), q).toEqual({ kind: 'reject' });
    }
  });

  it('leaves anything more to the router: a reply with a question in it is a question', () => {
    for (const q of [
      'yes but where are the fees', 'sim e o calendário', 'the medical one', 'o do treino', 'one', 'uma consulta',
      'first aid', 'segunda-feira', 'two players', 'constructor', 'toString', '', '   ', 'the second the first',
    ]) {
      expect(followUpFor(q), q).toBeNull();
    }
  });
});
