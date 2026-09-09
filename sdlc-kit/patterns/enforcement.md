# The enforcement audit

The method behind the kit's most valuable output: **what does this repo claim, and
what does it actually enforce?**

Everything else the kit installs is setup. This is the deliverable.

## The premise

> A written rule is obeyed until someone is in a hurry.

Most repositories state more rules than they enforce, and nobody has a list of
which is which. That gap is invisible until the moment it costs something, because
a rule and an enforced rule look identical in a document.

An audit that produces "12 claims, 4 enforced, 8 convention — here are the 8,
ranked" is worth more than any amount of new tooling, because it tells you where
the next hour of tooling should go.

## The one question

For every claim the repo makes, ask:

> **What would fail if someone broke this?**

| Answer | Status |
|---|---|
| A CI job that blocks a merge | enforced |
| A test that would fail | enforced |
| A hook that would deny it | enforced |
| A type that would not compile | enforced |
| A gate that runs but does not block | partial |
| "Review would catch it" | **convention** |
| Nothing | **convention** |

"Code review" is not enforcement. It is a convention with better public relations.

## Where claims hide

Four places, in descending order of authority:

1. **ADRs** — binding by construction
2. **README / CONTRIBUTING / CLAUDE.md** — stated
3. **CI job names** — implied
4. **Code comments saying "never do X"** — discovered

The fourth is the most under-harvested. A `// never do X` comment is a rule
someone cared enough to write *at the point of temptation*. It belongs on the
register.

```bash
grep -rn -iE '(never|must not|do not|always) (import|commit|edit|call|use|push)' \
  --exclude-dir=node_modules --exclude-dir=.git .
```

## Two traps that look exactly like enforcement

### The vacuous gate

It runs. It reports green. It checks nothing.

A real example from this kit's origin repo: a CI step named *"generated artefacts
are current"* ran the build for domain A and then diffed the output directory of
domain B — files that build never writes. It passed on every PR for weeks while
real drift went completely ungated. Nothing was broken. The job was green. The
check was decorative.

**How it happens:** a path is renamed, a glob stops matching, an assertion runs
over an empty collection, a filter excludes everything. None of these fail — they
all pass, faster than before.

**How to catch it:** verify the gate *reads what it claims to read*. Name the
path, symbol, or fixture in the register. A job name is marketing; the `run:`
lines are the truth.

**The general defence:** make every gate fail on purpose once, and record that you
did. A gate nobody has seen fail is a gate nobody knows works. This is the only
one of these habits that produces evidence rather than confidence.

### The blocking claim that isn't

A CI job blocks a merge **only if branch protection requires it.** Otherwise it
goes red and the merge button still works.

Another real example: a repo whose branching policy named a CI job as its
repository-level enforcement layer. Branch protection returned *403 — unavailable
on a private repository on this plan.* The job failed the run and prevented
nothing. Every "blocking" claim in that repo's documentation was policy, not
mechanism — a meaningful difference nobody had checked.

Verify, or mark it `partial` and say you could not.

## Ranking the gaps

**Blast radius first, cost to fix second.** Not by ease — the easy ones get done
anyway. The ranking exists to surface what is expensive *and* unprotected.

| # | Gap | Blast radius | Cheapest fix | Effort |
|---|---|---|---|---|

Every row names a fix **a single session could implement**. "Improve test
coverage" is not a row. "Add `check-x.mjs` to the gate list and make it fail on
the known-bad fixture" is.

For blast radius, answer two things: what silently goes wrong, and **how long
before anyone notices**. The second is what makes the ranking honest — a failure
discovered in a minute is not the same risk as one discovered by a user in a
month.

## Reporting

Lead with the count: *"N claims, M enforced, K convention."*

**Do not editorialise about the ratio.** A young repo with three enforced rules
out of twelve is in a completely normal state. The point is not that the number is
bad; it is that the repo now knows which nine are unprotected. That is the entire
value.

End with one next action — the single cheapest fix with the largest blast radius,
as a command or a file. Not a list. A list gets deferred; one action gets done.

## Keeping it honest

The register goes stale like anything else. Three habits:

- **Re-audit on any CI change, any new gate, any new rule, and at every release.**
- **Never claim protection that does not exist.** A register that overstates
  coverage is worse than no register, because it converts an unknown risk into a
  false assurance.
- **When a rule graduates from convention to gate**, update the register, the rule
  list, and the "seen failing" table in the same commit.
