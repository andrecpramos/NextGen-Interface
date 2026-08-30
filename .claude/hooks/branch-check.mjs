#!/usr/bin/env node
// Fires at the start of every new context window (SessionStart) and just before
// compaction (PreCompact), and states this repo's branching contract with live
// git facts attached.
//
// The contract (see .ai/sdlc/branching.md):
//   main     production. Never committed to directly. Reached only when the
//            user explicitly asks for a release.
//   develop  integration. Default branch. Everything lands here.
//   <feature> branches FROM develop, merges back INTO develop.
//
// Contract with the harness: print one JSON object carrying
// hookSpecificOutput.additionalContext. Never exit non-zero and never throw --
// a failing SessionStart hook blocks the session. Node, not jq: jq is not on
// PATH on this machine, and Node is a hard dependency of this repo anyway.

import { execFileSync } from 'node:child_process';

const PROD = 'main';
const BASE = 'develop';

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
const hasBase = git('rev-parse', '--verify', BASE) !== null;

let situation;
if (branch === PROD) {
  situation = `You are on '${PROD}' — PRODUCTION. Do not commit here. Before any edit,
switch to '${BASE}' or cut a feature branch from it.`;
} else if (branch === BASE) {
  situation = `You are on '${BASE}' (integration, the default branch).
Small changes may land here directly. Anything larger should be a feature branch
cut from '${BASE}'.`;
} else if (!hasBase) {
  situation = `You are on '${branch}'. Branch '${BASE}' does not exist locally —
run 'git fetch origin ${BASE}:${BASE}' before branching or merging.`;
} else {
  const ahead = git('rev-list', '--count', `${BASE}..${branch}`) ?? '?';
  const behind = git('rev-list', '--count', `${branch}..${BASE}`) ?? '?';
  const based = git('merge-base', '--is-ancestor', BASE, branch) !== null;
  situation =
    `You are on feature branch '${branch}' — ${ahead} ahead, ${behind} behind '${BASE}'.\n` +
    (based
      ? `It is cleanly based on '${BASE}'. It merges back into '${BASE}', never into '${PROD}'.`
      : `WARNING: it does NOT contain the tip of '${BASE}'. Rebase or merge '${BASE}' in before
opening a PR, or the merge will carry stale work.`);
}

const additionalContext = `BRANCH CHECK — new context window (${event}: ${reason}).

${situation}
Uncommitted changes: ${dirty} file(s).

THE BRANCHING CONTRACT for this repo — treat as binding:
  · '${PROD}' is production. NEVER commit, merge or push to it on your own
    initiative. It is updated ONLY when the user explicitly asks for a release.
  · '${BASE}' is the integration branch and the default. All work lands here.
  · Every new branch is cut FROM '${BASE}' and merges back INTO '${BASE}'.
    Never branch from '${PROD}' and never open a PR into '${PROD}' unless the
    user asked for a release in this session.

Before you make any code change, ask the user whether to keep working on
'${branch}' or cut a new branch from '${BASE}', and wait for the answer. Use
AskUserQuestion; propose a concrete branch name based on what they asked for.

Skip the question only when the request is read-only — a question, review, or
explanation that writes no files. Ask once per context window, not before every
edit.

This tree is worked on by more than one session at a time. Stage explicit paths;
never 'git add -A' or 'git commit -a'. Re-check 'git status' immediately before
committing, and leave modified files you did not touch alone.`;

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
