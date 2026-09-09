# sdlc-kit

A portable SDLC for repositories worked on by AI agents. Copy this folder into a
project, point an agent at [BOOTSTRAP.md](BOOTSTRAP.md), and it surveys what is
already there, generates what is missing, and reports what is *claimed* but not
*enforced*.

It is not a methodology and not a file drop. It is a **method**, a config schema,
and four hooks.

## What it installs into

One directory: **`.claude/`**. Workflow and knowledge live together, because
splitting them creates a "which folder does this go in?" question that nobody
answers consistently.

```
.claude/
├── settings.json      hook wiring + permissions
├── sdlc.config.json   the machine-readable contract — hooks and commands read this
├── hooks/             enforcement: branch contract, git guard, post-edit gates
├── skills/            generated procedures, auto-selected by task
├── agents/            generated subagents, delegated work
├── commands/          generated slash-commands
├── decisions/         ADRs — the constitution
├── sdlc/              per-phase process definitions
├── roles/             role briefs (architect, backend, QA, …)
└── docs/              architecture, security, testing, rules, lessons, …
```

`docs.root` in the config can point elsewhere (`.ai/`, `docs/`) if a repo prefers
a tool-agnostic knowledge base. The hooks accept either.

## The four ideas it is built on

**1 · A written rule is obeyed until someone is in a hurry.**
Every rule gets labelled with where it is *actually* enforced — a CI job, a hook,
a test, or nothing. The register that tracks this is the most valuable thing the
kit produces, because it is the only document that admits what is not protected.
A green build that gates nothing is worse than no build, because people trust it.

**2 · An instruction is only followed by an agent that has read it.**
Which is exactly not the case at the start of a fresh context window. So the
branching contract is not a paragraph — it is a `SessionStart` hook injecting live
git state, and a `PreToolUse` hook denying the commands the contract exists to
prevent. Telling is necessary and not sufficient.

**3 · The config is the contract.**
Branch names, gate commands, denied operations and post-edit checks live in one
file that the hooks and commands read. Nothing is hardcoded to one repo's names.

**4 · Generate, don't copy.**
An earlier version shipped a ready-made `.claude/`. Within one session of use,
**10 of its 18 files had diverged** — every divergence a legitimate adaptation to
the repo it landed in. Copying produces drift; generating produces fit. So the kit
ships [patterns/](patterns/), not products.

## Layout

```
sdlc-kit/
├── README.md                  you are here
├── BOOTSTRAP.md               the binding install procedure
├── sdlc.config.schema.json    the contract
│
├── runtime/                   copied verbatim — genuinely universal
│   ├── hooks/                 4 config-driven hooks
│   └── settings.json          hook wiring to merge into the target
│
├── patterns/                  the method — read, don't copy
│   ├── workflow.md            deciding which skills/agents/commands to generate
│   └── enforcement.md         the claimed-vs-enforced audit
│
├── templates/                 doc scaffolds, mirroring the .claude/ layout
│   ├── docs/  sdlc/  decisions/  roles/
│
└── examples/                  two filled configs
```

**`runtime/` is the only thing copied verbatim.** The hooks are config-driven, so
they are identical in every repo forever. Everything else is read and adapted.

## What it assumes

- **Git.** The branching hooks are the core; without git they no-op.
- **Node 18+** on PATH — for the hooks, not for your project. They are Node rather
  than shell because `jq` is frequently absent from PATH on Windows machines that
  otherwise have a POSIX shell, and a hook that silently emits nothing looks
  exactly like a hook that works.
- Nothing else. No package manager, language, CI provider or test framework is
  assumed; the bootstrap detects them.

## What it refuses to be

- **A CI provider.** It describes gates and runs them locally. Wiring them into
  your CI is one generated workflow file and then your problem.
- **A replacement for judgement.** Templates contain questions, not answers. A
  bootstrap that invents a threshold is worse than one leaving a `TODO`, because
  an invented number gets cited later as if it were measured.
- **A source of truth.** After install, the generated files are yours. The kit
  does not sync, update, or own them.

## Provenance

Extracted from a repository where these rules were not theoretical: the
shared-tree staging rule exists because two agent sessions wrote into the same
working tree inside a four-minute window; the heredoc-stripping in `guard-git.mjs`
exists because the first version blocked its own documentation; and the
enforcement register exists because a CI gate was found diffing a directory the
build never wrote to, passing vacuously for weeks.

Those incidents are preserved in the templates as worked examples. A rule without
its incident tends to get optimised away.
