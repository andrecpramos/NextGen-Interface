# Installing the kit

Two audiences. **Humans** read §1 and stop. **Agents** doing the install read all
of it — §3 is the procedure, and it is binding.

---

## 1 · For a human, in three steps

```bash
# 1. Copy the kit into the target repository
cp -r /path/to/sdlc-kit ./sdlc-kit

# 2. Open Claude Code in that repository and say:
#      Install the SDLC kit: read sdlc-kit/INSTALL.md and follow it.
#    or, if the kit's .claude/ payload is already in place:
#      /sdlc-init

# 3. Review the two things the agent cannot decide for you:
#      .ai/sdlc.config.json     — are those really your branch names and gates?
#      .ai/critical-infrastructure.md — the gap list. Fix the top one.
```

The install is **non-destructive by contract**: it never overwrites an existing
file. Anything that would collide is written as `<name>.kit.md` beside the
original and listed in the report for you to merge.

After it finishes, restart the session or open `/hooks` once. Claude Code's
settings watcher only watches directories that already held a settings file when
the session began, so a freshly created `.claude/settings.json` is not picked up
until then. This is the single most common "the hooks don't work" cause.

---

## 2 · What gets installed where

| From | To | On collision |
|---|---|---|
| `sdlc-kit/ai/**` | `<repo>/.ai/**` | write `<name>.kit.md`, never overwrite |
| `sdlc-kit/claude/hooks/*.mjs` | `<repo>/.claude/hooks/` | write `<name>.kit.mjs` |
| `sdlc-kit/claude/commands/*.md` | `<repo>/.claude/commands/` | skip, report |
| `sdlc-kit/claude/skills/*/SKILL.md` | `<repo>/.claude/skills/` | skip, report |
| `sdlc-kit/claude/agents/*.md` | `<repo>/.claude/agents/` | skip, report |
| `sdlc-kit/claude/settings.json` | `<repo>/.claude/settings.json` | **merge**, key by key |
| `sdlc-kit/claude/CLAUDE.template.md` | `<repo>/CLAUDE.md` | append a marked section |
| *(generated)* | `<repo>/.ai/sdlc.config.json` | never overwrite |

`settings.json` is the one file that is merged rather than copied, because it
usually already exists and already carries permissions worth keeping. Merge rule:
kit hooks are **added** to their event arrays, kit permissions are **unioned**
into `allow`/`ask`, and nothing existing is removed. If the same hook command is
already wired to the same event, it is not added twice.

Never touch `.claude/settings.local.json`. It is the user's personal, gitignored
file. Kit changes go in the committed `settings.json`.

---

## 3 · The install procedure (agent-binding)

Run these five phases in order. Do not skip the survey — an install that assumes
a greenfield repo and finds a brownfield one produces a config full of confident
wrong answers, which is the worst possible output.

### Phase 1 — Survey. Read before writing.

Answer every question below **from the tree**, not from assumption. Record
"unknown" where you cannot determine it; a `TODO` in the output is correct and an
invented value is not.

