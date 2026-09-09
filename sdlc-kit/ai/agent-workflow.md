# Agent workflow — branch discipline

How agents working in this repository decide where their commits go.

This document is about the **branching** half of the agent workflow, which is the
part that actually bites. The full set of workflow assets — hooks, skills, agents
and slash commands — is mapped in [.claude/README.md](../.claude/README.md).

## The rule

**At the start of every new context window, the agent asks whether to keep working
on the current branch or cut a new one from `{{INTEGRATION}}` — and waits for the
answer before making any code change.**

Read-only work is exempt: a question, a review, an explanation that writes no
files does not need a branch. The question is asked once per context window, not
before every edit.

The branch it proposes is never arbitrary. The full policy, including how a
release is performed, is [sdlc/branching.md](sdlc/branching.md); the version the
agent receives every session is [CLAUDE.md](../CLAUDE.md); the version the
*tooling* reads is `.ai/sdlc.config.json`.

Those three must agree. They agree because the first two are generated from the
third — if you edit a branch name, edit it in the config.

## How it is enforced

A hook, not a convention. **An instruction in a document is only followed by an
agent that has already read the document**, which is precisely not the case at the
start of a fresh context window.

| File | Role |
|---|---|
| [`.claude/hooks/branch-check.mjs`](../.claude/hooks/branch-check.mjs) | Reads live git state, emits the instruction |
| [`.claude/hooks/guard-git.mjs`](../.claude/hooks/guard-git.mjs) | Denies the commands the instruction is meant to prevent |
| [`.claude/hooks/check-gates.mjs`](../.claude/hooks/check-gates.mjs) | Surfaces the cheapest gate an edit could have broken |
| [`.claude/settings.json`](../.claude/settings.json) | Binds them to lifecycle events |
| `.ai/sdlc.config.json` | The branch names, gates and denials all three read |

`SessionStart` matches `startup|resume|clear|compact` and `PreCompact` matches
`manual|auto`, so the check fires on every path that produces a new context
window: a fresh session, a resumed one, `/clear`, and both manual and automatic
compaction.

The hook injects **live state**, not a static reminder — current branch, position
relative to the integration branch, and the count of uncommitted files. An agent
told *"you are on `feature/x`, 3 ahead and 2 behind, 5 files uncommitted"* asks a
useful question. One told *"consider branching"* does not.

Its message is situational, and each branch class gets a different one: a refusal
on production, a soft nudge on the integration branch, ahead/behind counts on a
feature branch, and an explicit warning when a feature branch no longer contains
the tip of integration and would carry stale work on merge.

### The second layer: denying, not only telling

Telling an agent the contract is necessary and not sufficient — the instruction
sits at the top of a context window that fills up, and the mistake happens at the
bottom. `guard-git.mjs` runs on `PreToolUse` for `Bash` and denies:

| Denied | Because | Configured by |
|---|---|---|
| `git add -A`, `git add .`, `git commit -a` | The tree is shared; broad staging commits another session's work | `sharedTree` |
| Any push, merge or PR that writes to production | Production moves only on the user's explicit request, in that session | `branching.releaseOnRequestOnly` |
| Branching from production | A branch cut from production silently reverts integration work on merge | `guard.denyBranchFromProduction` |

Each denial names the correct alternative, so the agent retries without needing
the user. Read-only commands against production — `log`, `diff`, `show` — stay
allowed.

**One subtlety, learned the hard way: heredoc bodies are stripped before
matching.** The first version of this hook blocked its own documentation, because
a file being written with `cat > file <<'EOF'` contained the words
`git push origin main` inside the heredoc. Anything a heredoc carries is data the
shell never executes, so scanning it produces only false positives.

### The third layer: immediate feedback on edits

`check-gates.mjs` runs on `PostToolUse` for `Edit`/`Write` and surfaces the
cheapest gate the edit could have broken, driven by the `postEdit` list in the
config. It is **silent otherwise, deliberately**: a hook that comments on every
write becomes noise an agent learns to skim, which is worse than no hook at all.

Keep `postEdit` commands under a second. A slow post-edit hook makes every file
write feel expensive and gets disabled within a week.

### Implementation notes

Written in Node, not shell. An earlier version used `jq`, which **is not on PATH
on many Windows machines** that otherwise have a POSIX shell — the hook silently
emitted nothing and appeared to work. Silent success is the worst failure mode a
hook can have.

The scripts never exit non-zero and never throw: they swallow malformed stdin,
return cleanly outside a git work tree, and treat every git call as fallible. **A
`SessionStart` hook that errors blocks the session**, so failing open is the only
acceptable behaviour.

Verify by piping each payload shape they receive — `SessionStart`/`startup`,
`PreCompact`/`auto`, and non-JSON garbage — and confirming valid JSON out and
exit 0 in all three. The commands are in [INSTALL.md](../sdlc-kit/INSTALL.md) §4.

### Changing or disabling it

Review with `/hooks`. To disable one, delete its block from
`.claude/settings.json`. Note that a newly created `.claude/settings.json` may not
be picked up until `/hooks` is opened once or the session restarts — the settings
watcher only watches directories that already held a settings file when the
session began.

## Why this exists

**Long sessions drift.** Work that began as a focused change accretes across a
compaction boundary until a branch named for one thing contains three. The
compaction boundary is the natural place to ask, because it is exactly where the
agent loses the context that would have reminded it.

**Shared trees lose work.** {{Keep this section only if `sharedTree` is true.}}
More than one session works in this checkout at once. Files you did not touch
appear, change, and disappear mid-session. The discipline:

- **Never `git add -A` or `git commit -a`.** Stage explicit paths, always.
- **Re-check `git status` immediately before committing.** The tree may have moved
  since you last looked.
- A modified or untracked file you did not create belongs to someone else. Leave
  it. Do not commit it, revert it, or "clean it up".

The worked example from the repository this kit came from: while a CI change was
being implemented on one branch, another session wrote nine component files, a
modified manifest, and a lockfile-rewriting install into the **same working tree**
inside a four-minute window. Nothing was lost — because the CI work committed
named paths rather than `git add -A`. That is the discipline the hook makes
automatic.

## Related

- [../CLAUDE.md](../CLAUDE.md) — the contract as the agent receives it, every session
- [sdlc/branching.md](sdlc/branching.md) — the branching model in full
- [sdlc/ci-cd.md](sdlc/ci-cd.md) — what a branch must pass to merge
- [critical-infrastructure.md](critical-infrastructure.md) — whether any of this is actually enforced
