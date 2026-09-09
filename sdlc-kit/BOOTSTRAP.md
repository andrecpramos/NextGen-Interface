# Bootstrapping

The install procedure. **Agents doing the install: this is binding.** Humans read
§1 and stop.

---

## 1 · For a human, in three steps

```bash
# 1. Copy the kit in
cp -r /path/to/sdlc-kit ./sdlc-kit

# 2. Open Claude Code in that repository and say:
#      Install the SDLC kit: read sdlc-kit/BOOTSTRAP.md and follow it.

# 3. Review the two things the agent cannot decide for you:
#      .claude/sdlc.config.json              — are those really your branches and gates?
#      .claude/docs/critical-infrastructure.md — the gap list. Fix the top one.
```

Then **restart the session, or open `/hooks` once.** Claude Code's settings
watcher only watches directories that already held a settings file when the
session began, so a freshly created `.claude/settings.json` is not picked up until
then. This is the single most common "the hooks don't work" cause.

The install is **non-destructive by contract**: it never overwrites an existing
file. Collisions are written as `<name>.kit.md` beside the original and listed in
the report.

---

## 2 · Run it in its own context

This job reads a lot and writes a lot, and almost none of it is worth carrying
into whatever the user does next.

> Delegate it: `Agent` tool, `subagent_type: "general-purpose"`, given this file
> and the repo path, returning only the Phase 5 report.

Inline is fine for a small repo — just expect it to fill a context window.

---

## 3 · The procedure

### Phase 1 — Survey. Read before writing.

