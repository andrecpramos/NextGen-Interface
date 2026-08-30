#!/usr/bin/env node
// Fires at the start of every new context window (SessionStart) and just before
// compaction (PreCompact). Injects the live branch state so the agent asks the
// branch question with real facts instead of a generic reminder.
//
// Contract: print one JSON object with hookSpecificOutput.additionalContext.
// Never exit non-zero and never throw — a failing SessionStart hook blocks the
// session. Node (not jq) because jq is not on PATH on this machine, and a Node
// runtime is a hard dependency of this repo anyway.

import { execFileSync } from 'node:child_process';

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const readStdin = async () => {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
};

const payload = await readStdin();
// SessionStart sends .source (startup|resume|clear|compact); PreCompact sends .trigger.
const event = payload.hook_event_name ?? 'SessionStart';
const reason = payload.source ?? payload.trigger ?? 'startup';

if (git('rev-parse', '--is-inside-work-tree') !== 'true') process.exit(0);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD') ?? 'unknown';
const dirty = (git('status', '--porcelain') ?? '').split('\n').filter(Boolean).length;
const base = git('show-ref', '--verify', '--quiet', 'refs/heads/main') === null ? 'master' : 'main';

const posture =
  branch === base
    ? `You are on the default branch (${base}). Work should almost always move to a new branch first.`
    : `You are on feature branch '${branch}', ${git('rev-list', '--count', `${base}..${branch}`) ?? '?'} commit(s) ahead of ${base}.`;

const additionalContext = `BRANCH CHECK — new context window (${event}: ${reason}).

${posture}
Uncommitted changes: ${dirty} file(s).

Before you make any code change in this session, ask the user whether to keep
working on '${branch}' or cut a new branch, and wait for the answer. Use the
AskUserQuestion tool; offer 'stay on ${branch}' and 'new branch' with a concrete
suggested name based on what they ask for.

Skip the question only when the user's request is read-only — a question,
review, or explanation that writes no files. Ask once per context window, not
before every edit.`;

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
