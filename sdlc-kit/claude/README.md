# `.claude/` — the agent workflow

Version-controlled Claude Code configuration. This directory is **workflow**:
hooks that enforce, skills that encode procedure, commands that run on demand,
agents that take a job away into their own context.

It is deliberately **not** a knowledge base. That is `.ai/`, and duplicating it
here would create a third source of truth that drifts. Everything below links into
`.ai/` rather than restating it.

## Layout

```
.claude/
├── settings.json        # hook wiring + shared permissions (committed)
├── settings.local.json  # personal overrides (gitignored — never edited by agents)
├── hooks/               # automation the harness runs on lifecycle events
├── skills/              # <name>/SKILL.md — auto-selected task playbooks
├── agents/              # delegated, context-isolated workers
├── commands/            # /slash-commands: mechanical, on demand
└── README.md            # this file
```

## Where the truth lives

1. **`.ai/decisions/ADR-*.md`** — the constitution. Binding. Superseded ADRs stay
   in the tree with a forward-pointing `Status:`.
2. **`.ai/rules.md`** — the numbered invariants, each traced to its enforcement.
3. **`.ai/`** — architecture, security, testing, standards, SDLC process, role
   briefs. [`critical-infrastructure.md`](../.ai/critical-infrastructure.md) is the
   one to read before assuming a rule is protected: it maps every rule to the gate,
   hook or test actually holding it up, and lists the gaps.
4. **`.ai/sdlc.config.json`** — the machine-readable version. Every hook and
   command below reads it; nothing here hardcodes a branch name or a gate command.
5. **`.claude/`** — how the work gets done. Never contradicts the above.

Where a document and an ADR disagree, the ADR wins and the disagreement is a bug.

## Hooks — the part you do not have to remember

| Hook | Fires | Does |
|---|---|---|
| `branch-check.mjs` | `SessionStart`, `PreCompact` | Injects live branch state and the branching contract into every new context window. An instruction in a document is only followed by an agent that has read it — which is exactly not the case at the start of a fresh session. |
| `guard-git.mjs` | `PreToolUse` on `Bash` | Denies broad staging (shared trees), writes to production, and branching from production. Each denial names the correct alternative. **Heredoc bodies are stripped before matching**, so documentation that *mentions* those commands is not blocked. |
| `check-gates.mjs` | `PostToolUse` on `Edit`/`Write` | Runs the cheapest gate the edit could have broken, from `postEdit` in the config. Silent otherwise — a hook that comments on everything becomes noise an agent learns to skim. |

All three are config-driven and fail open: they swallow malformed input, return
cleanly outside a git work tree, and never exit non-zero. **A `SessionStart` hook
that errors blocks the session**, so that is the only acceptable behaviour.

Review with `/hooks`. To disable one, delete its block from `settings.json`.
A newly created `settings.json` may not be picked up until `/hooks` is opened once
or the session restarts — the watcher only watches directories that already held a
settings file when the session began.

## Skills — invoked automatically when the task matches

| Skill | For |
|---|---|
| `sdlc-bootstrap` | Install or improve the SDLC: survey, config, install, and the ranked gap list. |
| `new-feature` | The development loop: branch, contract first, failing test, implement, gates, ship. |
| `ship-it` | Finished work → gates → explicit staging → conventional commit → PR. |
| `write-adr` | An architectural choice was made. Includes the reversibility test for whether one is owed. |

## Agents — delegated work in their own context

| Agent | For |
|---|---|
| `gate-runner` | Run the whole gate set, return a PASS/FAIL verdict. Backgroundable; never edits. |
| `sdlc-auditor` | What is claimed vs what is enforced. Returns the ranked gap list. |
| `boundary-auditor` | Review a change against the layer boundaries and the rules. |
| `docs-keeper` | Find and fix doc drift, verified against the tree rather than against other documents. |

## Commands — mechanical, on demand

| Command | Does |
|---|---|
| `/gates` | Runs every gate locally, reports PASS/FAIL with causes. |
| `/rules-check` | Audits the working diff against the numbered rules. |
| `/sdlc-audit` | Finds every rule that is written down and enforced by nothing. |
| `/handoff` | End-of-session: state, drift, and exactly where the next session picks up. |

## The two ideas underneath all of it

**Telling is necessary and not sufficient.** The instruction sits at the top of a
context window that fills up; the mistake happens at the bottom. Hence a guard
that denies, not only a document that explains.

**A written rule is obeyed until someone is in a hurry.** Hence
[critical-infrastructure.md](../.ai/critical-infrastructure.md), which never claims
protection that does not exist, and `/sdlc-audit`, which keeps it honest.
