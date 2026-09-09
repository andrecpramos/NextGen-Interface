---
description: Run every CI gate locally and report PASS/FAIL per gate with the actionable cause
allowed-tools: Bash, Read, Grep, Glob
---

Run this repo's gates locally and report. **Continue through failures** so the
report is complete — a run that stops at the first red gate hides the other four.

Do not fix anything while running. Diagnose, report, then let the user decide.

## 1 · Read the gate list

```bash
node -e "const c=require('./.claude/sdlc.config.json');for(const g of c.gates)console.log([g.id,g.blocking===false?'(advisory)':'(blocking)',g.expectNonZero?'(exit!=0 by design)':'',g.command].filter(Boolean).join(' | '))"
```

If `.claude/sdlc.config.json` does not exist, say so and stop — there is no gate list
to run. Suggest `/sdlc-init`.

## 2 · Run them in order

The array is ordered cheapest-first deliberately. Run it in that order so a
failing run fails fast.

Skip a gate whose `when` globs do not match anything in the working diff
(`git diff --name-only` plus untracked files), and report it as **SKIPPED** with
the reason — a silently skipped gate reads as a passing one.

**Respect `expectNonZero`.** A gate marked with it exits non-zero by design; its
real verdict comes from the comparison step that follows it. Reporting that exit
code as a failure is the single most common way this command produces a wrong
answer.

## 3 · Report

A table — gate → PASS / FAIL / SKIPPED — then, for each FAIL:

- the **first actionable error line**, not the whole log
- what it means
- the fix from the gate's `fix` field, verbatim if it has one

End with a one-line verdict: `MERGE-SAFE` or `BLOCKED — <what blocks it>`.

Advisory gates (`blocking: false`) never produce `BLOCKED`. Report them, name
them as advisory, and move on.

## When a gate fails in a way the config does not explain

Say so plainly rather than guessing at a fix. Then check the cheap causes in
order — they account for most of it:

1. Uncommitted generated files, or a stale lockfile
2. The command differs from what CI runs (compare character by character)
3. A dependency was added without an install
4. Environment: version, platform, locale, line endings

If the gate itself looks wrong — checking a path nothing writes, asserting
something no longer true — that is a finding worth more than the failure. Report
it as a gap for [.claude/docs/critical-infrastructure.md](../docs/critical-infrastructure.md)
rather than working around it.
