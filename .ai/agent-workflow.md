# Agent workflow — branch discipline

How agents working in this repository decide where their commits go.

## The rule

**At the start of every new context window, the agent asks whether to keep working
on the current branch or cut a new one from `develop` — and waits for the answer
before making any code change.**

Read-only work is exempt: a question, a review, an explanation that writes no files
does not need a branch. The question is asked once per context window, not before
every edit.

The branch it proposes is never arbitrary. This repository runs a two-trunk model
— `main` is production and moves only on the user's explicit instruction, `develop`
is integration and takes everything else. The full policy, including how a release
is performed, is [.ai/sdlc/branching.md](sdlc/branching.md); the version the agent
actually receives every session is [CLAUDE.md](../CLAUDE.md).

## How it is enforced

A hook, not a convention — an instruction in a document is only followed by an
agent that has already read the document, which is precisely not the case at the
start of a fresh context window.

| File | Role |
|---|---|
| [`.claude/hooks/branch-check.mjs`](../.claude/hooks/branch-check.mjs) | Reads live git state, emits the instruction |
| [`.claude/settings.json`](../.claude/settings.json) | Binds it to `SessionStart` and `PreCompact` |

`SessionStart` matches `startup|resume|clear|compact` and `PreCompact` matches
`manual|auto`, so the check fires on every path that produces a new context window:
a fresh session, a resumed one, `/clear`, and both manual and automatic compaction.

The hook injects **live state**, not a static reminder — current branch, position
relative to `develop`, and the count of uncommitted files. An agent told *"you are
on `wp-01-1b-validation`, 3 ahead and 2 behind develop, 5 files uncommitted"* asks a
useful question. One told *"consider branching"* does not.

Its message is situational, and each branch class gets a different one: a refusal
on `main`, a soft nudge on `develop`, ahead/behind counts on a feature branch, and
an explicit warning when a feature branch no longer contains the tip of `develop`
and would carry stale work on merge.

### Implementation notes

Written in Node, not shell. The first version used `jq`, which **is not on PATH on
this machine** even though Git Bash is — the hook silently emitted nothing and
appeared to work. Node is a hard dependency of this repo, so it is the safe choice.

The script never exits non-zero and never throws: it swallows malformed stdin,
returns cleanly outside a git work tree, and treats every git call as fallible. A
`SessionStart` hook that errors blocks the session, so failing open is the only
acceptable behaviour.

Verified by piping each payload shape it receives — `SessionStart`/`startup`,
`PreCompact`/`auto`, and non-JSON garbage — and confirming valid JSON out and exit 0
in all three.

### Changing or disabling it

Review it with `/hooks`. To disable, delete the `SessionStart` and `PreCompact`
blocks from `.claude/settings.json`. Note that a newly created
`.claude/settings.json` may not be picked up until `/hooks` is opened once or the
session is restarted — the settings watcher only watches directories that already
held a settings file when the session began.

## Why this exists

Two reasons, and the second one is not hypothetical.

**Long sessions drift.** Work that began as a focused change accretes across a
compaction boundary until a branch named for one work package contains three. The
compaction boundary is the natural place to ask, because it is exactly where the
agent loses the context that would have reminded it.

**This repository is worked on concurrently.** While WP-12 (CI/CD) was being
implemented on `wp-01-1b-validation`, another session was actively writing WP-08
(`packages/ui`) and WP-09 (`apps/web`) **into the same working tree** — nine new
component files, a modified `packages/ui/package.json`, and a `pnpm install` that
rewrote `pnpm-lock.yaml` mid-run, all within a four-minute window.

Nothing was lost, because the CI work committed named paths rather than `git add
-A`. That is the discipline the hook is there to make automatic:

- **Never `git add -A` or `git commit -a` in this repo.** Stage explicit paths.
- **Re-check `git status` immediately before committing.** The tree may have moved
  since you last looked.
- A dirty file you did not touch belongs to someone else. Leave it.

## Related

- [CLAUDE.md](../CLAUDE.md) — the contract as the agent receives it, every session
- [.ai/sdlc/branching.md](sdlc/branching.md) — main/develop policy and how a release is cut
- [.ai/sdlc/ci-cd.md](sdlc/ci-cd.md) — what gates a branch has to pass to merge
- [ADR-011](decisions/ADR-011.md) — why those gates are shaped the way they are
