---
name: sdlc-bootstrap
description: Install or improve a repository's SDLC from the sdlc-kit — survey what exists, write .claude/sdlc.config.json, install the missing docs/hooks/commands, and report every rule that is claimed but not enforced. Use when the kit is dropped into a new repo, when asked to "set up the SDLC", "install the kit", "improve our process", or when a repo has rules nobody checks.
---

# Bootstrapping an SDLC

Install the kit into this repository, or improve the SDLC it already has.

**The output that matters is not the files. It is the ranked list of rules this
repo claims and does not enforce.** Everything else is setup for that.

## Run this in its own context

This job reads a lot and writes a lot, and almost none of it is worth carrying
into whatever the user does next. Delegate it:

> Use the Agent tool with `subagent_type: "general-purpose"`, and give it this
> file's procedure plus the repo path. Have it return only the Phase 5 report.

If the user asked for it inline, or the repo is small, doing it directly is fine —
just be aware it will fill a context window.

## The one rule

**Never overwrite a file that already exists.** Write `<name>.kit.md` beside it
and list the collision in the report. A bootstrap that clobbers a repo's real
CONTRIBUTING.md is a bootstrap nobody runs twice.

`.claude/settings.json` is the single exception — it is *merged*, key by key,
adding hooks and unioning permissions, removing nothing. Never touch
`.claude/settings.local.json`; it is the user's personal, gitignored file.

---

## Phase 1 — Survey. Read before writing.

Answer from the tree, not from assumption. Record `unknown` where you cannot
determine something — **a `TODO` is correct output and an invented value is not.**

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null; git branch -a; git log --oneline -20
ls package.json pnpm-lock.yaml yarn.lock go.mod Cargo.toml pyproject.toml pom.xml 2>/dev/null
ls .github/workflows/ .gitlab-ci.yml Jenkinsfile 2>/dev/null
ls CLAUDE.md AGENTS.md .cursorrules CONTRIBUTING.md README.md 2>/dev/null
ls .claude/ docs/ adr/ decisions/ 2>/dev/null
```

Then **read the CI steps**. Job names are marketing; the `run:` lines are the
truth. A job called "test" that runs `echo ok` is a finding.

Determine, and write down which of the three each answer is —
**detected / asked / assumed**:

| Question | Notes |
|---|---|
| Production branch, integration branch, model | Look at real merge patterns, not intent |
| Package manager, runtime, minimum version that actually works | Manifests lie; check `.nvmrc`, `.tool-versions`, CI |
| Every command CI runs, and which block a merge | Blocking needs branch protection; if you cannot see it, say `unknown` |
| Test runner, typechecker, linter — **invoked by a script**, not merely configured | A config file nobody runs is not a gate |
| Existing docs and agent instructions | These are adopted, never replaced |
| Is the tree shared by concurrent sessions? | **Ask the user.** Do not guess — it changes what gets denied |

Classify:

- **greenfield** — no CI, no docs, no agent instructions → install everything
- **brownfield** — some exists → install the gaps, adopt the rest
- **contested** — an SDLC exists and disagrees with the kit → **adopt the repo's
  model, not the kit's**. The kit's defaults are defaults, not requirements. A
  trunk-based repo does not get a `develop` branch because a template mentioned one.

## Phase 2 — Write `.claude/sdlc.config.json`

Validate against `sdlc-kit/sdlc.config.schema.json`. Two rules matter more than
the rest:

**Every `gates[].command` is the command CI actually runs.** Not an equivalent,
not a tidier version. If CI runs `pnpm -r test` and you write `pnpm test`,
`/gates` passes locally and CI fails — and the first time that happens, people
stop running `/gates`.

**`blocking` is a factual claim.** Cannot verify? `"blocking": false`, and say so
in the report. Marking an advisory check as blocking is how a green build starts
meaning nothing.

Order `gates` cheapest-first. Keep `postEdit` commands under a second.

## Phase 3 — Install

Copy per the table in `sdlc-kit/INSTALL.md` §2. Then fill the templates:

- Replace each `{{PLACEHOLDER}}` with a surveyed value, **or** delete the section
  and leave a one-line `TODO:` naming what is missing and who can answer it.
- Resolve each `> **Survey:**` block, or keep it and mark the document
  `Status: incomplete`.
- **Delete sections that do not apply.** A mobile-release section in a library repo
  is not harmless — it makes the document look like boilerplate, and a document
  that looks like boilerplate stops being read.

Never invent: thresholds, coverage targets, latency budgets, SLAs, device
matrices, or team roles. Each becomes a cited fact within a week.

## Phase 4 — Verify. No success report without this.

```bash
echo '{"hook_event_name":"SessionStart","source":"startup"}' | node .claude/hooks/branch-check.mjs
echo '{"hook_event_name":"PreCompact","trigger":"auto"}'     | node .claude/hooks/branch-check.mjs
echo 'not json'                                              | node .claude/hooks/branch-check.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin <production>"}}' | node .claude/hooks/guard-git.mjs
node -e "JSON.parse(require('fs').readFileSync('.claude/sdlc.config.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
```

Every hook invocation must **exit 0** and emit valid JSON or nothing. A
`SessionStart` hook that exits non-zero blocks the session — this is where you
confirm it fails open.

Then run `/gates` once. On a previously ungated repo it is *expected* to fail.
That failure is the baseline and belongs in the report.

## Phase 5 — Report

1. **Installed** — written, skipped on collision, needing a manual merge
2. **The config** — branch model, gate list, and for each value: detected / asked
   / assumed
3. **Gaps, ranked** — every rule claimed and enforced by nothing, by blast radius
   first, cheapest fix second. **This is the deliverable.**
4. **Open questions** — what only the user can answer. Ask now, not later.

End with **one** next action: the single cheapest fix on the gap list, as a
command or a file. Not a list.

Then tell the user to restart the session or open `/hooks` once — Claude Code's
settings watcher only watches directories that already held a settings file when
the session began, so a freshly created `.claude/settings.json` is not picked up
until then. This is the most common "the hooks don't work" cause.

---

## Improving an SDLC that already exists

The common path, and a different job from installing. **Adopt, then audit** —
never overwrite.

1. **Adopt.** Write the repo's real conventions into the config, including ones
   you would not have chosen. A config describing an aspirational workflow is one
   nobody's tooling matches.
2. **Audit.** For each stated rule, find its enforcement. Most have none. That
   list is the value you are adding. (`/sdlc-audit` does this alone.)
3. **Close one gap.** Not all of them. Cheapest fix, largest blast radius — then
   **make it fail on purpose** to prove it fires. A gate nobody has seen fail is a
   gate nobody knows works.
4. **Leave the rest documented.** A ranked, honest gap list beats six half-wired
   gates, and it is what lets the next session pick up.
