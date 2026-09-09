#!/usr/bin/env node
// PreToolUse hook for Bash. Denies the git commands the branching contract
// exists to prevent, and names the correct alternative in every denial so the
// agent retries without needing the user.
//
// Why this exists as well as branch-check.mjs: telling an agent the contract is
// necessary and not sufficient. The instruction sits at the top of a context
// window that fills up, and the mistake happens at the bottom.
//
// Contract with the harness: exit 0 and print a permissionDecision of "deny"
// with a reason, or print nothing to allow. Never throw.
//
// Configured entirely by .ai/sdlc.config.json.

import { loadConfig } from './_config.mjs';

const cfg = loadConfig();
const { production: PROD, integration: BASE } = cfg.branching;
const g = cfg.guard;

let payload = {};
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
} catch {
  process.exit(0); // Unparseable payload: allow. Failing closed here would wedge the session.
}

if (payload.tool_name !== 'Bash') process.exit(0);
const raw = String(payload.tool_input?.command ?? '');
if (!raw.trim()) process.exit(0);

/**
 * Strip heredoc bodies before matching.
 *
 * Learned the hard way: the first version of this hook blocked its own
 * documentation, because a file being written with `cat > f <<'EOF'` contained
 * the words `git push origin main` inside the heredoc. Anything a heredoc
 * carries is data this shell never executes, so scanning it produces only false
 * positives — and a guard that fires on documentation gets disabled within a day.
 */
const stripHeredocs = (cmd) => {
  const lines = cmd.split('\n');
  const out = [];
  let terminator = null;

  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue; // body -- never executed, never scanned
    }
    // <<EOF, <<-EOF, <<'EOF', <<"EOF"
    const m = line.match(/<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) terminator = m[2];
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Strip the argument of an `echo` / `printf`, for the same reason heredocs are
 * stripped: it is data, not something this shell executes.
 *
 * Found by this guard blocking the command that was testing it --
 * `echo '{"command":"git add -A"}' | node guard-git.mjs` is not a broad stage,
 * but the naive matcher saw the words. Piping echoed text into a hook, a file,
 * or a JSON payload is common enough that the false positive is worth removing;
 * `echo ... | sh` is exotic enough that losing coverage of it does not matter.
 */
const stripEchoArgs = (cmd) =>
  cmd.replace(
    /\b(echo|printf)\b(\s+-[a-zA-Z]+)*\s+('[^']*'|"[^"]*")/g,
    (m, verb, flags) => `${verb}${flags ?? ''} <text>`,
  );

const cmd = stripEchoArgs(stripHeredocs(raw));

const deny = (reason, instead) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: instead ? `${reason}\n\nInstead: ${instead}` : reason,
      },
    }),
  );
  process.exit(0);
};

// Every protected ref: production plus anything else the config marks protected.
const protectedRefs = [PROD, ...(cfg.branching.protectedRefs ?? [])].filter(Boolean);
const refAlternation = protectedRefs
  .map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^\\s]*'))
  .join('|');

// ---------------------------------------------------------------------------
// 1. Broad staging. Only when the tree is shared -- on a solo checkout `git add -A`
//    is ordinary and denying it is just friction.
// ---------------------------------------------------------------------------
if (g.denyBroadStaging) {
  if (/\bgit\s+add\s+(-A\b|--all\b|\.(?:\s|$))/.test(cmd)) {
    deny(
      'This working tree is shared with other agent sessions. `git add -A` / `git add .` ' +
        'stages files another session is still working on, and commits them under your message.',
      'stage explicit paths: `git add path/one path/two`. Re-check `git status` first.',
    );
  }
  if (/\bgit\s+commit\b[^\n]*\s-[a-zA-Z]*a/.test(cmd)) {
    deny(
      'This working tree is shared with other agent sessions. `git commit -a` sweeps in ' +
        "every modified tracked file, including another session's.",
      'stage explicit paths with `git add`, then `git commit` without `-a`.',
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Writes to production. Read-only commands against it stay allowed.
// ---------------------------------------------------------------------------
if (g.denyProductionWrites && refAlternation) {
  const isReadOnly = /\bgit\s+(log|diff|show|status|branch|rev-list|rev-parse|merge-base|describe|blame|fetch)\b/.test(
    cmd,
  );

  const pushesToProd = new RegExp(
    `\\bgit\\s+push\\b[^\\n]*\\b(?:${refAlternation})\\b|\\bgit\\s+push\\b[^\\n]*:(?:${refAlternation})\\b`,
  ).test(cmd);

  const mergesIntoProd =
    new RegExp(`\\bgit\\s+checkout\\s+(?:${refAlternation})\\b[^\\n]*&&[^\\n]*\\bgit\\s+merge\\b`).test(cmd) ||
    new RegExp(`\\bgit\\s+switch\\s+(?:${refAlternation})\\b[^\\n]*&&[^\\n]*\\bgit\\s+merge\\b`).test(cmd);

  const prIntoProd = new RegExp(
    `\\bgh\\s+pr\\s+create\\b[^\\n]*(?:--base|-B)\\s+(?:${refAlternation})\\b`,
  ).test(cmd);

  if (!isReadOnly && (pushesToProd || mergesIntoProd || prIntoProd)) {
    deny(
      `'${PROD}' is production. It moves only when the user explicitly asks for a release, ` +
        'in this session, in words. "The work is finished" is not such a request.',
      `land the work on '${BASE}' instead. If the user did just ask for a release, say so and ` +
        'ask them to run the release commands themselves, or to confirm explicitly in this turn.',
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Branching from production. Silently reverts integration work on merge.
// ---------------------------------------------------------------------------
if (g.denyBranchFromProduction && BASE && BASE !== PROD) {
  const cutFromProd =
    new RegExp(`\\bgit\\s+checkout\\s+-b\\s+[^\\s]+\\s+(?:${refAlternation})\\b`).test(cmd) ||
    new RegExp(`\\bgit\\s+switch\\s+-c\\s+[^\\s]+\\s+(?:${refAlternation})\\b`).test(cmd) ||
    new RegExp(`\\bgit\\s+branch\\s+[^\\s-][^\\s]*\\s+(?:${refAlternation})\\b`).test(cmd);

  if (cutFromProd) {
    deny(
      `Every branch is cut from '${BASE}', never from '${PROD}'. A branch based on production ` +
        'misses whatever has already been integrated, and silently reverts it on merge.',
      `git checkout ${BASE} && git pull && git checkout -b <name>`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Repo-specific denials from the config.
// ---------------------------------------------------------------------------
for (const rule of g.extraDeny ?? []) {
  try {
    if (new RegExp(rule.pattern).test(cmd)) deny(rule.reason, rule.instead);
  } catch {
    // A malformed pattern in the config must not break the guard for everything else.
  }
}

process.exit(0);
