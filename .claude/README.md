# `.claude/` — everything the work needs

One directory. Workflow *and* knowledge, because splitting them creates a "which
folder does this go in?" question nobody answers consistently.

Where a document and an ADR disagree, **the ADR wins** and the disagreement is a
bug.

## Layout

```
.claude/
├── settings.json        hook wiring + shared permissions (committed)
├── settings.local.json  personal overrides (gitignored — yours, not touched by agents)
├── sdlc.config.json     the machine-readable contract: branches, gates, guards
│
├── hooks/               enforcement the harness runs on lifecycle events
├── skills/              task playbooks, auto-selected by description
├── agents/              delegated, context-isolated workers
├── commands/            /slash-commands, mechanical and on demand
│
├── decisions/           ADRs — the constitution. 16 of them
├── sdlc/                per-phase process definitions + agent-workflow
├── roles/               role briefs: architect, backend, frontend, qa, devops, ai-engineer
└── docs/                architecture, security, testing, standards, rules, lessons, …
```

## Where the truth lives

1. **[`decisions/`](decisions/)** — binding. Superseded ADRs stay with a
   forward-pointing `Status:`. Cited from production source — `cascade.ts`,
   `money.ts`, `core-capability/src/types.ts`.
2. **[PLAN.md](../PLAN.md) §2** — the seventeen non-negotiable rules. Their
   enforcement is mapped in the register below, not restated here.
3. **[`docs/critical-infrastructure.md`](docs/critical-infrastructure.md)** — read
   this before assuming a rule is protected. It maps every rule to the gate, hook
   or test holding it up, and lists the gaps. It never claims protection that does
   not exist.
4. **[`docs/lessons.md`](docs/lessons.md)** — mistakes this repo has already made,
   and the enforcement level each one reached.
5. **[`sdlc.config.json`](sdlc.config.json)** — the machine-readable version.
   Every hook and command reads it; nothing hardcodes a branch name or a gate.

## Hooks — the part you do not have to remember

| Hook | Fires | Does |
|---|---|---|
| [`branch-check.mjs`](hooks/branch-check.mjs) | `SessionStart`, `PreCompact` | Injects live branch state and the branching contract into every new context window. An instruction in a document is only followed by an agent that has read it — which is exactly not the case at the start of a fresh session. |
| [`guard-git.mjs`](hooks/guard-git.mjs) | `PreToolUse` on `Bash` | Denies broad staging (this tree is shared), writes to production, branching from production, and `registry:build:finance`. **Heredoc bodies and `echo` arguments are stripped before matching**, so documentation that *mentions* those commands is not blocked. |
| [`check-gates.mjs`](hooks/check-gates.mjs) | `PostToolUse` on `Edit`/`Write` | Runs the cheapest gate the edit could have broken. Rule 1 on a `core-*` write (~75ms), the codegen reminder on `capabilities.ts`, the calibration lesson on `eval/`. Silent otherwise — a hook that comments on everything becomes noise. |

All three read `sdlc.config.json` and **fail open**: they swallow malformed input,
return cleanly outside a git work tree, and never exit non-zero. A `SessionStart`
hook that errors blocks the session.

Review with `/hooks`. A newly created `settings.json` may not be picked up until
`/hooks` is opened once or the session restarts.

## Skills — invoked automatically when the task matches

| Skill | For |
|---|---|
| [`add-capability`](skills/add-capability/SKILL.md) | A new or changed capability: declaration, codegen, golden set, and the check that it did not crowd its neighbours. **The most common task in this repo.** |
| [`new-domain`](skills/new-domain/SKILL.md) | A whole new domain package. The platform thesis under test — how little code, and did `core-*` have to change. |
| [`router-regression`](skills/router-regression/SKILL.md) | Accuracy dropped. Diagnose from the scorecard, fix at the declaration, **never** by raising a threshold. |
| [`new-feature`](skills/new-feature/SKILL.md) | The generic development loop, for work that is not a capability. |
| [`ship-it`](skills/ship-it/SKILL.md) | Finished work → gates → explicit staging → conventional commit → PR into `develop`. |
| [`write-adr`](skills/write-adr/SKILL.md) | An architectural choice was made. Includes the reversibility test. |
| [`sdlc-bootstrap`](skills/sdlc-bootstrap/SKILL.md) | Install this SDLC into another repo. Needs the `sdlc-kit` folder, which lives **outside this repo** — ask the user for its path. |

## Agents — delegated work in their own context

| Agent | For |
|---|---|
| [`gate-runner`](agents/gate-runner.md) | Run the whole gate set, return PASS/FAIL. Backgroundable; never edits. |
| [`sdlc-auditor`](agents/sdlc-auditor.md) | What is claimed vs what is enforced. Returns the ranked gap list. |
| [`boundary-auditor`](agents/boundary-auditor.md) | Review a change against Rule 1 and the layer boundaries. |
| [`docs-keeper`](agents/docs-keeper.md) | Doc drift, verified against the tree rather than against other documents. |
| [`router-analyst`](agents/router-analyst.md) | Investigate router behaviour — a failing golden set, a bucket that dropped, stage mix, latency. |

## Commands

| Command | Does |
|---|---|
| `/gates` | Runs every gate locally, PASS/FAIL with causes. |
| `/rules-check` | Audits the working diff against the seventeen rules. |
| `/sdlc-audit` | Finds every rule written down and enforced by nothing. |
| `/handoff` | End-of-session: state, drift, where the next session picks up. |

## Two facts that shape all of this

**The working tree is shared.** More than one session works in this checkout at
once. Stage explicit paths, re-check `git status` immediately before committing,
and leave dirty files you did not create alone. Not theoretical — see
[`docs/lessons.md`](docs/lessons.md).

**Nothing here can block a merge.** Branch protection is unavailable on this
repository's plan, so every CI gate is advisory in the mechanical sense and the
local hooks are the only layer that actually denies anything — and they bind
agents, not humans. Detail in
[`docs/critical-infrastructure.md`](docs/critical-infrastructure.md) §0.

## Related

- [../CLAUDE.md](../CLAUDE.md) — the always-loaded contract
- [../PLAN.md](../PLAN.md) — §2 the rules, §7 the work packages
- `sdlc-kit` — the portable version of all this, kept outside this repo so it can be reused across projects. Not tracked here.
