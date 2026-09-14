import { describe, expect, it } from 'vitest';

import { commandFor, normalise } from './commands.ts';

/**
 * The short, closed list of things a visitor says to the assistant itself. The rule that
 * matters most is the last one: anything longer is a question and must reach the router.
 */

describe('commandFor', () => {
  it('hears the short things a visitor says to the assistant itself', () => {
    expect(commandFor('Fechar', 'pt-PT')).toBe('close');
    expect(commandFor('abre o menu', 'pt-PT')).toBe('menu');
    expect(commandFor('voltar atrás', 'pt-PT')).toBe('back');
    expect(commandFor('Voltar ao início', 'pt-PT')).toBe('home');
    expect(commandFor('cala-te', 'pt-PT')).toBe('stop');
    expect(commandFor('podes repetir?', 'pt-PT')).toBe('repeat');
    expect(commandFor('parar de ouvir', 'pt-PT')).toBe('mute');
    expect(commandFor('go back', 'en')).toBe('back');
    expect(commandFor('Close, please', 'en')).toBe('close');
    expect(commandFor('por favor, fechar', 'pt-PT')).toBe('close');
  });

  it('understands either language, whatever language the page is in', () => {
    expect(commandFor('close', 'pt-PT')).toBe('close');
    expect(commandFor('fechar', 'en')).toBe('close');
  });

  it('anything longer is a question, not a command', () => {
    expect(commandFor('fechar a inscrição do meu filho', 'pt-PT')).toBeNull();
    expect(commandFor('onde vejo o menu do almoço', 'pt-PT')).toBeNull();
    expect(commandFor('calendário', 'pt-PT')).toBeNull();
    expect(commandFor('   ', 'pt-PT')).toBeNull();
  });
});

describe('normalise', () => {
  it('drops case, accents and punctuation', () => {
    expect(normalise('  Voltar ao Início!  ')).toBe('voltar ao inicio');
  });
});
