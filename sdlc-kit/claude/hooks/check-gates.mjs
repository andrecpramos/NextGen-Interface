#!/usr/bin/env node
// PostToolUse hook for Edit/Write. Surfaces the cheapest gate the edit could
// have broken, immediately, while the change is still in the agent's head.
//
// It is SILENT unless a configured path matches, and that silence is the design.
// A hook that comments on every write becomes noise an agent learns to skim,
// which is worse than no hook at all -- it trains the agent to ignore the channel
// the important messages arrive on.
//
// Driven by `postEdit` in .ai/sdlc.config.json. Keep those commands under a
// second: a slow post-edit hook makes every file write feel expensive and gets
// disabled within a week.
//
// Contract with the harness: exit 0 always, print additionalContext or nothing.

import { execSync } from 'node:child_process';
import { relative, isAbsolute } from 'node:path';
import { loadConfig, readPayload, emitContext, matchGlob } from './_config.mjs';

const cfg = loadConfig();
const payload = await readPayload();

const tool = payload.tool_name;
if (tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') process.exit(0);

const target = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path ?? '';
if (!target) process.exit(0);

// Match against a repo-relative POSIX path, so config globs are written the way
// they appear in the repo rather than the way this machine spells them.
const rel = (isAbsolute(target) ? relative(cfg.root, target) : target).replace(/\\/g, '/');
if (!rel || rel.startsWith('..')) process.exit(0);

const notes = [];

for (const entry of cfg.postEdit ?? []) {
  const paths = entry.paths ?? [];
  if (!paths.some((p) => matchGlob(p, rel))) continue;

  if (entry.remind) notes.push(entry.remind);

  if (entry.run) {
    try {
      execSync(entry.run, {
        cwd: cfg.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: entry.timeoutMs ?? 5000,
      });
      // Passing is the expected case and says nothing. Only failure is news.
    } catch (err) {
      const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
      const head = out.split('\n').slice(0, 12).join('\n');
      notes.push(
        `GATE FAILED after editing ${rel}\n` +
          `  $ ${entry.run}\n` +
          (head ? `${head}\n` : '') +
          `Fix this before continuing — it is cheaper now than in CI.`,
      );
    }
  }
}

if (!notes.length) process.exit(0);

emitContext('PostToolUse', notes.join('\n\n'));
