---
name: ship-it
description: Take finished work from a dirty working tree to a merged PR — run the gates, stage explicit paths, write a conventional commit, open the PR against the integration branch, and check the definition of done. Use whenever work is complete and needs committing, pushing, or a PR opened.
---

# Shipping

Finished work → gates → commit → PR. In that order, and the order is the point:
committing before the gates run means the gates get run on a commit you have
already mentally finished.

## 1 · Gates first

Run `/gates`, or delegate to the `gate-runner` agent to keep the output out of
your context.

**Do not proceed on a failing blocking gate.** Fix it or stop and report. An
advisory gate (`blocking: false`) can be noted and passed.

If you did not run the gates, say so explicitly in the PR body. A PR that implies
verification that did not happen is the expensive kind of dishonesty.

## 2 · Read the tree as it is *now*

```bash
git status --porcelain
git diff --stat
```

{{If `sharedTree` is true:}} **The tree may have moved since you last looked.**
Re-check immediately before staging — not five tool calls ago. A modified or
untracked file you did not create belongs to another session: leave it, do not
commit it, do not revert it, do not tidy it.

## 3 · Stage explicit paths

```bash
git add path/one path/two
```

{{If `sharedTree` is true:}} **Never `git add -A`, `git add .`, or
`git commit -a`.** The guard hook denies these; that denial is the contract, not
an obstacle to route around.

Verify what you staged before committing:

```bash
git diff --cached --stat
```

Staging a file you did not intend is easiest to catch here and hardest to catch
later.

## 4 · Commit

Conventional Commits, scope from `commits.scopes` in the config:

```
<type>(<scope>): <what changed, imperative, lowercase>

<why, if it is not obvious from the what. Wrap at 72.>
```

Write for someone bisecting six months from now. `fix: bug` costs its reader ten
minutes.

Append any `commits.trailers` from the config.

## 5 · Branch and PR

If on the integration branch with more than a trivial change, cut a branch first —
`{{featurePrefix}}<area>-<short-name>` — then push.

```bash
git push -u origin <branch>
gh pr create --base <integration> --title "..." --body "..."
```

**The base is the integration branch.** Never production, unless the user asked
for a release in this session, in words. The guard hook enforces this; if it
fires, it is right.

PR body:

```markdown
## What
{{one paragraph}}

## Why
{{the reason, or the issue}}

## Verification
{{gates run and their results — or, honestly, what was not run}}

## Notes for the reviewer
{{the non-obvious decision, the thing you are least sure about}}
```

The last section is worth the other three. A reviewer told where to look reviews
better than one told everything is fine.

## 6 · Definition of done

From `.ai/sdlc/planning.md`. Check it, and report honestly on anything not done —
the two items a project skips most are the two worth naming explicitly.

## What this skill will not do

- Merge the PR. That is the user's.
- Push to production, or open a PR into it, without an explicit release request in
  this session.
- Commit files it did not write, {{in a shared tree}}.
