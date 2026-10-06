import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commandFor, normalise } from './commands.ts';

/**
 * The short, closed list of things a visitor says to the assistant itself. The rule that
 * matters most is the last one: anything longer is a question and must reach the router.
 */

describe('commandFor', () => {
  it('hears the short things a visitor says to the assistant itself', () => {
    expect(commandFor('Fechar', 'pt-PT')).toBe('close');
    expect(commandFor('Visita guiada', 'pt-PT')).toBe('tour');
    expect(commandFor('show me around', 'en')).toBe('tour');
    // There is no menu of the assistant's own any more: "menu" is a question (ADR-026).
    expect(commandFor('abre o menu', 'pt-PT')).toBeNull();
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

/**
 * Commands are matched before the router, like small talk: a phrase claimed here never reaches a screen.
 * Every question the repository knows is a real one — each golden utterance, and every example phrase the
 * fixture's registries carry — must not be taken for a command, in any page language.
 */
describe('commandFor — never takes a known real question', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const known = [
    ...['eval/frameworks/school/golden-set.jsonl', 'eval/bulletproof-react/golden-set.jsonl', 'packages/core-intent/eval/golden-set.jsonl'].flatMap((file) =>
      readFileSync(join(ROOT, file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => (JSON.parse(line) as { utterance: string }).utterance),
    ),
    ...readdirSync(join(ROOT, 'eval', 'frameworks', 'school', 'generated'))
      .filter((file) => /^registry\..+\.json$/.test(file))
      .flatMap((file) => (JSON.parse(readFileSync(join(ROOT, 'eval', 'frameworks', 'school', 'generated', file), 'utf8')) as { capabilities: { examples?: string[] }[] }).capabilities)
      .flatMap((capability) => capability.examples ?? []),
  ];

  it('leaves every one of them to the router', () => {
    expect(known.length).toBeGreaterThan(150);
    for (const q of known) {
      for (const lang of ['en', 'pt']) {
        const command = commandFor(q, lang);
        // "página inicial" is both a home-screen example and the home command, which takes the visitor to
        // the app's home page — the same place — and falls through to the router when there is none.
        if (command === 'home') continue;
        expect(command, `${lang}: ${q}`).toBeNull();
      }
    }
  });
});

describe('normalise', () => {
  it('drops case, accents and punctuation', () => {
    expect(normalise('  Voltar ao Início!  ')).toBe('voltar ao inicio');
  });
});
