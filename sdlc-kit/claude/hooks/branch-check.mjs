#!/usr/bin/env node
// Fires at the start of every new context window (SessionStart) and just before
// compaction (PreCompact), and states this repo's branching contract with live
// git facts attached.
//
// Why a hook rather than a line in a document: an instruction in a document is
// only followed by an agent that has already read the document, which is
// precisely not the case at the start of a fresh context window.
//
// Why live state rather than a static reminder: an agent told "you are on
// feature/x, 3 ahead and 2 behind, 5 files uncommitted" asks a useful question.
// One told "consider branching" does not.
//
// Contract with the harness: print one JSON object carrying
// hookSpecificOutput.additionalContext. NEVER exit non-zero and NEVER throw --
// a failing SessionStart hook blocks the session, so failing open is the only
// acceptable behaviour.
//
// Configured entirely by .ai/sdlc.config.json. Nothing here is repo-specific.

import { loadConfig, git, insideWorkTree, readPayload, emitContext } from './_config.mjs';

const cfg = loadConfig();
const { production: PROD, integration: BASE, featurePrefix, model } = cfg.branching;

const payload = await readPayload();
// SessionStart sends .source (startup|resume|clear|compact); PreCompact sends .trigger.
const event = payload.hook_event_name ?? 'SessionStart';
const reason = payload.source ?? payload.trigger ?? 'startup';

// Outside a work tree there is no contract to state.
if (!insideWorkTree()) process.exit(0);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD') ?? 'unknown';
const dirty = (git('status', '--porcelain') ?? '').split('\n').filter(Boolean).length;
const hasBase = BASE ? git('rev-parse', '--verify', BASE) !== null : false;

/** Commits on `a` not on `b`. */
const countRange = (a, b) => {
  const out = git('rev-list', '--count', `${b}..${a}`);
  const n = Number.parseInt(out ?? '', 10);
  return Number.isFinite(n) ? n : null;
};

let situation;
let stale = false;

if (branch === PROD && model !== 'trunk') {
  situation =
    `You are on '${PROD}' — PRODUCTION. Do not commit here.\n` +
    `Before any edit, switch to '${BASE}' or cut a branch from it.`;
} else if (branch === BASE) {
  situation =
    model === 'trunk'
      ? `You are on '${BASE}' — the trunk, and it is production.\n` +
        `Cut a short-lived branch for anything that is not a trivial fix.`
      : `You are on '${BASE}' (integration, the default branch).\n` +
        `Small changes may land here directly. Anything larger should be a branch cut from '${BASE}'.`;
} else if (!hasBase) {
  situation =
    `You are on '${branch}'. Branch '${BASE}' does not exist locally, so this\n` +
    `hook cannot compare against it. Fetch it, or correct 'branching.integration'\n` +
    `in .ai/sdlc.config.json — one of the two is wrong.`;
} else {
  const ahead = countRange(branch, BASE);
  const behind = countRange(BASE, branch);
  stale = behind !== null && behind > 0;
  const pos =
    ahead === null || behind === null
      ? `position relative to '${BASE}' unknown`
      : `${ahead} ahead, ${behind} behind '${BASE}'`;

  situation = `You are on feature branch '${branch}' — ${pos}.`;
  situation += stale
    ? `\n⚠ It does NOT contain the tip of '${BASE}' and will carry stale work on merge.\n` +
      `   Rebase or merge '${BASE}' in before going further.`
    : `\nIt is cleanly based on '${BASE}'. It merges back into '${BASE}', never into '${PROD}'.`;
}

const releaseClause = cfg.branching.releaseOnRequestOnly
  ? `  · '${PROD}' is production. NEVER commit, merge or push to it on your own\n` +
    `    initiative. It is updated ONLY when the user explicitly asks for a release,\n` +
    `    in this session, in words. "The work is finished" is not such a request.\n`
  : '';

const baseClause =
  model === 'trunk'
    ? `  · '${PROD}' is the trunk. Branches are short-lived and squash-merge back.\n`
    : `  · '${BASE}' is the integration branch and the default. All work lands here.\n` +
      `  · Every branch is cut FROM '${BASE}' and merges back INTO '${BASE}'.\n` +
      `    Never branch from '${PROD}', and never open a PR into '${PROD}' unless the\n` +
      `    user asked for a release in this session.\n`;

const sharedClause = cfg.sharedTree
  ? `\nThis tree is worked on by more than one session at a time. Stage explicit\n` +
    `paths; never 'git add -A' or 'git commit -a'. Re-check 'git status'\n` +
    `immediately before committing, and leave modified files you did not touch alone.\n`
  : '';

const configClause = cfg.found
  ? ''
  : `\nNOTE: no .ai/sdlc.config.json was found, so these are the kit's DEFAULTS\n` +
    `('${PROD}' / '${BASE}'), not this repo's verified contract. Run /sdlc-init\n` +
    `to survey the repo and write a real one.\n`;

emitContext(
  event,
  `BRANCH CHECK — new context window (${event}: ${reason}).

${situation}
Uncommitted changes: ${dirty} file(s).

THE BRANCHING CONTRACT for this repo — treat as binding:
${releaseClause}${baseClause}
Before you make any code change, ask the user whether to keep working on
'${branch}' or cut a new branch from '${BASE}', and wait for the answer. Use
AskUserQuestion; propose a concrete branch name based on what they asked for
(convention: ${featurePrefix}<area>-<short-name>).

Skip the question only when the request is read-only — a question, review, or
explanation that writes no files. Ask once per context window, not before every
edit.
${sharedClause}${configClause}`,
);
