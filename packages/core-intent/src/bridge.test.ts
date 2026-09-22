import { describe, expect, it } from 'vitest';

import { bridge, bridgeWords } from './bridge.ts';
import type { Registry } from './types.ts';

/** Only `documents` is read: the words the app uses. */
const registryOf = (...documents: string[]): Registry => ({ documents }) as unknown as Registry;

const portuguese = registryOf(
  'Estado Médico. Onde o encarregado vê se o educando está apto a treinar. lesão recuperação',
  'Definições. Palavra-passe e idioma da conta.',
  'Notificações. Os avisos da aplicação.',
  'Plantel. Os jogadores da equipa.',
);

describe('bridge — a word the app does not use, to one it does', () => {
  it('finds another form of the word by the rules of the language', () => {
    expect(bridgeWords('lesões', portuguese)).toEqual(['lesao']);
    expect(bridgeWords('o meu jogador', portuguese)).toEqual(['jogadores']);
  });

  it('finds the same idea in the app’s language', () => {
    expect(bridgeWords('change my password', portuguese)).toEqual(expect.arrayContaining(['palavra-passe']));
    expect(bridgeWords('my players', portuguese)).toEqual(expect.arrayContaining(['jogadores']));
    expect(bridgeWords('notifications settings', portuguese)).toEqual(expect.arrayContaining(['notificacoes', 'definicoes']));
  });

  it('leaves a question in the app’s own words exactly as it is', () => {
    for (const q of ['estado médico', 'ver os jogadores do plantel', 'mudar a palavra-passe']) {
      expect(bridgeWords(q, portuguese), q).toEqual([]);
      expect(bridge(q, portuguese), q).toBe(q);
    }
  });

  it('never adds a word the app does not use, so an out-of-scope question stays out of scope', () => {
    expect(bridgeWords("what's the weather tomorrow", portuguese)).toEqual([]);
    expect(bridgeWords('write me a poem', portuguese)).toEqual([]);
    // "invoices" is an idea it knows about, but this app has no word for it: nothing to add.
    expect(bridgeWords('my invoices', portuguese)).toEqual([]);
  });

  it('does not touch short words, whose other forms are mostly noise ("novas", "meus")', () => {
    expect(bridgeWords('mensagens novas', registryOf('novos avisos', 'os meu'))).toEqual([]);
  });

  it('adds at most two of the app’s words for one idea, so one word cannot outweigh the question', () => {
    const many = registryOf('filho filhos criança crianças educando educandos kid kids child children');
    expect(bridgeWords('my daughter', many).length).toBeLessThanOrEqual(2);
  });

  it('keeps the visitor’s words first and unchanged', () => {
    expect(bridge('Lesões?', portuguese)).toBe('Lesões? lesao');
  });

  it('is cheap whatever is pasted', () => {
    const started = performance.now();
    for (let i = 0; i < 200; i++) bridge('palavra '.repeat(400), portuguese);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
