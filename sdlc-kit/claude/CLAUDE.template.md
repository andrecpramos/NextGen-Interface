# CLAUDE.md

Instructions for any AI agent working in this repository. Loaded automatically
every session. This file is about **process** — what is true about the system
lives in [.ai/](.ai/), and the binding decisions are the ADRs in
[.ai/decisions/](.ai/decisions/).

Keep this file short. It is loaded into every session, so every line costs context
on every task. If something is needed only sometimes, it belongs in `.ai/` or in a
skill, and this file links to it.

## Branching — binding

```
{{PRODUCTION}}    production. Release only.
  ^
  | merge ONLY when the user explicitly asks for a release
  |
{{INTEGRATION}}   integration. Default branch. Everything lands here.
  ^
  | PR
  |
<feature>         cut FROM {{INTEGRATION}}, merges back INTO {{INTEGRATION}}
```

1. **`{{PRODUCTION}}` is production. Never commit, merge, push or open a PR to it
   on your own initiative.** It moves only when the user asks for a release, in
   that session, in words. "The work is finished" is not such a request.
2. **`{{INTEGRATION}}` is where all work lands.** It is the host's default branch,
   so a PR opened without an explicit base already targets it correctly.
3. **Every new branch is cut from `{{INTEGRATION}}`** — never from
   `{{PRODUCTION}}` — and merges back into `{{INTEGRATION}}`.
4. Before making any code change in a new context window, **ask whether to stay on
   the current branch or cut a new one**, and wait. Read-only work — questions,
   reviews, explanations that write no files — is exempt.

A `SessionStart`/`PreCompact` hook restates this with live branch state. Full
policy: [.ai/sdlc/branching.md](.ai/sdlc/branching.md). How it is enforced:
[.ai/agent-workflow.md](.ai/agent-workflow.md).

## This tree is shared

{{Delete this whole section if `sharedTree` is false. Keeping it when it is not
true trains agents to ignore the file.}}

More than one agent session works in this checkout at the same time. Files you did
not touch appear, change, and disappear mid-session.

- **Never `git add -A` or `git commit -a`.** Stage explicit paths, always.
- **Re-check `git status` immediately before committing** — the tree may have
  moved since you last looked.
- A modified or untracked file you did not create belongs to someone else. Leave
  it. Do not commit it, revert it, or "clean it up".

## Before you push

CI gates these; running them locally first is faster than a red build.

```bash
{{the gates[].command list from .ai/sdlc.config.json, cheapest first}}
```

`/gates` runs all of this and reports PASS/FAIL per gate, or delegate it to the
`gate-runner` agent to keep it out of your context.

**Which rule is actually enforced where** — and which are only written down — is
the register in
[.ai/critical-infrastructure.md](.ai/critical-infrastructure.md). Read it before
trusting that something is protected.

## The workflow is in `.claude/`

Don't re-derive these procedures — they are written down, and they encode mistakes
this repo has already made. Full map: [.claude/README.md](.claude/README.md).

| You are… | Use |
|---|---|
| adding or changing {{the main unit of work}} | `new-feature` skill |
| making an architectural choice | `write-adr` skill — the reversibility test is in it |
| finishing work: gates → commit → PR | `ship-it` skill |
| checking a diff against the rules | `/rules-check` |
| asking what is actually enforced | `/sdlc-audit`, or the `sdlc-auditor` agent |
| ending a session | `/handoff` |
| suspicious the docs have drifted | `docs-keeper` agent |
| {{project-specific task}} | {{project-specific skill}} |

Hooks enforce what you would otherwise have to remember: the branching contract at
every context boundary, a guard on the git commands that break it, and an
immediate gate check on edits that could break one. Review them with `/hooks`.

## Environment

{{The facts that are true on this machine and not in the manifest — the ones that
cost an afternoon to rediscover. Real examples worth the shape:}}

- {{**Runtime X.Y+ required**, despite `engines` saying otherwise — install
  succeeds and everything fails at run time.}}
- {{A fresh clone needs `<the non-obvious install command>`, because <reason>. A
  populated working checkout hides this.}}
- {{`<tool>` is **not** on PATH here. Use `<alternative>` in scripts and hooks.}}
- {{Files that carry a BOM / CRLF / other encoding trap, and what rejects them.}}

This section is worth more than any other in this file. Everything above is
process an agent could infer; this is the part it cannot.
