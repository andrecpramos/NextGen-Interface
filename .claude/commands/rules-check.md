---
description: Audit the working tree against the numbered non-negotiable rules (docs/RULES.md)
allowed-tools: Bash, Read, Grep, Glob
---

Audit the current diff against the numbered rules. Read-only — report, never fix.

## 1 · Get the rules and the diff

```bash
git diff --stat
git status --porcelain
```

Read the rule register at the path in `docs.rules` from `.claude/sdlc.config.json`
(in this repo: `docs/RULES.md`). If it does not exist, say so and stop — there is
nothing to audit against, and inventing rules to check would be worse than
reporting none.

## 2 · Check only what the diff touches

For each rule, decide whether this diff could possibly violate it. Skip the rest
and say you skipped them. An audit that claims to have verified fifteen rules
against a two-file diff is not credible, and it hides the two that mattered.

For each rule in scope:

- **Verify mechanically where possible.** If the rule has a gate, run the gate —
  that is the ground truth, and your reading of the code is not.
- **Where there is no gate, read the actual code.** Not the docstring, not the
  test name, not the commit message.
- **State the evidence.** Name the `file:line` you checked. A verdict with no
  location is an opinion.

## 3 · Report

| Rule | Verdict | Evidence |
|---|---|---|
| {{N}} | PASS / **VIOLATION** / N/A / **UNVERIFIABLE** | `file:line` or the gate output |

`UNVERIFIABLE` is a real and useful verdict. Use it when a rule is stated in a
way that cannot be checked, and say what would make it checkable — that finding
is often worth more than the audit.

For each violation: what the rule requires, what the code does instead, and the
smallest change that would fix it. Do not make the change.

## 4 · Note the gaps

If a rule in scope is enforced by nothing — the register says `convention` —
report that alongside the verdict. A PASS on an unenforced rule means "it happens
to be right today", which is a different claim from "it cannot be wrong", and the
difference is the whole point of the register.