Answer from the tree, not from assumption. Record `unknown` where you cannot
determine something: **a `TODO` is correct output; an invented value is not.**

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null; git branch -a; git log --oneline -20
ls package.json pnpm-lock.yaml yarn.lock go.mod Cargo.toml pyproject.toml pom.xml 2>/dev/null
ls .github/workflows/ .gitlab-ci.yml Jenkinsfile 2>/dev/null
ls CLAUDE.md AGENTS.md .cursorrules CONTRIBUTING.md README.md 2>/dev/null
ls .claude/ .ai/ docs/ adr/ decisions/ 2>/dev/null
```

Then **read the CI steps.** Job names are marketing; the `run:` lines are the
truth. A job called "test" that runs `echo ok` is a finding, not a gate.

Mark every answer **detected / asked / assumed**:

| Question | Notes |
|---|---|
| Production branch, integration branch, model | Look at real merge patterns, not intent |
| Package manager, runtime, minimum version that actually works | Manifests lie; check `.nvmrc`, `.tool-versions`, CI |
| Every command CI runs | Character for character |
| Which of those **block a merge** | Needs branch protection. Check it — see [patterns/enforcement.md](patterns/enforcement.md) |
| Test runner, typechecker, linter **invoked by a script** | A config file nobody runs is not a gate |
| Existing docs and agent instructions | Adopted, never replaced |
| Is the tree shared by concurrent sessions? | **Ask the user.** Do not guess — it changes what gets denied |
| What does this repo know that an agent would get wrong? | The single most important question. It determines what you generate in Phase 3 |

Classify: **greenfield** (install everything) · **brownfield** (fill gaps, adopt
the rest) · **contested** (an SDLC exists and disagrees with the kit — **adopt the
repo's model**; the kit's defaults are defaults, not requirements).

### Phase 2 — Write `.claude/sdlc.config.json`

Validate against [`sdlc.config.schema.json`](sdlc.config.schema.json). Two rules
matter more than the rest:

**Every `gates[].command` is what CI actually runs.** Not an equivalent, not a
tidier version. If CI runs `pnpm -r test` and you write `pnpm test`, `/gates`
passes locally and CI fails — and the first time that happens, people stop running
`/gates`.

**`blocking` is a factual claim.** Cannot verify? `"blocking": false`, and say so.
Marking an advisory check as blocking is how a green build starts meaning nothing.

Order `gates` cheapest-first. Keep `postEdit` commands under a second — a slow
post-edit hook makes every write feel expensive and gets disabled within a week.

### Phase 3 — Install and generate

**Copy verbatim** — these are universal:

| From | To |
|---|---|
| `runtime/hooks/*.mjs` | `.claude/hooks/` |
| `runtime/settings.json` | **merged** into `.claude/settings.json`, key by key |

Merge rule for settings: hooks are *added* to their event arrays, permissions are
*unioned*, nothing existing is removed, and the same hook command is never added
twice. **Never touch `.claude/settings.local.json`** — it is the user's personal,
gitignored file.

**Adapt from templates** — fill or delete, never leave hanging:

- Replace every `{{PLACEHOLDER}}` with a surveyed value, **or** delete the section
  and leave a one-line `TODO:` naming what is missing and who can answer it.
- Resolve every `> **Survey:**` block, or mark the document `Status: incomplete`.
- **Delete sections that do not apply.** A mobile-release section in a library
  repo is not harmless — it makes the document look like boilerplate, and a
  document that looks like boilerplate stops being read.

**Generate the workflow** — read [patterns/workflow.md](patterns/workflow.md) and
follow it. Generate a skill, agent or command only when it encodes something *this
repo knows that a competent agent would otherwise get wrong*. The kit ships none
of these, because copied ones drift.

**Harvest what the repo already learned.** If there is a plan document, a
post-mortem, a "gotchas" section, or `// never do X` comments — those are lessons.
Put them in `.claude/docs/lessons.md` and, where possible, push each one up the
enforcement ladder into a `postEdit` reminder or a gate. A lesson delivered at the
moment of temptation beats one filed in a document.

Never invent: thresholds, coverage targets, latency budgets, SLAs, device
matrices, or team roles. Each becomes a cited fact within a week.

### Phase 4 — Verify. No success report without this.

```bash
echo '{"hook_event_name":"SessionStart","source":"startup"}' | node .claude/hooks/branch-check.mjs
echo '{"hook_event_name":"PreCompact","trigger":"auto"}'     | node .claude/hooks/branch-check.mjs
echo 'not json'                                              | node .claude/hooks/branch-check.mjs
node -e "JSON.parse(require('fs').readFileSync('.claude/sdlc.config.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
```

Every hook invocation must **exit 0** and emit valid JSON or nothing. A
`SessionStart` hook that exits non-zero blocks the session — this is where you
confirm it fails open.

Test the guard with payloads written to a **file**, not echoed on a shell line:
the guard matches the literal command text, so an echoed payload containing
`git add -A` trips it. (It strips heredocs and `echo`/`printf` arguments for
exactly this reason — verify that still holds.)

Then run `/gates` once. On a previously ungated repo it is *expected* to fail.
That failure is the baseline and belongs in the report.

### Phase 5 — Report

1. **Installed** — copied, generated, skipped on collision.
2. **Generated workflow** — for each asset, *what repo-specific knowledge it
   encodes*. If you cannot name that, delete the asset before reporting.
3. **The config** — branch model, gate list, each value marked detected / asked /
   assumed.
4. **Gaps, ranked** — every rule claimed and enforced by nothing, blast radius
   first. **This is the deliverable.** Method:
   [patterns/enforcement.md](patterns/enforcement.md).
5. **Open questions** — what only the user can answer. Ask now, not later.

End with **one** next action: the cheapest fix with the largest blast radius, as a
command or a file. Not a list — a list gets deferred.

---

## 4 · Improving an SDLC that already exists

The common path, and a different job from installing. **Adopt, then audit** —
never overwrite.

1. **Adopt.** Write the repo's real conventions into the config, including the
   ones you would not have chosen. A config describing an aspirational workflow is
   one nobody's tooling matches.
2. **Audit.** For each stated rule, find its enforcement. Most will have none.
   That list is the value you are adding.
3. **Close one gap.** Not all of them. Then **make it fail on purpose** to prove
   it fires — a gate nobody has seen fail is a gate nobody knows works.
4. **Leave the rest documented.** A ranked, honest gap list beats six half-wired
   gates, and it is what lets the next session pick up.

---

## 5 · Uninstalling

```bash
rm -rf .claude/hooks/{_config,branch-check,guard-git,check-gates}.mjs
rm -f .claude/sdlc.config.json
# then remove the hook blocks from .claude/settings.json
```

Everything else is yours after install and is not the kit's to remove.
