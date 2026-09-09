# Generating the workflow

The kit ships **no pre-built skills, agents or commands**, and that is deliberate.

An earlier version did ship them, as a `claude/` directory copied into the
adopting repo. Within a single session of using it, **10 of 18 copied files had
diverged** from their originals — every divergence a legitimate adaptation to the
repo they landed in. A boundary-auditor that does not know your layer names
produces generic findings; a `new-feature` skill that does not know your codegen
step describes somebody else's loop.

So the kit ships the *method*. You generate what this repo needs.

## The rule

**Generate a workflow asset when it encodes something this repo knows that a
competent agent would otherwise get wrong.** Not one per category, not one per
template — one per genuine piece of repo-specific knowledge.

A repo with three real procedures is served by three skills. Six generic ones
teach the reader that the directory is decorative.

---

## Choosing the form

Four mechanisms, and picking the wrong one is the most common mistake. They differ
in **when they reach the agent**, which is the only thing that matters.

| Form | Reaches the agent | Use when |
|---|---|---|
| `CLAUDE.md` | **Every session, always** | It is needed for almost any task. Costs context on every task — keep it short. |
| Hook | At the moment of the action | You need to *deny* something, or deliver a warning exactly when it is relevant. |
| Skill | When the task matches its description | A multi-step procedure. The agent pulls it in only when doing that kind of work. |
| Agent | On explicit delegation | The job produces a lot of output the caller does not need — gate runs, audits, sweeps. |
| Command | When the user types it | Mechanical, on demand, user-initiated. |

The ordering insight: **a hook is stronger than a skill, which is stronger than a
document.** A document is read by an agent that already suspects a problem. A hook
fires whether or not anyone suspected anything.

Push each piece of knowledge as far up that list as it will go.

---

## What to generate, by repo shape

Survey first ([BOOTSTRAP.md](../BOOTSTRAP.md) Phase 1), then generate only what
the survey justifies.

### Always worth generating

| Asset | Form | Justified when |
|---|---|---|
| `/gates` | command | there is more than one gate. Which is always. |
| `gate-runner` | agent | gates are slow or verbose enough that the output would crowd a session |
| `ship-it` | skill | the repo has any commit/PR convention worth following |
| `/handoff` | command | sessions are long enough to end mid-task. Which is always. |

### Generate when the survey says so

| Asset | Generate when the survey found… | Skip when… |
|---|---|---|
| `write-adr` skill | an ADR directory, or decisions worth recording | the repo is small and reversible throughout |
| `boundary-auditor` agent | **a layer boundary a gate enforces** — name the real layers in it | there is no boundary, or nothing checks it |
| `new-feature` skill | a non-obvious development loop — codegen, a declaration step, a fixture to regenerate | the loop is "edit, test, commit" |
| `/rules-check` | a numbered rule register | rules are informal |
| `sdlc-auditor` agent | any rule stated but unenforced | greenfield with nothing claimed yet |
| `docs-keeper` agent | documentation that code references | docs are a single README |
| domain-specific skills | a recurring task with a written procedure | — |

### Generate a domain-specific skill when

The repo has a task that is done repeatedly, has a **correct order**, and has a
step people skip. That third condition is what makes it worth writing: a skill is
most valuable at the step everyone forgets.

Name the two most-skipped steps explicitly inside it. Vague completeness
checklists get skimmed; "the two people actually skip are X and Y" gets read.

---

## Writing one that works

**Description is the selector.** For a skill, the `description` frontmatter is the
*only* thing deciding whether it loads. Write it as the situations that should
trigger it, in the words a user would use — not as a summary of the contents.

Weak: `description: Guidance for adding capabilities.`
Strong: `description: Add, change or remove a capability — the declaration, codegen, golden-set entries, and the check that it did not crowd an existing one. Use when a new thing the assistant can DO is introduced, or when a capability's description, triggers or params change.`

**Encode the failure, not the happy path.** The value of a repo-specific skill is
the sentence that begins *"the mistake here is…"*. If a skill contains nothing an
agent would have got wrong, delete it — it is costing context to say the obvious.

**Name the real commands.** Exactly what CI runs, character for character. A skill
whose commands differ from CI teaches the agent a workflow that fails in CI.

**Say what the skill will not do.** Boundaries prevent the agent taking an
adjacent action the user did not ask for — merging the PR, pushing to production,
committing another session's files.

---

## Anti-patterns

**One skill per SDLC phase.** The phases are documentation
([templates/sdlc/](../templates/sdlc/)); skills are procedures. There is no
`design` skill because design is not a repeatable command sequence.

**A skill that restates the docs.** Skills link into the knowledge base; they do
not duplicate it. Duplication is a second source of truth and it drifts — that is
the failure this whole pattern file exists because of.

**An agent for something cheap.** Delegation costs a context window and a
round-trip. Use it when the *output volume* is the problem, not the work.

**Copying a template verbatim.** If you generate an asset and none of it is
repo-specific, you have produced a file that will drift from its original for no
benefit. Either specialise it or do not generate it.

---

## After generating

For each asset, write down in the install report **what repo-specific knowledge it
encodes.** If you cannot name that for an asset, delete it before reporting — an
unjustified file in `.claude/` is one the next reader will assume is load-bearing.
