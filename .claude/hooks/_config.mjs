// Shared config loader for the SDLC kit hooks.
//
// Reads .claude/sdlc.config.json and fills in defaults. Every hook in this directory
// depends on it; nothing else should.
//
// Contract: this module NEVER throws and NEVER exits non-zero. A SessionStart
// hook that errors blocks the session, so an unreadable or malformed config must
// degrade to sane defaults rather than take the session down with it. Every
// function here is written on that assumption.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const git = (...args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

export const repoRoot = () => git('rev-parse', '--show-toplevel') ?? process.cwd();

export const insideWorkTree = () => git('rev-parse', '--is-inside-work-tree') === 'true';

/** Read one JSON file, tolerating a UTF-8 BOM. Returns null on any failure. */
const readJson = (path) => {
  try {
    // A PowerShell-written JSON file carries a BOM that JSON.parse rejects
    // outright — a genuinely confusing failure to debug from inside a silent hook.
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};

const DEFAULTS = {
  version: 1,
  project: {},
  branching: {
    model: 'two-trunk',
    production: 'main',
    integration: 'develop',
    featurePrefix: 'feature/',
    releaseOnRequestOnly: true,
    protectedRefs: [],
  },
  sharedTree: false,
  commits: { convention: 'conventional', scopes: [], trailers: [] },
  gates: [],
  docs: { root: '.claude', rules: '.claude/docs/rules.md', decisions: '.claude/decisions' },
  guard: {
    denyProductionWrites: true,
    denyBranchFromProduction: true,
    extraDeny: [],
  },
  postEdit: [],
};

/**
 * Load the config, merged over defaults.
 *
 * `found: false` means the kit is installed but not configured — hooks then run
 * on defaults and say so, rather than pretending to enforce a contract nobody
 * actually wrote down.
 */
// Where the config may live, in priority order. `.claude/` is the default —
// one directory for everything the agent workflow needs. `.ai/` is accepted so
// a repo that keeps a separate tool-agnostic knowledge base still works, and so
// this loader survives the migration between the two.
const CONFIG_PATHS = [
  ['.claude', 'sdlc.config.json'],
  ['.ai', 'sdlc.config.json'],
];

export function loadConfig() {
  const root = repoRoot();
  let raw = null;
  for (const parts of CONFIG_PATHS) {
    raw = readJson(join(root, ...parts));
    if (raw !== null) break;
  }

  const cfg = {
    ...DEFAULTS,
    ...(raw ?? {}),
    project: { ...DEFAULTS.project, ...(raw?.project ?? {}) },
    branching: { ...DEFAULTS.branching, ...(raw?.branching ?? {}) },
    commits: { ...DEFAULTS.commits, ...(raw?.commits ?? {}) },
    docs: { ...DEFAULTS.docs, ...(raw?.docs ?? {}) },
    guard: { ...DEFAULTS.guard, ...(raw?.guard ?? {}) },
    found: raw !== null,
    root,
  };

  // The trunk model has no separate integration branch: work lands on production
  // itself. Collapsing it here means no downstream hook needs to special-case it.
  if (cfg.branching.model === 'trunk') {
    cfg.branching.integration = cfg.branching.production;
  }

  // Broad staging is denied precisely when the tree is shared, unless the config
  // overrides it explicitly.
  if (cfg.guard.denyBroadStaging === undefined) {
    cfg.guard.denyBroadStaging = cfg.sharedTree === true;
  }

  return cfg;
}

/** Read a hook payload from stdin. Returns {} on malformed or absent input. */
export async function readPayload() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/** Emit additionalContext for SessionStart / PreCompact / PostToolUse, then exit 0. */
export function emitContext(eventName, text) {
  if (text && text.trim()) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: text,
        },
      }),
    );
  }
  process.exit(0);
}

/**
 * Minimal glob matcher: supports globstar, star and ? against POSIX-separated
 * paths.
 *
 * Translated in a single pass rather than by chained String.replace, because the
 * chained form needs sentinel characters to stop a globstar being re-matched by
 * the single-star rule — and a sentinel that survives into source is a control
 * byte that editors, diff tools and copy-paste all mangle.
 *
 * A globstar crosses directory separators; a single star does not. That
 * distinction is what makes `src/*.ts` and `src/**` mean different things.
 */
export function matchGlob(pattern, path) {
  const p = String(path).replace(/\\/g, '/');
  const src = String(pattern).replace(/\\/g, '/');
  const SPECIAL = '.+^${}()|[]\\';
  let rx = '';

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '*') {
      if (src[i + 1] === '*') {
        if (src[i + 2] === '/') {
          // `a/**/b` must also match `a/b`, so the segment group is optional.
          rx += '(?:.*/)?';
          i += 2;
        } else {
          rx += '.*';
          i += 1;
        }
      } else {
        rx += '[^/]*';
      }
    } else if (c === '?') {
      rx += '[^/]';
    } else if (SPECIAL.includes(c)) {
      rx += '\\' + c;
    } else {
      rx += c;
    }
  }

  try {
    return new RegExp('^' + rx + '$').test(p);
  } catch {
    return false;
  }
}
