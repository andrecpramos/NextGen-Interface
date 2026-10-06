import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { teach } from './teach.ts';

/**
 * `scan.mjs teach` (ADR-027): what visitors settled for questions the assistant could not, turned into
 * `askedAs` phrases in the adopter's `knowledge.json`. Only with `--write`; never a phrase that may
 * identify someone; never one visitors settled two ways.
 */

function kit(knowledge?: unknown): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'nextgen-teach-')), 'nextgen');
  mkdirSync(join(dir, 'bundle'), { recursive: true });
  mkdirSync(join(dir, 'review'), { recursive: true });
  writeFileSync(join(dir, 'nextgen.config.json'), JSON.stringify({ appRoot: '../app' }));
  writeFileSync(join(dir, 'review', 'build.json'), JSON.stringify({ roles: ['COACH', 'PARENT'] }));
  const registry = (caps: unknown[]) => JSON.stringify({ schemaVersion: 1, domainDescription: 'A club.', capabilities: caps });
  writeFileSync(join(dir, 'bundle', 'registry.COACH.json'), registry([
    { id: 'attendance.today', kind: 'navigate', route: '/attendance/today' },
    { id: 'players.detail', kind: 'navigate', route: '/players/:playerId' },
    { id: 'players.new', kind: 'navigate', route: '/players/new' },
    { id: 'unsupported.payments', kind: 'unsupported', route: null },
  ]));
  writeFileSync(join(dir, 'bundle', 'registry.PARENT.json'), registry([
    { id: 'guardian.children', kind: 'navigate', route: '/my/children' },
  ]));
  if (knowledge !== undefined) writeFileSync(join(dir, 'knowledge.json'), JSON.stringify(knowledge));
  return dir;
}

function lessons(dir: string, lines: unknown[]): string {
  const file = join(dir, '..', 'lessons.jsonl');
  writeFileSync(file, `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
  return file;
}

const chose = (question: string, route: string) => ({ question, route, how: 'chose', from: '/', offered: [route] });

describe('teach', () => {
  it('writes nothing without --write, and says what it would teach', () => {
    const dir = kit();
    const result = teach(dir, lessons(dir, [chose('quem faltou hoje', '/attendance/today')]));
    expect(result.taught).toEqual([{ screen: '/attendance/today', phrases: ['quem faltou hoje'] }]);
    expect(result.wrote).toBe(false);
    expect(existsSync(join(dir, 'knowledge.json'))).toBe(false);
    expect(readFileSync(result.reportFile, 'utf8')).toContain('quem faltou hoje');
  });

  it('with --write, adds the phrase to that screen’s askedAs — keeping everything the adopter wrote', () => {
    const dir = kit({ app: { name: 'Escola' }, screens: { '/attendance/today': { purpose: 'Who is in today.', askedAs: ['presenças'] } } });
    teach(dir, lessons(dir, [chose('quem faltou hoje', '/attendance/today'), chose('Quem FALTOU hoje?', '/attendance/today')]), { write: true });
    const knowledge = JSON.parse(readFileSync(join(dir, 'knowledge.json'), 'utf8'));
    expect(knowledge.app).toEqual({ name: 'Escola' });
    expect(knowledge.screens['/attendance/today']).toEqual({ purpose: 'Who is in today.', askedAs: ['presenças', 'quem faltou hoje'] });
  });

  it('matches a concrete path to its screen, and prefers the specific route over a parameter', () => {
    const dir = kit();
    const result = teach(dir, lessons(dir, [chose('ficha do jogador', '/players/42'), chose('novo jogador', '/players/new?from=menu')]));
    expect(result.taught.map((t) => t.screen).sort()).toEqual(['/players/:playerId', '/players/new']);
  });

  it('adds to a screen the adopter keyed by its id, not a second entry', () => {
    const dir = kit({ screens: { 'guardian.children': { askedAs: [] } } });
    teach(dir, lessons(dir, [chose('os meus filhos', '/my/children')]), { write: true });
    const knowledge = JSON.parse(readFileSync(join(dir, 'knowledge.json'), 'utf8'));
    expect(Object.keys(knowledge.screens)).toEqual(['guardian.children']);
    expect(knowledge.screens['guardian.children'].askedAs).toEqual(['os meus filhos']);
  });

  it('holds back what may identify someone, and what visitors settled two ways', () => {
    const dir = kit();
    const result = teach(dir, lessons(dir, [
      chose('ficha do 912345678', '/players/1'),
      chose('email ana@club.pt', '/players/1'),
      chose('ver jogadores', '/players/new'),
      chose('ver jogadores', '/my/children'),
    ]), { write: true });
    expect(result.taught).toEqual([]);
    expect(result.held.map((h) => h.question)).toEqual(['ficha do 912345678', 'email ana@club.pt', 'ver jogadores']);
    expect(existsSync(join(dir, 'knowledge.json'))).toBe(false);
  });

  it('lists what no screen answered, most asked first — for the developer to decide', () => {
    const dir = kit();
    const result = teach(dir, lessons(dir, [
      { question: 'quero falar com alguém', route: null, how: 'unplaced' },
      { question: 'what is the weather', route: null, how: 'unplaced' },
      { question: 'Quero falar com alguém!', route: null, how: 'rejected' },
      chose('search for ana', '/search?q=ana'),
    ]));
    expect(result.unanswered).toEqual([
      { question: 'quero falar com alguém', times: 2 },
      { question: 'what is the weather', times: 1 },
      { question: 'search for ana', times: 1 },
    ]);
  });

  it('needs --min agreeing visitors when asked, and skips lines it cannot read', () => {
    const dir = kit();
    const result = teach(dir, lessons(dir, ['not json', '{"route": "/x"}', chose('faltas', '/attendance/today')]), { min: 2 });
    expect(result.read).toBe(1);
    expect(result.taught).toEqual([]);
    expect(result.held[0]?.why).toMatch(/--min is 2/);
  });

  it('refuses a folder that was never built', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'nextgen-teach-')), 'nextgen');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'x.jsonl'), '');
    expect(() => teach(dir, join(dir, 'x.jsonl'))).toThrow(/Run build first/);
  });
});
