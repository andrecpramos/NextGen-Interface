// Finding and reading the adopter's `knowledge.json` (knowledge.ts is the shape, and is pure).
//
// By convention it sits beside the generator config, so an agent that has run `init` finds a
// place to put it without being told and the adopter's repository has one obvious file to read
// and review. A config may name another path, relative to the config, but not one outside its
// folder: this is a file the adopter *wrote*, and nothing here should be a way to read a file
// that was not offered.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { EMPTY_KNOWLEDGE, parseKnowledge, type AppKnowledge, type KnowledgeProblem } from './knowledge.ts';

export const KNOWLEDGE_FILE = 'knowledge.json';

export interface LoadedKnowledge {
  readonly knowledge: AppKnowledge;
  readonly problems: readonly KnowledgeProblem[];
  /** Where it was read from, or `null` when there was no file. */
  readonly path: string | null;
  readonly found: boolean;
}

const none = (problems: readonly KnowledgeProblem[] = [], path: string | null = null, found = false): LoadedKnowledge => ({
  knowledge: EMPTY_KNOWLEDGE,
  problems,
  path,
  found,
});

/**
 * @param configFile the generator config the build was started with
 * @param named      its `knowledge` field, if it has one
 */
export function loadKnowledge(configFile: string, named: string | undefined): LoadedKnowledge {
  const folder = dirname(resolve(configFile));
  const explicit = typeof named === 'string' && named.trim() !== '';
  const target = resolve(folder, explicit ? named : KNOWLEDGE_FILE);

  const outside = relative(folder, target);
  if (outside.startsWith('..') || isAbsolute(outside)) {
    return none([{ path: '', message: `knowledge file “${named}” is outside the folder the config lives in, so it was not read` }]);
  }

  // Not having written one yet is normal; naming one that is not there is a mistake.
  if (!existsSync(target) || !statSync(target).isFile()) {
    return explicit ? none([{ path: '', message: `knowledge file “${named}” not found (looked for ${target})` }]) : none();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(target, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    return none([{ path: '', message: `not valid JSON, so nothing was read: ${(error as Error).message}` }], target, true);
  }

  const { knowledge, problems } = parseKnowledge(raw);
  return { knowledge, problems, path: target, found: true };
}
