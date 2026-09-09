---
description: Find every rule that is written down but enforced by nothing, and rank the gaps
allowed-tools: Bash, Read, Grep, Glob
---

The audit this whole kit exists for: **what does this repo claim, and what does it
actually enforce?**

Read-only. Produces a ranked gap list, and updates
`.claude/docs/critical-infrastructure.md` if the user asks.

## 1 · Collect every claim

Rules are stated in more places than the rule register. Search all of them:

```bash
sed -n "/^## 2/,/^## 3/p" PLAN.md   # this repo: rules live in PLAN.md §2
cat .claude/sdlc.config.json 2>/dev/null
ls .claude/decisions/ 2>/dev/null
cat CLAUDE.md README.md CONTRIBUTING.md 2>/dev/null
ls .github/workflows/ .gitlab-ci.yml Jenkinsfile 2>/dev/null
```

Also grep the code for rules that only exist as folklore:

```bash
grep -rn --include='*.*' -iE '(never|must not|do not|always) (import|commit|edit|call|use|push)' \
  --exclude-dir=node_modules --exclude-dir=.git . | head -40
```

A "never do X" comment is a rule someone cared enough to write at the point of
temptation. It belongs on the register.

## 2 · Find each claim's enforcement

For every claim, answer **one** question: *what would fail if someone broke this?*

| Answer | Status |
|---|---|
| A named CI job that blocks a merge | **enforced** |
| A test that would fail | **enforced** |
| A hook that would deny it | **enforced** |
| A gate that runs but does not block | **partial** |
| "Code review would catch it" | **convention** |
| Nothing | **convention** |

Two traps to check for explicitly, because both look like enforcement:

**A gate that passes vacuously.** It runs, reports green, and checks nothing —
diffing a directory the build never writes to, globbing a path that matches no
files, asserting on an empty collection. Verify the gate reads what it claims to
read. This is the failure mode the register was invented for.

**A blocking claim that isn't.** A CI job only blocks a merge if branch
protection requires it. Check, or mark it `partial` and say you could not verify.

## 3 · Rank the gaps

By **blast radius first, cost to fix second**. The easy ones get done anyway; the
ranking exists to surface the expensive-and-unprotected ones.

| # | Gap | Blast radius | Cheapest fix | Effort |
|---|---|---|---|---|

Every row names a fix a single session could implement. "Improve coverage" is not
a row; "add `check-x.mjs` to the gate list and make it fail on the known-bad
fixture" is.

## 4 · Report

Lead with the count: *"N claims, M enforced, K convention."* Then the ranked
table, then the single cheapest fix with the largest blast radius, named as a
command or a file.

Do not editorialise about the ratio. A young repo with three enforced rules out of
twelve is in a normal state; the point is that it now knows which nine.

## 5 · Offer

Ask whether to write the findings into `.claude/docs/critical-infrastructure.md` and to
implement the top gap. Both are changes — neither happens without a yes.
