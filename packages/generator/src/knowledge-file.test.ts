import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_KNOWLEDGE } from './knowledge.ts';
import { loadKnowledge } from './knowledge-file.ts';

/** Where the adopter keeps what they know about their app: found by convention, or named. */

let dir = '';
const make = (files: Record<string, string>): string => {
  dir = mkdtempSync(join(tmpdir(), 'nextgen-knowledge-'));
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  }
  return join(dir, 'nextgen', 'generator.config.json');
};
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

const good = JSON.stringify({ app: { about: 'Um clube.' }, screens: { '/a': { purpose: 'A.' } } });

describe('loadKnowledge', () => {
  it('finds knowledge.json beside the config without being told', () => {
    const config = make({ 'nextgen/generator.config.json': '{}', 'nextgen/knowledge.json': good });
    const loaded = loadKnowledge(config, undefined);
    expect(loaded.found).toBe(true);
    expect(loaded.knowledge.app.about).toBe('Um clube.');
    expect(loaded.problems).toEqual([]);
    expect(loaded.path).toMatch(/nextgen[\\/]knowledge\.json$/);
  });

  it('reads the file the config names, relative to the config', () => {
    const config = make({ 'nextgen/generator.config.json': '{}', 'nextgen/about/app.json': good });
    expect(loadKnowledge(config, 'about/app.json').knowledge.screens['/a']!.purpose).toBe('A.');
  });

  it('is empty, quietly, when the adopter has written nothing yet', () => {
    const config = make({ 'nextgen/generator.config.json': '{}' });
    expect(loadKnowledge(config, undefined)).toMatchObject({ found: false, knowledge: EMPTY_KNOWLEDGE, problems: [], path: null });
  });

  it('says so when a file the config names is not there — that is a mistake, not an absence', () => {
    const config = make({ 'nextgen/generator.config.json': '{}' });
    const loaded = loadKnowledge(config, 'nope.json');
    expect(loaded.found).toBe(false);
    expect(loaded.problems[0]!.message).toMatch(/not found/i);
  });

  it('does not throw on a file that is not JSON, and says why nothing was read', () => {
    const config = make({ 'nextgen/generator.config.json': '{}', 'nextgen/knowledge.json': '{ "app": ' });
    const loaded = loadKnowledge(config, undefined);
    expect(loaded.found).toBe(true);
    expect(loaded.knowledge).toEqual(EMPTY_KNOWLEDGE);
    expect(loaded.problems[0]!.message).toMatch(/not valid JSON/i);
  });

  it('reads a file saved with a byte-order mark, which Windows editors add', () => {
    const config = make({ 'nextgen/generator.config.json': '{}', 'nextgen/knowledge.json': `﻿${good}` });
    expect(loadKnowledge(config, undefined).knowledge.app.about).toBe('Um clube.');
  });

  it('will not read a file outside the folder the config lives in', () => {
    const config = make({ 'nextgen/generator.config.json': '{}', 'secret.json': good });
    const loaded = loadKnowledge(config, '../secret.json');
    expect(loaded.found).toBe(false);
    expect(loaded.problems[0]!.message).toMatch(/outside/i);
  });
});
