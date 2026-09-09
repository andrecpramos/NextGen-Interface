# sdlc-kit

A portable SDLC for repositories worked on by AI agents. Copy this folder into a
project, point an agent at [INSTALL.md](INSTALL.md), and it surveys what is
already there, installs what is missing, and reports what is *claimed* but not
*enforced*.

It is not a methodology. It is a set of documents an agent reads, a config file
that describes the repo in machine terms, and hooks that make the rules hold when
nobody is watching.

## The four ideas it is built on

**1 · A written rule is obeyed until someone is in a hurry.**
Every rule in this kit is labelled with where it is actually enforced — a CI job,
a hook, a test, or nothing at all. The register that tracks this
([critical-infrastructure.md](ai/critical-infrastructure.md)) is the most valuable
document here, because it is the only one that admits what is not protected.
A green build that gates nothing is worse than no build, because people trust it.

**2 · An instruction is only followed by an agent that has read it.**
Which is exactly not the case at the start of a fresh context window. So the
branching contract is not a paragraph in a document — it is a `SessionStart` hook
that injects live git state, and a `PreToolUse` hook that denies the commands the
contract exists to prevent. Telling is necessary and not sufficient.

**3 · The config is the contract.**
Branch names, gate commands, denied operations and post-edit checks live in one
file, [`.ai/sdlc.config.json`](sdlc.config.schema.json). The hooks read it. The
slash commands read it. Nothing is hardcoded to one repository's names, which is
the whole reason this folder is importable.

**4 · Documents that lie are worse than missing documents.**
Every template here carries the survey questions that produced it, and the kit
ships a `docs-keeper` agent whose job is to verify claims against the tree rather
than tidy prose. Drift is the default state of a knowledge base; something has to
push back.

## What you get

```
sdlc-kit/
├── README.md                   ← you are here
├── INSTALL.md                  drop-in procedure, greenfield and brownfield
├── sdlc.config.schema.json     the machine-readable contract
├── examples/                   two filled configs — a trunk library, a two-trunk monorepo
│
├── ai/                         → copied to <repo>/.ai/
│   ├── README.md               map of the knowledge base
│   ├── project.md              what this is, current state, environment facts
│   ├── vision.md               why it exists, and what it refuses to be
│   ├── rules.md                the numbered invariant register
│   ├── architecture.md         layers, boundaries, the dependency rule
│   ├── coding-standards.md     structure and naming, language-neutral
│   ├── testing.md              strategy and thresholds
│   ├── security.md             threat model and review triggers
│   ├── critical-infrastructure.md   rule → enforcement → status, with the gaps
│   ├── agent-workflow.md       how agents decide where commits go
│   ├── sdlc/                   nine per-phase process definitions
│   ├── agents/                 six role briefs
│   └── decisions/              ADR format, template and index
│
└── claude/                     → merged into <repo>/.claude/
    ├── CLAUDE.template.md      the always-loaded contract
    ├── settings.json           hook wiring + a conservative permission set
    ├── hooks/                  three hooks, all config-driven
    ├── commands/               /gates /rules-check /handoff /sdlc-audit
    ├── skills/                 sdlc-bootstrap, sdlc-audit, ship-it, write-adr, new-feature
    └── agents/                 gate-runner, boundary-auditor, docs-keeper, sdlc-auditor
```

## What it assumes

- **Git.** The branching hooks are the core of the kit; without git they no-op.
- **Node 18+** on PATH, for the three hooks. Not for your project — for the hooks.
  They are Node rather than shell because `jq` is frequently absent from PATH on
  Windows machines that otherwise have a POSIX shell, and a hook that silently
  emits nothing looks exactly like a hook that works.
- Nothing else. No package manager, language, CI provider or test framework is
  assumed. The bootstrap detects them and writes them into the config.

## What it refuses to be

- **A CI provider.** It describes gates and runs them locally. Wiring them into
  GitHub Actions, GitLab CI or anything else is one generated workflow file and
  then your problem.
- **A replacement for judgement.** The templates contain questions, not answers.
  A bootstrap that invents a threshold is worse than one that leaves a `TODO`,
  because an invented number gets cited later as if it were measured.
- **A second source of truth.** `.claude/` is *how the work gets done*; `.ai/` is
  *what is true*. When they disagree, `.ai/` wins and the disagreement is a bug.
  Neither restates the other; they link.

## Portability caveats, stated plainly

| Thing | Status |
|---|---|
| Hooks (`branch-check`, `guard-git`, `check-gates`) | Fully config-driven. No edits needed. |
| Slash commands (`/gates`, `/rules-check`, `/handoff`, `/sdlc-audit`) | Read the config at run time. No edits needed. |
| Agents (`gate-runner`, `docs-keeper`, `sdlc-auditor`) | Generic. `boundary-auditor` needs the layer names from your architecture. |
| `ai/*.md` templates | Contain `{{PLACEHOLDERS}}` and `> **Survey:**` blocks. The bootstrap fills them; anything it cannot determine stays a visible `TODO`. |
| `ai/sdlc/requirements.md` | Deliberately near-empty. Requirements are the one thing that cannot be templated. |

## Provenance

Extracted from **NextGen Interface**, a repository where these rules were not
theoretical: the shared-tree staging rule exists because two agent sessions wrote
into the same working tree inside a four-minute window; the heredoc-stripping
detail in `guard-git.mjs` exists because the first version blocked its own
documentation; and the enforcement register exists because a CI gate was found
diffing a directory the build never wrote to, passing vacuously for weeks.

Those incidents are preserved in the templates as worked examples, marked as
such. They are the reason the rules are shaped the way they are, and a rule
without its incident tends to get optimised away.
