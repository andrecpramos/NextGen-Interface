# `.ai/` — the knowledge base

What is **true** about this project. `.claude/` is how the work gets done; this is
what the work is done against. Neither restates the other — they link.

Where this directory and an ADR disagree, **the ADR wins** and the disagreement is
a bug to be fixed, not a difference of opinion.

## Map

| File | Answers |
|---|---|
| [project.md](project.md) | What this is, what state it is in, what is verified vs assumed |
| [vision.md](vision.md) | Why it exists, and what it refuses to become |
| [rules.md](rules.md) | The numbered invariants. Each one traced to its enforcement |
| [architecture.md](architecture.md) | The layers, the dependency rule, how they talk |
| [coding-standards.md](coding-standards.md) | Structure, naming, the conventions that are checkable |
| [testing.md](testing.md) | Strategy and thresholds — the *what* |
| [security.md](security.md) | Threat model, review triggers, what is out of scope |
| [critical-infrastructure.md](critical-infrastructure.md) | **Rule → enforcement → status.** Read this before assuming anything is protected |
| [agent-workflow.md](agent-workflow.md) | How agents decide where their commits go |
| [sdlc/](sdlc/) | Per-phase process — the *how* and *when* |
| [agents/](agents/) | Role briefs. Read the one matching the work you are doing |
| [decisions/](decisions/) | ADRs. The constitution |
| `sdlc.config.json` | The machine-readable version of all of it. Hooks and commands read this |

## The rule that keeps this honest

**Every claim here is verifiable against the tree, or it is labelled as a plan.**

A knowledge base drifts by default: code moves, documents don't. Three things
push back —

1. Each document carries an **audit date** in its header. A date older than the
   last significant change to what it describes is a warning.
2. `critical-infrastructure.md` distinguishes *written down* from *enforced*, and
   never claims protection that does not exist.
3. The `docs-keeper` agent verifies claims against the tree rather than against
   other documents, which is the failure mode that produces a consistent and
   entirely wrong knowledge base.

If you find a document that is wrong, fixing it is in scope for whatever you were
already doing. Leaving it is how the next person stops trusting all of them.

## For an agent reading this cold

Read in this order, and stop when you have what you need:

1. `project.md` — where things stand
2. `rules.md` — what you must not break
3. The `agents/` brief matching your task
4. The `sdlc/` phase you are in

Do not read all of it. A full pass costs more context than most tasks are worth,
and the parts you need are the four above.
