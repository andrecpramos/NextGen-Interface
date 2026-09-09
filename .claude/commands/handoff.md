---
description: Write the end-of-session handoff — state, drift, and exactly where the next session picks up
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Write the handoff for the next session, which starts with **none** of this
context. Assume it knows nothing about what happened here.

## 1 · Establish the actual state

```bash
git status --porcelain
git log --oneline -12
git diff --stat
```

Distinguish three things and never merge them:

- **Committed** — done and durable
- **Uncommitted but yours** — done, at risk, and the next session must be told
- **Uncommitted and not yours** — another session's work.
  Name it as theirs and leave it alone

## 2 · Verify before claiming

Run `/gates`, or state plainly that you did not.

**Do not report work as complete on the strength of having written it.** "The
tests pass" is a claim about a command that was run; if it was not run, the
honest sentence is "tests written, not run". A handoff that overstates is worse
than no handoff, because the next session builds on it.

## 3 · Write the handoff

Update the living plan document (`docs.plan` in `.claude/sdlc.config.json`) if there
is one; otherwise put it in the session summary.

```markdown
## Session handoff — {{DATE}}

**Branch:** `{{branch}}` ({{n}} ahead of develop, {{clean|N files dirty}})

**Done and committed**
- {{what, and the commit}}

**Done, not committed**
- {{what, which paths, why it is not committed yet}}

**Verified how**
- {{the gates that were actually run, and their result}}
- {{what was NOT verified, and why}}

**Next session starts here**
1. {{The single first action, as a command or a file path.}}
2. {{Then...}}

**Blocked / needs a decision**
- {{what, who can answer it, and what it blocks}}

**Doc drift noticed**
- {{document → what is now wrong about it. Noticed but not fixed is fine and
  worth recording; the next session can decide.}}
```

## 4 · Offer to commit

Do not commit on your own initiative. Ask, and if yes:

**re-check `git status` immediately first** — it may
have moved since step 1 — and stage explicit paths only.

## The line that matters

**"Next session starts here"** is the one item this document exists for. It is a
command or a file path, not a description of an area. If you cannot make it that
concrete, say what is blocking that clarity — that is itself the handoff.
