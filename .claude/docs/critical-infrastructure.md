# Critical infrastructure and the rules that bind it

**Audited against the tree:** 2026-09-09.
Re-audit trigger: any change to `ci.yml`, any new gate, any new rule, or a release.

What this is: every component whose failure is not a local bug, the rules that
govern it, **where that rule is actually enforced**, and whether it is currently
obeyed.

The distinction that matters throughout is between a rule that is *written down*
and a rule that is *enforced*. A written rule is obeyed until someone is in a
hurry. Every row below says which kind it is, and the
[gaps](#enforcement-gaps-ranked) section lists the ones that are still only
written down. Nothing here claims protection that does not exist — if a cell says
`convention`, there is no gate.

Rule numbers are [PLAN.md](../../PLAN.md) section 2. The ADRs in
[decisions/](../decisions/) are the constitution; this file is a map of how they are
held up.

---

## 1 · The capability registry and its codegen

**What.** `packages/domain-*/src/capabilities.ts` is the only contract between the
engine and a domain. One declaration generates three artefacts: the registry the
router matches against, the route table the app navigates by, and the golden-set
fixtures asserting those two agree.

**Blast radius.** A wrong or stale registry means the router reaches a route that
does not exist, or a screen the AI cannot see. It is the single point every other
subsystem reads.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 10 — every capability ships >=3 examples | `MIN_EXAMPLES` in `core-capability/src/validate.ts`, gated by `pnpm registry:check` in CI | **enforced** |
| Rule 13 — limits declared, not judged | the `unsupported` kind and `defineBoundary`, asserted in both domains' tests | **enforced** |
| Generated artefacts match the committed ones | CI step "Registry artefacts are current" | **enforced (fixed 2026-09-08)** |

> ⚠️ **The known fragility: `OUT_INTENT` is one global path.** Every domain's
> `scripts/build-registry.ts` writes the same
> `packages/core-intent/eval/registry.json`, so **only one domain's build script
> can be authoritative at a time**. `pnpm registry:build` (domain-modules) is the
> authoritative one; running `pnpm registry:build:finance` silently replaces the
> registry the router reads with the finance registry.
>
> This is why CI cannot check both domains' artefacts in one job, and why the
> staleness gate covers `domain-modules/generated/` only. **Until 2026-09-08 that
> gate diffed `domain-finance/generated/` — files the build never touches — so it
> passed vacuously while real drift went ungated.** Fixed; the underlying
> shared-path collision is not. A third domain forces the issue.

---

## 2 · The engine/domain boundary

**What.** `packages/core-*` must never import a domain. Domains register *into*
the engine; the engine never enumerates them.

**Blast radius.** This is the invariant the entire "how little code does a new
domain need" thesis rests on. Once broken it is rarely broken back.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 1 — core never imports a domain | `tooling/scripts/check-import-boundaries.mjs`, checking both the declared dependency and every actual import specifier. First step of CI's `verify` job; also `.claude/hooks/check-gates.mjs` on every `core-*` write | **enforced, three layers** |

What the gate cannot see: a `switch` or an `if` in `core-*` enumerating domain
types. Same violation, no import. That one needs a reader — the
`boundary-auditor` agent and `/rules-check` look for it.

---

## 3 · The dispatcher policy table

**What.** `packages/core-dispatch` decides what a capability is allowed to do:
`read` executes, `write` confirms, `destructive` confirms and issues an undo
token, **unclassified refuses**. Policy is code. It is never prompt text, and no
confidence score is consulted.

**Blast radius.** This is the safety mechanism. Everything else degrades; this
one fails open or it does not.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 5 — policy is code, unclassified refuses | `dispatcher.test.ts`: "ADR-004 — unclassified fails closed", "never defaults an unclassified kind to read", "cannot be talked out of confirming — no confidence is consulted" | **enforced by test** |
| Rule 4 — model-produced ids validated against the registry | `dispatcher.test.ts`: "Rule 4 — model-produced ids are untrusted"; re-checked in `cascade.ts` and `stages.ts` as defence in depth | **enforced by test** |
| Rule 3 — the model never emits a route or SQL | `dispatcher.test.ts`: "NavigationEngine — Rule 3, the model never produces a route". The query engine (`data/src/query-engine.ts`) exposes queries by id with typed slots, so SQL injection is removed structurally rather than sanitised | **enforced by test + design** |

---

## 4 · The router cascade, thresholds, and calibration

**What.** `packages/core-intent` — deterministic, then embedding, then a
constrained LLM call. The operating point is `THRESHOLD_PROFILES` in
`src/config.ts`.

**Blast radius.** Thresholds decide what gets accepted without a model. Too high
and everything escalates (latency, battery, offline viability); too low and a
wrong acceptance reaches a write capability behind a confirmation card the user
taps through.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 14 — thresholds calibrated per encoder, never hand-set | `tooling/scripts/check-thresholds.mjs`, in CI | **enforced (added 2026-09-08)** |
| Rule 11 — deterministic slot values beat model-extracted ones | `slots.test.ts` | **enforced by test** |
| Rule 2 — the model never computes a number the user sees | comments at `core-intent/src/types.ts`, `ui/src/types.ts`, `apps/web/lib/render.ts` | **convention — no test** |

> **The gap Rule 14's gate closes.** `pnpm router:calibrate` writes its
> recommendation to `eval/scorecards/thresholds-<kind>.json`, and **nothing reads
> that file at run time** — the shipped operating point is a hand-transcribed
> literal in `config.ts`. So the exact edit the rule forbids (nudging `tauHigh`
> until a failing case passes) was also the edit nothing would notice. The new
> check compares the two and fails on any divergence. Both encoders match their
> calibration as of this audit.

Standing discipline, not mechanically checkable: hand-tuning has cost accuracy
three times here (FINDINGS 1 and 11). When a case fails, differentiate the
overlapping capability descriptions — do not move the threshold.

---

## 5 · The golden set and the scorecard gate

**What.** `packages/core-intent/eval/golden-set.jsonl` plus the committed
scorecards. `pnpm router:floor` (stages 1+2, hashing encoder) is the only
deterministic configuration, which is why it is the only one CI gates
([ADR-011](../decisions/ADR-011.md)).

**Blast radius.** It is the sole regression net for a non-deterministic
component. A corpus that drifts toward happy paths stops detecting the failures
that matter.

| Rule | Enforcement | Status |
|---|---|---|
| No accuracy regression beyond tolerance | `tooling/scripts/check-scorecard.mjs` against the committed baseline, CI `golden-set` job | **enforced** |
| Adversarial to destructive count stays zero | `safetyViolations` in the scorecard | **enforced (release blocker)** |
| Rule 12 — a routing bug is fixed only as a permanent golden-set entry | none — process only | **convention** |
| A prompt change does not regress top-1 accuracy | none. `eval/fut-app/evaluate-golden.mjs` measures it, nothing runs it, and the golden-set job covers the reference registry only — not a generated one | **none — cost 7 points once ([L9](lessons.md))** |

`eval/scorecards/` is deliberately **not** gitignored: accuracy changes have to
appear in the PR diff and be discussed, not silently absorbed.

Two traps that make model-backed runs lie: a cold model load puts a ~22-second
outlier in the p95 (warm it with one throwaway call), and parallel runs share the
GPU (run models sequentially).

---

## 6 · Persistence

**What.** `packages/data` — `node:sqlite`, the schema spec, migrations, and the
money representation.

**Blast radius.** Data loss is unrecoverable. A float money column is
unrecoverable *and* silent.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 6 — money is signed integer minor units plus currency | `data.test.ts`: "has no float money column anywhere — Rule 6, checked structurally"; plus `money.ts` tests that never multiply a float and never return a fractional minor unit | **enforced by test, structurally** |
| Migrations tested from every prior released schema | `data.test.ts` + `migrate.ts` | **enforced by test** |
| Rule 9 — every turn produces a TurnTrace | `cascade.test.ts` "every turn produces a trace", `trace.test.ts` "a trace contains no model-generated prose", trace schema in `data/src/schema/spec.ts` | **enforced by test** |

---

## 7 · Inference runtime and asset provisioning

**What.** `packages/core-inference` (LLM and embedding adapters, model store) and
`packages/core-voice` (whisper.cpp and Piper binaries plus voice models).

**Blast radius.** A corrupt or substituted model asset is arbitrary code and
arbitrary output.

| Rule | Enforcement | Status |
|---|---|---|
| Verify SHA-256 before load; fail closed | `core-voice/src/assets.ts` — download lands on a `.part` file and is renamed into place only after the hash matches, so an interrupted download cannot be mistaken for a complete one. Same discipline as `core-inference`'s `ModelStore` | **enforced in code** |
| Rule 8 — the device is the source of truth; nothing on the critical path requires network | verified by inspection 2026-09-08: the only remote hosts in runtime code are the asset manifest in `core-voice/src/assets.ts` (first-run provisioning), never a per-turn call. Everything else is `127.0.0.1` | **convention — verified, not gated** |
| Model weights never committed | `.gitignore`: `models/`, `*.gguf`, `*.onnx`, `*.bin` | **enforced** |

Every URL and hash in `assets.ts` was verified against the bytes actually
downloaded before being hardcoded. Never trust a hash you did not compute
yourself.

---

## 8 · Untrusted domain content

**What.** A domain's free text is attacker-reachable the moment it crosses into a
prompt: `Module.body`, memo-style fields, imported files, OCR output.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 15 — domain content is untrusted in a prompt | declaration-site comments only (`domain-modules/src/entities.ts:27,38`, `domain-finance/src/entities.ts:44,46`) | **convention — and currently VIOLATED, see below** |

> ### ⚠️ Open violation — Rule 15, `domain-modules/src/use-cases.ts`
>
> The entity comment says *"UNTRUSTED — model-consolidated prose. Fence before
> this reaches a prompt."* **There is no fence function anywhere in the
> repository**, and three sites interpolate untrusted content straight into a
> prompt:
>
> - `merge()` — `` prompt: `Existing module body:\n${existing.body}\n\nNew material:\n${rawSource}` ``
>   — `existing.body` is the field marked UNTRUSTED, and `rawSource` is raw user,
>   file, or OCR input.
> - `shortlistJudge()` — interpolates `module.title`, `module.summary`,
>   `extracted.title` and `extracted.summary` into the judge prompt.
>
> Reachable by saving a note whose text is an instruction, then saving a second
> note that merges into it. Not fixed in this pass: `use-cases.ts` carries another
> session's uncommitted WP-15 work, and editing a dirty file this session does not
> own would take that work with it.
>
> The fix is a fence helper in `core-inference` (delimit, label untrusted, strip
> the delimiter from the content) applied at all three sites, plus a golden-set
> adversarial entry. That is a change to the registered domain's write path and
> wants its own branch.

---

## 9 · The pipeline and the branching contract

**What.** `.github/workflows/ci.yml` and `.claude/hooks/`.

**Blast radius.** These are what make every rule above hold when nobody is
looking. A gate that passes vacuously is worse than no gate — it buys confidence
it has not earned. (Section 1 has this pass's example.)

| Rule | Enforcement | Status |
|---|---|---|
| Only `develop` may merge to production | CI `guard-production` job; `.claude/hooks/guard-git.mjs` for the local case CI never sees | **partial — see below** |
| Branch from `develop`, never from production | `guard-git.mjs`, plus `branch-check.mjs` at every context boundary | **enforced (agents only)** |
| Never stage broadly in this shared tree | `guard-git.mjs` denies `git add -A`, `git add .`, `git commit -a` | **enforced (agents only)** |
| Every relative documentation link resolves | CI + `tooling/scripts/check-doc-links.mjs` | **enforced (added 2026-09-09)** |
| High and critical CVEs block | CI `audit` job (`pnpm audit --audit-level high`) | **enforced** |

> ⚠️ **No CI job in this repository can block a merge.** Measured 2026-09-09:
> `GET /repos/andrecpramos/AI-Interface/branches/{develop,main}/protection`
> returns **403 — "Upgrade to GitHub Pro or make this repository public to
> enable this feature."** Branch protection is *unavailable on this plan*, not
> declined.
>
> This was previously recorded here as a deliberate choice — "no ruleset, so the
> human keeps a direct push path". That framing was too generous. The
> consequences are wider than production:
>
> - `guard-production` fails the run and **prevents nothing**. It is advisory.
> - Every `"blocking": true` in `sdlc.config.json` means *policy says do not
>   merge this*, not *the platform will not let you*.
> - The local hooks are the only layer that actually **denies** anything — and
>   they bind agents, not humans.
>
> Not a reason to remove the jobs: a red build a human respects is real
> enforcement, and it is what this repo has. It is a reason to stop describing
> them as mechanical. See [../sdlc/branching.md](../sdlc/branching.md).

---

## Gates seen failing on purpose

A gate nobody has seen fail is a gate nobody knows works. Section 1's vacuous
staleness gate is the standing proof: green for weeks, checking nothing.

Every new gate is made to fail deliberately once, and that is recorded here.
The table starts mostly empty, which is the honest state — fill one row per
session rather than claiming the set.

| Gate | Last seen failing correctly | How it was made to fail |
|---|---|---|
| `guard-git` (broad staging) | 2026-09-09 | Piped `git add -A`; got a deny naming explicit staging |
| `guard-git` (production write) | 2026-09-09 | Piped `git push origin main`; got a deny naming `develop` |
| `guard-git` (branch from production) | 2026-09-09 | Piped `git checkout -b feature/x main`; deny + correct command |
| `guard-git` (echoed-text false positive) | 2026-09-09 | Piped a payload *containing* `git add -A` as echoed text; correctly **allowed** |
| `check-gates` (post-edit failure) | 2026-09-09 | Throwaway repo, `postEdit` command exiting 1; surfaced it and still exited 0 |
| `doc-links` | 2026-09-09 | Added a link to a non-existent file; exited 1 naming `file:line` |
| `import-boundaries` | — | not yet deliberately broken |
| `registry-check` | — | not yet deliberately broken |
| `check-thresholds` | — | not yet deliberately broken |
| `scorecard` | — | not yet deliberately broken |

---

## Rule to enforcement matrix

| # | Rule | Enforced by | Kind |
|---|---|---|---|
| 1 | `core-*` never imports a domain | `check-import-boundaries.mjs`, CI, PostToolUse hook | **gate** |
| 2 | Model never computes a user-visible number | comments; review | convention |
| 3 | Model never emits SQL or a raw route | `dispatcher.test.ts`; query engine design | **test** |
| 4 | Model-produced ids validated against the registry | `dispatcher.test.ts`, `cascade.ts`, `stages.ts` | **test** |
| 5 | Policy is code; unclassified refuses | `dispatcher.test.ts` | **test** |
| 6 | Money is integer minor units | `data.test.ts` (structural), `money.ts` | **test** |
| 7 | Every AI-reachable screen reachable without AI | both domains' tests; `apps/cli` menu path | **test** |
| 8 | Device is the source of truth | verified by inspection | convention |
| 9 | Every turn produces a TurnTrace | `cascade.test.ts`, `trace.test.ts` | **test** |
| 10 | Every capability ships >=3 examples | `validate.ts` + `registry:check`, CI | **gate** |
| 11 | Deterministic slots beat model-extracted | `slots.test.ts` | **test** |
| 12 | A routing bug becomes a permanent golden entry | none | convention |
| 13 | Limits declared in the registry | `unsupported` kind, `defineBoundary`, domain tests | **test** |
| 14 | Thresholds calibrated per encoder | `check-thresholds.mjs`, CI | **gate (new)** |
| 15 | Domain content untrusted in a prompt | declaration comments only | convention — **violated** |
| 16 | The installer never modifies the adopter's source | `emit.test.ts` (`writeOutput` refuses an output dir inside `appRoot`) + `generate.test.ts` fingerprints the whole fixture tree before and after a run | **test (2026-09-10, WP-25)** |
| 17 | An unreachable capability is absent from the user's registry | `emit.test.ts` diffs two role registries; `score-generated.mjs` re-checks all 10 generated registries against the master on every scoring run | **test (2026-09-10, WP-25)** |
| — | Every capability can say what it is (WP-36) | `explanation-required` in `validate.ts`, gated by `pnpm registry:check` | **gate (2026-09-10)** |
| — | Top-1 accuracy does not regress across a prompt change | none — `evaluate-golden.mjs` would catch it, nothing runs it. Cost 7 points once already ([L9](lessons.md)) | **none** |

---

## Enforcement gaps, ranked

1. **Rule 15 has no mechanism and is violated today.** Section 8. Highest
   priority: it is a prompt-injection path in the registered domain's write flow.
2. **The registry's shared `OUT_INTENT` path.** Section 1. One domain's build
   silently clobbers another's. Survivable with two domains and a documented
   order; not survivable with three.
3. **Rule 2 has no test.** The rule that "the model never computes a number the
   user sees" is held up entirely by comments and review, and it has already
   produced one real bug (PLAN.md section 6). A test asserting arithmetic origin
   on the render path would close it.
4. **Rule 12 is unenforceable mechanically** — but a PR touching `core-intent`
   with no `golden-set.jsonl` change is a cheap heuristic a reviewer or a hook
   could flag.
5. **Rule 8 is verified, not gated.** A check that runtime packages reference no
   non-loopback host outside the asset manifest would keep it that way.
6. **Rules 16 and 17 have no mechanism at all** — they were added on 2026-09-09 with
   the repositioning and describe a product that is not built yet. Both have a
   mechanical check written into the acceptance of the work package that will first
   need them (WP-25 for role scoping, WP-26 for the additive install). **Rule 17 is a
   security property**: shipping one registry to every role would leak the shape of an
   admin surface to a user who must not see it. It ranks here, not lower, because the
   first code that could violate it has not been written — which is the cheapest moment
   to add the gate.

---

## Related

- [PLAN.md](../../PLAN.md) section 2 — the seventeen rules as stated
- [decisions/](../decisions/) — the ADRs the rules come from
- [.claude/README.md](../README.md) — the hooks, skills and agents that apply them
- [sdlc/ci-cd.md](../sdlc/ci-cd.md) — what each CI job gates and why