| Question | How to answer it |
|---|---|
| Is this a git repo, and what is the default branch? | `git remote show origin`, or `git symbolic-ref refs/remotes/origin/HEAD` |
| Which branches exist, and which look like production and integration? | `git branch -a`; look for `main`/`master` and `develop`/`dev` |
| Is there already a branching convention? | `git log --oneline --graph -40`; branch name prefixes in `git branch -a` |
| What is the package manager and runtime? | lockfile names; `packageManager` field; `engines`; `.nvmrc`, `.tool-versions`, `rust-toolchain`, `go.mod` |
| What commands already exist? | `package.json` scripts, `Makefile`, `justfile`, `Taskfile`, `*.gradle`, `pyproject.toml` |
| What does CI actually run? | `.github/workflows/*.yml`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `Jenkinsfile` — **read the steps, do not trust job names** |
| Which of those CI steps block a merge? | branch-protection settings if visible; otherwise mark `blocking: unknown` and say so |
| Is there a test runner, a typechecker, a linter? | config files present *and* referenced by a script; a config nobody invokes is not a gate |
| Does documentation already exist? | `README`, `CONTRIBUTING`, `docs/`, `ARCHITECTURE.md`, `ADR`/`adr`/`decisions` directories |
| Do agent instructions already exist? | `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, `.github/copilot-instructions.md` |
| Is the tree shared by concurrent sessions? | Ask the user. Do not guess — this one changes what gets denied. |
| Is the project pre-release or in production? | tags, a `CHANGELOG`, deploy workflows, a published version |

Classify the repo as one of:

- **greenfield** — no CI, no docs, no agent instructions. Install everything.
- **brownfield** — some of it exists. Install the gaps, *adopt* the rest.
- **contested** — an SDLC exists and disagrees with the kit (e.g. trunk-based
  with no integration branch). **Adopt the repo's model, not the kit's.** Write
  the repo's real convention into the config and adapt the templates to it. The
  kit's defaults are defaults, not requirements.

### Phase 2 — Write `.ai/sdlc.config.json`. This is the load-bearing step.

Validate against [`sdlc.config.schema.json`](sdlc.config.schema.json). Two rules
that matter more than the rest:

**Every `gates[].command` must be the command CI actually runs.** Not an
equivalent, not a tidier version. If CI runs `pnpm -r test` and you write
`pnpm test`, `/gates` will pass locally and CI will fail, and the first time that
happens people stop running `/gates`.

**`blocking` must be honest.** If you cannot determine whether a CI step blocks
a merge, set `"blocking": false` and note it in the report. Marking an advisory
check as blocking is how a green build starts meaning nothing.

Order the array cheapest-first. A gate set that puts a 90-second test suite ahead
of a 75ms boundary check wastes a minute on every failed run.

### Phase 3 — Install the files.

Copy per the table in §2. Then fill the templates:

- Replace every `{{PLACEHOLDER}}` with a surveyed value, or delete the section
  and leave a one-line `TODO:` naming what is missing and who can answer it.
- Resolve every `> **Survey:**` block: either answer it inline and delete the
  block, or keep it and mark the document `Status: incomplete` in its header.
- Delete sections that do not apply. A mobile-release section in a library repo
  is not harmless — it makes the whole document look like boilerplate, and a
  document that looks like boilerplate stops being read.

Do **not** invent: thresholds, coverage targets, latency budgets, device
matrices, SLAs, or team roles. Every one of those becomes a cited fact within a
week.

### Phase 4 — Verify. Do not report success without this.

```bash
# hooks are valid, terminate, and emit valid JSON on every payload shape
echo '{"hook_event_name":"SessionStart","source":"startup"}' | node .claude/hooks/branch-check.mjs
echo '{"hook_event_name":"PreCompact","trigger":"auto"}'     | node .claude/hooks/branch-check.mjs
echo 'not json'                                              | node .claude/hooks/branch-check.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"git add -A"}}' | node .claude/hooks/guard-git.mjs

# config parses and matches the schema
node -e "JSON.parse(require('fs').readFileSync('.ai/sdlc.config.json','utf8'))"

# settings.json is still valid JSON after the merge
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
```

Each hook invocation must **exit 0** and print one JSON object. A `SessionStart`
hook that exits non-zero blocks the session, so failing open is the only
acceptable behaviour and this is where you confirm it.

Then run `/gates` once. It is expected to fail on a repo that was not previously
gated — that failure is the baseline, and it belongs in the report.

### Phase 5 — Report. Say what is not protected.

Produce, in the session and as `.ai/critical-infrastructure.md`:

1. **Installed** — files written, files skipped on collision, files needing a merge.
2. **The config** — branch model, gate list, what was detected vs. asked vs. assumed.
3. **Gaps, ranked** — every rule that is written down but enforced by nothing.
   Ranked by blast radius, cheapest fix first. This is the actual deliverable;
   everything above it is setup.
4. **Open questions** — what only the user can answer. Ask them now, not later.

End with the one next action. Not a list — the single cheapest fix on the gap
list, named as a command or a file.

---

## 4 · Improving an SDLC that already exists

The brownfield path is the common one, and it is a different job from installing.
The instruction is **adopt, then audit** — never overwrite.

1. **Adopt.** Write the repo's real conventions into the config, including the
   ones you would not have chosen. A config that describes an aspirational
   workflow is a config nobody's tooling matches.
2. **Audit.** For each rule the repo states anywhere — README, CONTRIBUTING,
   CLAUDE.md, code comments, a wiki link — find its enforcement. Most will have
   none. That list is the value you are adding.
3. **Close one gap.** Not all of them. Pick the cheapest fix with the largest
   blast radius, implement it, and prove it fires by making it fail on purpose.
   A gate nobody has seen fail is a gate nobody knows works.
4. **Leave the rest documented.** A ranked, honest gap list is a better outcome
   than six half-wired gates, and it is what lets the next session pick up.

The `/sdlc-audit` command and the `sdlc-auditor` agent do steps 2 and 3 on
demand, in their own context, after the kit is installed.

---

## 5 · Uninstalling

```bash
rm -rf .ai/sdlc.config.json .claude/hooks/{branch-check,guard-git,check-gates}.mjs
# then remove the hook blocks from .claude/settings.json
```

The `.ai/` documents are yours after install and are not the kit's to remove.
