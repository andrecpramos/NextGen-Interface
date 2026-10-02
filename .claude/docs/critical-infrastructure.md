# Critical infrastructure and the rules that bind it

**Audited against the tree:** 2026-09-17 — §1 and §2 rewritten after ADR-018 deleted their subjects (§2, the release/install rows and gap 9 revised again 2026-09-20 for ADR-021), and two gates found stale by that deletion (see the banner under "Gates seen failing on purpose"). Previous full pass: 2026-09-12, when every file and test the matrix names was opened and checked to assert what the row claims. Earlier passes: 2026-09-11 (§1, §4, the
matrix, the gaps), 2026-09-10 (§8 and the ranked gaps), 2026-09-09 (the rest).
Re-audit trigger: any change to `ci.yml`, any new gate, any new rule, or a release.
*It fired twice before this pass — WP-47 rewrote the staleness step and WP-45 added a
gate — which is why the pass happened.*

What this is: every component whose failure is not a local bug, the rules that
govern it, **where that rule is actually enforced**, and whether it is currently
obeyed.

The distinction that matters throughout is between a rule that is *written down*
and a rule that is *enforced*. A written rule is obeyed until someone is in a
hurry. Every row below says which kind it is, and the
[gaps](#enforcement-gaps-ranked) section lists the ones that are still only
written down. Nothing here claims protection that does not exist — if a cell says
`convention`, there is no gate.

**A second distinction, easy to miss: `gate` does not always mean *CI runs it*.**
Two of the gates in [`sdlc.config.json`](../sdlc.config.json) are `blocking: true`
and are deliberately **not** in `ci.yml`, because CI cannot run them:
`adversarial-live` needs a model server (GitHub Actions has none — that is why the
golden-set job is model-free, ADR-011), and `kit-sync` compares against `sdlc-kit/`,
which lives outside this repository. Both are real gates for `/gates` on a
developer machine and no protection at all on a pull request. Rows below that
depend on them say so.

Rule numbers are [PLAN.md](../../.MDFiles/PLAN.md) section 2. The ADRs in
[decisions/](../decisions/) are the constitution; this file is a map of how they are
held up.

---

## 1 · The capability registry and its codegen

> ⚠️ **2026-09-17 — rewritten subject.** ADR-018 deleted both domain packages, so a
> hand-written `capabilities.ts` is no longer how a registry comes into being. **The
> generator is**: it reads an application's source and emits one registry per role. Rule
> 10 lost its runner in that deletion — validation had been a side effect of
> `domain-modules registry:build --check` — and is now `tooling/scripts/check-registries.mjs`,
> which finds every registry in the tree by glob. The replacement is **wider** than what it
> replaced, and it refuses to pass when it finds nothing.

**What.** A registry is the only contract between the engine and an application. It is
generated from the application's own source, and one declaration yields both the thing the
router matches against and the route it navigates to, so the two cannot drift.

**Blast radius.** A wrong or stale registry means the router reaches a route that
does not exist, or a screen the AI cannot see. It is the single point every other
subsystem reads.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 10 — every capability ships >=3 examples | `MIN_EXAMPLES` in `core-capability/src/validate.ts`, run by `tooling/scripts/check-registries.mjs` over **every** registry found by glob, gated as `pnpm registry:check` in CI | **enforced, and wider since 2026-09-17** |
| Rule 13 — limits declared, not judged; rules extracted, not judged (ADR-020, WP-54) | the `unsupported` kind and `defineBoundary` for limits; for a rule, `validateRegistry`'s `rule-field-required`/`rule-statement-required`/`rule-untraceable`/`rule-tier-invalid`/`rules-on-boundary` checks, and `check-rule-provenance.mjs` (inside `check-derived-artefacts.mjs`) proving every shipped `source` still resolves to the line it names | **enforced** |
| Generated artefacts match the committed ones | `check-derived-artefacts.mjs` — indexes, per-registry thresholds and browser/server parity over `eval/frameworks/<app>/generated` | **enforced** |
| The fixture registry the router's scorecards were produced from does not move silently | `check-scorecard.mjs` against the scorecard committed at `HEAD`; `packages/core-intent/eval/README.md` says so at the file | **enforced** |

> ✅ **Resolved 2026-09-12 (WP-47, [ADR-016](../decisions/ADR-016.md) option B).**
> Each domain now writes its own `packages/domain-<name>/generated/registry.json`,
> and the eval scripts take `--registry=`. There is no longer a path two builds
> compete for, so **both domains' artefacts are checked in one CI job** and
> `pnpm registry:build:finance` is an ordinary command. The hook that denied it
> has been removed, because the reason for denying it is gone.
>
> **What it was, and why the code still carries the scars.** Every domain's
> `scripts/build-registry.ts` wrote the same
> `packages/core-intent/eval/registry.json`, so only one domain's build could be
> authoritative at a time, and running the other silently replaced the registry
> the router reads. That is why the staleness gate covered `domain-modules/generated/`
> only — and **until 2026-09-08 it diffed `domain-finance/generated/`, files the
> build never touched, so it passed vacuously while real drift went ungated.**
>
> ### The clobber is now loud — 2026-09-10
>
> `checkRegistryOwnership` (`core-capability/src/registry-owner.ts`, 14 tests)
> runs in both build scripts before either writes. If the registry on disk
> describes a **different application** — judged by capability namespaces, with
> `unsupported` excluded because both domains declare boundaries under it — the
> build refuses and names both sides. `--force` overrides.
>
> **This did not fix the collision** — it made the mistake loud while the shared
> path stayed. The fix was [ADR-016](../decisions/ADR-016.md), accepted by the owner
> on 2026-09-11 and implemented by WP-47 on 2026-09-12.
>
> `checkRegistryOwnership` is kept. With per-domain paths a cross-application
> write needs a misconfigured output path rather than a mistyped command, so it now
> guards a narrower mistake than the one it was written for — but it is 14 tests
> and one call per build script, and the failure it catches is still the worst one
> available: a registry that describes an application nobody meant to ship.
>
> **A `guard-git`-style hook denying `pnpm registry:build:finance` was not a
> substitute either** (removed by WP-47 along with its reason). It matched a command string, so
> `node packages/domain-finance/scripts/build-registry.ts` walked straight past
> it — which is how this was verified. Like every hook here it also binds agents
> and not humans (§9). The guard is in the build script because that is the one
> place both a human and an agent must go through.
>
> The guard is **symmetric**: after a wrong build, the correct build refuses too,
> for the same reason. Recovery is `--force` on the build you actually want, and
> the refusal says so.

---

## 2 · The engine/domain boundary

> ✅ **2026-09-20 — repointed, ADR-021.** ADR-018 deleted both domain packages, and for
> three days `check-import-boundaries.mjs` went on reporting *"clean of domain imports"*
> against a tree containing none: it could not fail for the reason it existed. It now
> enforces what survives the deletion and what a gate can still fail on: **`packages/core-*`
> depend only on other `core-*` packages**, in `package.json` and in every import specifier,
> including a relative path out of the package.
>
> **Proven live, three ways, by breaking it on purpose:** `core-intent` importing
> `@nextgen/generator`; `core-inference` re-exporting `../../kit/src/index.ts`; and
> `core-capability` declaring `@nextgen/embed` as a dependency. Each exited 1 naming the file
> and line, and each was reverted. The deep relative import is the shape the old gate could
> not see either.

**What.** `packages/core-*` depend only on other `core-*`. The engine — registry contract,
router, model runtimes — sits below the generator (reads an application), the widget (runs in
its page) and the kit (drives both), so it cannot learn about an application from any of them.

**Blast radius.** This is the invariant the entire "the engine knows nothing about any
particular application" thesis rests on. Once broken it is rarely broken back.

> ⚠️ **2026-09-17 — this rule's subject changed, and the change weakens the
> enforcement.** ADR-018 deleted both domain packages. `check-import-boundaries.mjs`
> still runs and still passes, but it now reports *"3 core package(s) clean of domain
> imports"* **against a tree containing no domains** — there is nothing left for a core
> package to import wrongly, so the gate cannot currently fail for the reason it exists.
>
> The invariant itself is not weaker: the only application the engine ever sees is the
> adopter's, at run time, as declared data rather than as code. But the *gate* is now in
> the state §"Gates seen failing on purpose" warns about, and it is recorded here rather
> than left to be discovered. **Deciding what replaces it is owed.** The honest options
> are to point it at `adapter/` once that exists, to keep it as a tripwire for the day a
> domain-shaped package reappears, or to retire it and say so — retiring an enforced rule
> needs an entry in the ranked gaps below.

**What.** `packages/core-*` must never import an application. Applications register
*into* the engine; the engine never enumerates them.

**Blast radius.** This is the invariant the entire "how little code does a new
application need" thesis rests on. Once broken it is rarely broken back.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 1 — `core-*` depend only on other `core-*` | `tooling/scripts/check-import-boundaries.mjs`, checking both the declared dependency and every actual import specifier (by name, and by relative path out of the package). First step of CI's `verify` job; also the `postEdit` hook in `.claude/sdlc.config.json` on every `core-*` write | **enforced, two layers — repointed 2026-09-20, ADR-021** |

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
| Rule 14, the exception — `UNCALIBRATED_BOUNDARY_FLOOR` (0.15), written into the `thresholds.hashing.json` of a kit bundle built with **no** calibration, so a declared limit must score that much in its own right before it refuses (2026-09-21) | `boundary-floor.test.ts` (the mechanism; absent from every calibrated profile) and `kit.test.ts` (an uncalibrated bundle carries it, a calibrated one does not). **`check-thresholds.mjs` does not see it**: it lives in `packages/kit/src/build.ts`, not in `THRESHOLD_PROFILES`, and is not one of the swept fields | **a hand-set stand-in, disclosed, not enforced.** Chosen after seeing one real app's data (7 of 12 everyday questions refused without it, 1 with it); the number is the likely-one tier's own "barely a match" bar, not a fit. A calibration replaces it. Replace it with a swept floor when a real adopter's golden set exists |
| Rule 8 (the device is the source of truth), for what a visitor attaches — a photo or a file never leaves the device: not to the router, a trace, a prompt or any request; it reaches only the page, as `nextgen:attach` ([ADR-024](../decisions/ADR-024.md), 2026-09-21) | `assistant.test.ts`: the router is asked with a string that contains neither the file nor its name; `fetch` is never called; a message of only a file is answered without the router. **`check-network-egress.mjs` cannot see this** — it reads URL literals, and a file sent to a variable URL would pass it | **enforced by test, not by a gate.** A change that adds a request would have to break those tests to ship. **Not true of a page that wires a `companion`** ([ADR-026](../decisions/ADR-026.md)): there the files go to the adopter's own `companion.ask`, their code, instead of the event — still never to a request of ours |
| Rule 11 — deterministic slot values beat model-extracted ones | `slots.test.ts` | **enforced by test** |
| A limit marked `refuses: 'action'` is a candidate only for a request to act; the generator marks its three acting limits, never the adopter's ([ADR-025](../decisions/ADR-025.md), 2026-09-22) | `acting-limit.test.ts` (unmarked refuses on topic, marked asks, a request to act and a topic limit still refuse); `registry.test.ts` (`refuses-known`, `refuses-misplaced`); the generated-golden gate fails if any golden decision moves; calibration scores turns under the same rule | **enforced by test and gate.** That an adopter never marks a *subject* limit this way is **convention** — `knowledge.json` cannot express it, but a hand-edited registry could |
| A limit's `helpAt` names only screens the role can open (Rule 17), and a refusal offers a screen from retrieval only for a limit about acting ([ADR-025](../decisions/ADR-025.md), items 5–7) | `registry.test.ts` (`help-at-reachable`, `help-at-misplaced`) and `validateRegistry` at every build; `emit.test.ts` (kept per role, dropped when none is left); `present.test.ts` (never for a subject limit, never another limit or the current page) | **enforced by test and at build.** That a named route is the *right* place is the adopter's word, served as fact — convention, as with a screen's `purpose` |
| The app's own assistant (`companion`) is asked only what this one cannot place — nothing matched, out of scope with no capability, a *subject* limit with no `helpAt` — never a limit on acting; its answer is attributed and carries no "Why?"; its failure falls back ([ADR-026](../decisions/ADR-026.md), 2026-09-23) | `assistant.test.ts` ("the app’s own assistant, merged in") | **enforced by test.** That the adopter's `companion.ask` does not claim to perform navigation, and that the adopter discloses what reaches it, is **convention** — it is their code |
| The assistant never waits for speech to move, reads aloud only when asked, has no navigation of its own, and is modal only when expanded ([ADR-026](../decisions/ADR-026.md)) | `assistant.test.ts` (move before a voice ends; silent by default; no `.menu`/`.drawer`; `aria-modal` and Tab trap only when expanded); `check-accessibility.mjs` (the same, on the built bundle) | **enforced by test and gate** |
| The adopter's dial changes what is done with a decision, never the decision: `confirm` asks before a decided move, `eager` moves only on a plain leader, neither touches a limit or an unmatched question ([ADR-027](../decisions/ADR-027.md), 2026-09-23) | `present.test.ts` (decide), `assistant.test.ts` (the dial end to end) | **enforced by test.** That an adopter picks `eager` knowingly is **convention** |
| What visitors teach reaches only the page (`onLearn`, `nextgen:learn`), and `teach` writes knowledge.json only with `--write`, holding back phrases that may identify someone ([ADR-027](../decisions/ADR-027.md)) | `assistant.test.ts` ("what visitors teach it"), `teach.test.ts` | **enforced by test.** What the adopter keeps, and a name in plain words that passes the identifier check, are **convention** |
| The shipped index is `indexFor(registry)`, the same function the runtime computes a merged multi-role index with; a stage-1 phrase two capabilities claim names neither ([ADR-027](../decisions/ADR-027.md)) | `registry-browser.test.ts` (every committed index reproduced byte for byte; merge; contested phrases); derived-artefacts gate | **enforced by test and gate** |
| Hashing vectors are stored and shipped sparse, and score exactly as dense did ([ADR-028](../decisions/ADR-028.md), 2026-09-23) | `sparse.test.ts` (parity dense/sparse; size per screen bounded; malformed index refused; dense still read); derived-artefacts (browser parity on every golden turn) and generated-golden | **enforced by test and gate** |
| A screen declared in knowledge.json reaches only the roles it names, in a multi-role app ([ADR-028](../decisions/ADR-028.md)) | `knowledge.test.ts` (declaredScreens) | **enforced by test.** That its route, title and roles are true is **convention** |
| Every destination the widget moves to or links is a path on this site — `safeRoute()` on answers, choices, homes and the legacy `mount` ([ADR-029](../decisions/ADR-029.md), 2026-09-23) | `present.test.ts` (`safeRoute`); `assistant.test.ts` ("security — what it will not do": an evil registry route never moved to or linked, unsafe homes ignored) | **enforced by test.** A *new* way to navigate added later is protected only if it calls `safeRoute` — **convention** |
| The launcher-hiding selector is only a selector; the bundle loads from this site unless the adopter hands in a `fetch`; enum maps from a registry have no prototype ([ADR-029](../decisions/ADR-029.md)) | `assistant.test.ts` (hide-selector injection refused); `script-tag.test.ts` (another site refused, nothing fetched); `registry-browser.test.ts` (`"__proto__"`) | **enforced by test** |
| At rest the widget costs next to nothing: the canvas is drawn at its shown size and goes still after 12 s docked; the closed screen's animations are paused; the fit waits for idle time ([ADR-029](../decisions/ADR-029.md)) | `liquid.test.ts` (goes still, wakes, resolution follows size) | **enforced by test** for the canvas. The paused animations and the idle fit are **convention** |
| The widget's bundle stays under 70 KB gzipped (62.8 KB, 2026-09-25; 60 KB until the ADR-029 addendum that day); its one HTML sink is the icon glyph, fed only compiled-in `ICON_` constants ([ADR-029](../decisions/ADR-029.md)) | `embed.test.ts` ("is small enough to be a script tag"; "what reaches markup" scans every source for `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`); `build.mjs` fails on a lost CSS interpolation | **enforced by test** |
| A visitor is shown the answer only — no "Why?", no mechanics; each routed turn's record goes to the page as `nextgen:turn` (Rule 9 kept); a model-decided or -written turn says so in one line (ADR-017) ([ADR-030](../decisions/ADR-030.md), 2026-09-23) | `assistant.test.ts` ("why it did that — for the adopter"); `check-accessibility.mjs` on the built bundle | **enforced by test and gate** |
| One language on screen, the page's: the registry names its `language` and carries `translations`; a missing translation shows nothing rather than another language; translations are never embedded ([ADR-030](../decisions/ADR-030.md)) | `present.test.ts` ("one language on screen"); `assistant.test.ts` ("one language, and it follows the app"); `generate-titles.test.ts`; `validate-context.test.ts` ("languages"); derived-artefacts and generated-golden (no score moved) | **enforced by test and gate.** Following `<html lang>` live is **convention** (no `MutationObserver` in the fake DOM; `setLanguage` is tested) |
| Asked to start something, it presses only a control with evidence it only opens (a link on this site, a tab, `aria-haspopup`/`-expanded`/`-controls`, a declared `opens`), points at any other, never touches what saves/sends/pays/deletes/signs out, anything in a form, or an ambiguous pair, and never types ([ADR-031](../decisions/ADR-031.md), 2026-09-23) | `act.test.ts`; `assistant.test.ts` ("using the app — …"); `pages.test.ts` (source openers and look-alikes); `knowledge.test.ts`, `validate-context.test.ts` (`opens`) | **enforced by test.** That it never types is **convention** — there is no typing code to test |
| Stage 2 scores a capability as the mean of its whole document and its nearest own phrasing (title, examples); every threshold re-derived by its sweep ([ADR-032](../decisions/ADR-032.md), 2026-09-23) | `phrasing-score.test.ts`; `check-thresholds.mjs`; `check-derived-artefacts.mjs`; generated-golden | **enforced by test and gate.** That the first question stays fast at scale (150 ms at 2,000 screens) is **convention** |
| **Rule 18.** A stage-3 request asks only for what the turn reads — `capabilityId` first, `confidence`, `params` only when a candidate has any, `prose` only for an explanation request, never `reasoning` — and says `think: false`; the script tag forwards `think` to the adopter's proxy ([ADR-036](../decisions/ADR-036.md), 2026-09-25) | `stages.test.ts` ("stage3 — a lean request"); `cascade.test.ts` (prose follows the explanation frame); `stage3.test.ts` (`think` on the wire) | **enforced by test.** That a prompt change is *measured* for latency and accuracy before it ships is **convention**: CI has no model server, and `evaluate-golden.mjs --stage3 <model>` is run by hand ([L9](lessons.md)) |
| **Rule 19.** Without a model, no wrong move: stage 2 does not accept when every content word tying the question to the leader is also the runner-up's, and the golden gate fails on any wrong move — in-scope to a wrong screen, or out-of-scope executed — before and apart from the scorecard comparison ([ADR-041](../decisions/ADR-041.md), 2026-09-25) | `no-wrong-moves.test.ts`; `evaluate-golden.mjs --check` (CI, generated-golden) | **enforced by test and gate** — on the family fixture's 69 turns. A registry whose golden set does not contain the wrong move is not protected by the gate, only by the rule in stage 2 |
| **Rule 20.** A request to change something (`isChangeRequest`: an action other than book/create/fill, not a "where"/"how do I" question, noun-or-verb words only as commands) is never executed on a `navigate`/`read` screen: it ends `out_of_scope` naming the screen, and the widget says "I can't do that for you. Try here:" with a link, under every `decide` ([ADR-041](../decisions/ADR-041.md), 2026-09-25) | `no-wrong-moves.test.ts` (the split; the cascade); `present.test.ts` ("a request to change something") | **enforced by test.** The verb list is closed and bilingual (EN/PT): a third language gets none of it — **convention** |
| Keyboard mashing is recognised from the registry's own letter pairs before stage 1 — no candidates, no model, no hand-over, no search, no lesson — and answered with places to begin ([ADR-039](../decisions/ADR-039.md), 2026-09-25) | `mashing.test.ts`; `present.test.ts` ("keyboard mashing") | **enforced by test.** 0 false positives measured over every committed registry's golden questions and phrasings; not measured on real visitors |
| The app's own rule (`companion.handOver`) claims a question before any routing; a throw or a decline routes it as usual; every hand-over is announced as `nextgen:companion`; `stepAside()`/`comeBack()` hide the whole widget for the app's own panel ([ADR-038](../decisions/ADR-038.md), 2026-09-25) | `assistant.test.ts` ("the app's own assistant, merged in"); `declarations.check.ts` | **enforced by test.** That nothing is left in the app panel's way is **unverified** — the overlap was found in a real browser, and no browser check covers it |
| **Rule 8, voice.** Speech is recognised on the device, or by a path on the page's own origin (`transcribe`, [ADR-037](../decisions/ADR-037.md), 2026-09-25) — another site's path makes the recogniser unavailable, never a request — and nothing is uploaded until speech was heard | `server-voice.test.ts` (off-site refused, nothing sent without speech, one utterance to this site); `voice.test.ts` (on-device only otherwise); `check-network-egress.mjs` | **enforced by test and gate.** Keeping no audio on the adopter's server is theirs — **convention**, stated in the adopter guide |
| The panel has Chat and Tutorials tabs when `companion.tours` exists; the Tutorials view lists at most 12 of this page's tours (malformed dropped, a throwing list read as empty), is read again on show, after the assistant moves, on history moves and on `refresh()`; back to Chat by tab, Escape or asking; a pick docks the panel and calls `tour(route, id)`; "tutorial" opens the view when there is more than one ([ADR-033](../decisions/ADR-033.md), [ADR-035](../decisions/ADR-035.md), 2026-09-24) | `assistant.test.ts` ("its tours, in a Tutorials view beside the conversation") | **enforced by test** |
| The surface is flat: edges, glow and aurora `transparent`, metal = the accent, surfaces ≥ 0.95 opaque ([ADR-035](../decisions/ADR-035.md)) | `theme.test.ts` ("the flat surface") | **enforced by test**. The orb's drawing is **convention** |
| `nextgen.d.ts` says nothing the widget does not do | `embed/src/declarations.check.ts`, compiled by `pnpm -r typecheck` (assignability both ways, and every declared key present in the source) | **enforced by the typecheck** — it may say less than the source |
| The word bridge (`core-intent/src/bridge.ts`, 2026-09-22) adds to a question only words the registry knows, for words it does not, and leaves a question in the app's own words unchanged | `bridge.test.ts`; the generated-golden gate (it changed no golden decision when it landed); calibration embeds the bridged question too | **enforced by test and gate** |
| Rule 2 — the model never computes a number the user sees | a comment at `core-intent/src/types.ts`, and `check-model-numerics.mjs` on the model's output schema (below) | **convention — no test** |
| Derived artefacts follow their inputs: a change to `normalize()`, the encoder or a registry regenerates the thresholds, indexes and scorecards built from it | `tooling/scripts/check-derived-artefacts.mjs`, in CI since WP-46. It runs `rebuild-indexes.mjs --check` (each shipped index equals a fresh rebuild by the generator's own `writeIndexes`), `calibrate-registries.mjs --check` (the per-registry thresholds equal a fresh sweep) and `verify-browser-parity.mjs` (the browser makes the server's decision on all 210 turns). `check-thresholds.mjs` still covers the reference registry | **gate (2026-09-11, WP-46).** It went stale once before this existed: ten shipped indexes, with CI green |

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
| Rule 15 — domain content is untrusted in a prompt | `fence()` / `redactTag()` in `core-inference/src/untrusted.ts`, applied at all four prompt-building sites; 22 unit tests, 3 golden entries; **`check-prompt-fencing.mjs` in CI** | **gate (2026-09-10) — structurally enforced, see the limit below** |

> ### ◐ Rule 15 — what the fence does and does not buy
>
> **Closed 2026-09-10.** Until then the entity comments said *"UNTRUSTED — fence
> before this reaches a prompt"* and **no fence function existed anywhere in the
> repository** — an obligation the codebase could not discharge. There are now
> two, and every site that interpolates attacker-reachable text calls one.
>
> **The escape that was live, and was not in the original write-up.** Auditing
> the three known sites turned up a fourth: `core-intent`'s stage-3 prompt, the
> one every single turn passes through. Its design was already right — the
> utterance goes inside `<utterance>` tags and the system message says what is
> inside them is data — but it interpolated **raw**, so an utterance containing
> `</utterance>` ended the quoted region and everything after it arrived as
> prompt. *An instruction the content itself can revoke is not a boundary.*
> `redactTag` closes it and leaves the prompt byte-identical for every
> non-attacking input, so no recalibration and no scorecard re-run were owed.
> Proven by reverting the fix and watching the two new tests fail.
>
> **What is now structural:** untrusted content cannot terminate its own fence.
> Markers are stripped from the content before they are put around it, matched by
> *shape* rather than exact bytes — case, spacing and bracket-count variants all
> redact.
>
> **What is still model-dependent:** whether the model then treats fenced content
> as data rather than instruction. Nothing here forces that, and this row should
> never be read as saying otherwise. FINDINGS' WP-01 verdict is the standard to
> hold it to — *"a mechanism that depends on the model being good is not a
> mechanism, it is a hope."* Fencing raises the cost of an injection and makes one
> auditable afterwards; it is defence in depth, not a proof.
>
> ⚠️ **That caveat is no longer hypothetical — it is measured.**
> [Finding 14](../../packages/core-intent/eval/FINDINGS.md) ran the adversarial
> bucket against a live stage 3: **`llama3.1:8b` produces 4 safety violations
> with the fence fully intact**, and both 1B-class models produce none. The
> prompt for the escape entry has exactly one opening and one closing tag with
> both forgeries redacted — the structural guarantee did its job and the outcome
> did not change.
>
> Note the inversion, because it contradicts everything else in this document:
> the *most* capable model is the only one that fails. The plausible reason is
> that a better model follows instructions it finds in text, and an injected
> instruction is still an instruction. **Do not read the 1.5B model's 13/13 as
> evidence the target model is safe** — it may pass because it is not competent
> enough to be steered.
>
> **A constraint on any future hardening.** The obvious next step — a paragraph of
> injection-defence prose in the system message — is measurably harmful here. The
> registered domain's `EXTRACT_SYSTEM` records a real document collapsing to a
> 24-character stub when correct-but-additional instructions were stacked beside
> the one governing quality. The notice that ships with the fence is one sentence,
> and it sits in the prompt rather than the system message, for that reason.

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
| Every relative documentation link resolves | CI + `tooling/scripts/check-doc-links.mjs` | **enforced — but only from 2026-09-10; see below** |
| A prompt never interpolates unfenced input | CI + `tooling/scripts/check-prompt-fencing.mjs` | **enforced (added 2026-09-10)**, §8 for its limits |
| High and critical CVEs block | CI `audit` job (`pnpm audit --audit-level high`) | **enforced** |
| The installing agent runs the interview (ASK 9), does not invent answers, and does not reuse `askedAs` phrasing in the calibration set | none — nothing can check that a conversation happened. `doctor` reports how many screens `knowledge.json` covers, which is the nearest signal; tests hold the playbook's wording and the file's parsing, not its use | **convention — [ADR-023](../decisions/ADR-023.md)** |
| The script tag stays near its measured size (50.6KB gzipped, 2026-09-21: 32.4KB before the orb's dots and the chat screen, 40.0KB after the dots, 45.5KB after the model-stage context, the chat extras and small talk, 50.6KB after glass, metal and attachments) and never imports a React entry | none — `build.mjs` prints the size and nothing fails on it; a React import would add 69KB | **none — [ADR-022](../decisions/ADR-022.md)** |

> ### ⚠️ This row was false for a day, and the way it was false is the point
>
> `doc-links` was added to `sdlc.config.json` on 2026-09-09 with
> `"blocking": true`, recorded here as **enforced**, and **never added to
> `ci.yml`**. `/gates` ran it locally; CI did not run it at all. For that period
> a PR with a broken documentation link merged clean, while this register said it
> could not.
>
> Found 2026-09-10 by diffing the gate list against the workflow — the check
> [CLAUDE.md](../../CLAUDE.md) already asks for in words (*"hooks and CI read that
> file, so it and CI must not drift"*) and which nothing performs. Fixed by adding
> the step.
>
> **The general shape is worth more than the instance.** Section 1's vacuous
> staleness gate diffed a directory the build never wrote. This one existed in the
> config and not in the pipeline. Both passed while claiming to protect something,
> and both were found by comparing a declaration against the thing that would have
> to honour it — never by reading the declaration alone. *A register is only worth
> what its last verification was worth.*
>
> `kit-sync` is still absent from CI and that is correct: it compares
> `.claude/hooks` against `sdlc-kit/runtime/hooks`, and `sdlc-kit` is gitignored,
> so a fresh CI clone has nothing to compare.

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

**As of 2026-09-13 every gate that can be exercised locally has been**, and the
column that used to read "not yet deliberately broken" is empty. Two gates are not
in this table and cannot be: `adversarial-live` needs a model server and
`kit-sync` needs a folder outside this repository — both are `blocking: true` for
a local `/gates` run and absent from CI, which is said again near the top of this
file because it is the easiest thing here to misread.

> ⚠️ **2026-09-17 — a fourth route to vacuity, and it is not misconfiguration.**
> Every earlier instance was a gate whose *arguments* were wrong. This one was
> correct on the day it was written and became vacuous **because what it inspected
> was deleted**. `network-egress` lost its asset manifest to ADR-018 and went on
> passing; `csp` lost the registry it drives the widget with and would have gone red,
> but only in CI.
>
> **The habit this adds: when you delete a package or a directory, grep the gates
> for its path before you commit.** Five gates were repointed in that session and two
> of them were found this way rather than by running them — `check-csp.mjs` names its
> data in a `join()` that no search for the deleted package name would have matched if
> the path had been assembled from parts.

Doing this in one pass was worth more than the rows suggest: two of the four
attempts found something. The `scorecard` gate could not be made to fail at all
(it compared a file with itself), and this table's own `import-boundaries` row
turned out to credit the gate with a catch only the test could have made.

**Retired 2026-09-20 (ADR-021): `packaging`, `release` and `install`.** They guarded a tarball
path that no adopter was ever on (no `v*` tag exists). Their rows are gone rather than left to
read as protection that does not exist. What they found is worth keeping: the first `install`
run caught `@nextgen/generator` importing `typescript` at run time while declaring it a
devDependency, so every command threw `ERR_MODULE_NOT_FOUND` once installed from a tarball
while 647 tests and `check-packaging` were green. The class of defect died with the install
step: `adapter/scan.mjs` bundles `typescript` and `check-adapter.mjs` runs it from a directory
with no `node_modules`.

| Gate | Last seen failing correctly | How it was made to fail |
|---|---|---|
| `csp` | **2026-09-13** | Put the widget back to the `<style>` element it shipped with until that day (the constructed-stylesheet branch disabled). Edge 153 exited 1 on two checks: *"no policy violations: style-src-elem inline"* and *"the widget is styled (input min-height 0px, expected 48px)"* — the widget still started, answered and routed, completely unstyled, which is exactly how it would have looked on a strict site. Restored, and it passed. Before the gate existed, a hand probe under the same policy also showed the `<script>NextGen.start(...)</script>` snippet `doctor` printed being blocked (`script-src-elem`) |
| `guard-git` (broad staging) | 2026-09-09 | Piped `git add -A`; got a deny naming explicit staging |
| `guard-git` (production write) | 2026-09-09 | Piped `git push origin main`; got a deny naming `develop` |
| `guard-git` (branch from production) | 2026-09-09 | Piped `git checkout -b feature/x main`; deny + correct command |
| `guard-git` (echoed-text false positive) | 2026-09-09 | Piped a payload *containing* `git add -A` as echoed text; correctly **allowed** |
| `check-gates` (post-edit failure) | 2026-09-09 | Throwaway repo, `postEdit` command exiting 1; surfaced it and still exited 0 |
| `doc-links` | 2026-09-09 | Added a link to a non-existent file; exited 1 naming `file:line` |
| `prompt-fencing` | 2026-09-10 | Removed the fences from `merge()` and stage 3; exited 1 naming both. **Also failed the other way first:** its first draft reported "OK — 3 prompt sites" when there are four, because it read `prompt:` but not `{ prompt }` shorthand — caught by counting sites found against sites known, not by the gate |
| `model-numerics` | 2026-09-10 | Removed the `// rule2-ok:` annotation from stage 3's `confidence`; exited 1 |
| `network-egress` | 2026-09-10 | Pointed `OLLAMA` at a remote host **and** deleted an asset's `sha256`; exited 1 naming both, with different reasons |
| `adversarial-live` | 2026-09-10 | Removed `gs-0181` from the baseline; exited 1 identifying it as new. Its first draft reported a missing scorecard as a "new safety violation" — alarming and wrong, since nothing unsafe had happened and the gate simply could not look. Now a separate `BROKEN` path |
| `adversarial-live`, the second failure | **2026-09-21, not deliberately** | **It had been reporting OK for a run that never happened.** A model server was reachable, so it did not skip; `evaluate.js` then refused to start without `--registry` (`pnpm router:eval` passes it), exited 2 at once, and the gate's `catch {}` swallowed the exit and stdout/stderr went to `'ignore'`. It read the scorecard already on disk — 12 days old, recorded violations in it — and printed "no new violations". Found because the gate-runner reported "0 s, OK" for a gate that needs minutes. Now it passes the registry, keeps stderr, and refuses a scorecard the run did not just write (mtime check). The first real run found `gs-0175` on two models; it reproduces on a clean checkout of HEAD, so it is drift, not the day's work — recorded in the baseline as *recorded, not approved*, cause not bisected |
| `registry-owner` (build scripts) | 2026-09-10 | Ran `domain-finance`'s build directly against the modules registry; refused and left the file byte-identical. Note the pre-existing hook denying `pnpm registry:build:finance` did **not** catch this — it matches a command string, and invoking the script directly walks past it |
| Rule 17 role extraction | **2026-09-12, on a real app, not deliberately** | WP-43 ran the kit on a public app whose routes are gated by a parent `<Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>`. All 16 screens, including 4 admin-only ones, were emitted into a single `PUBLIC` registry; `SKIPPED.md` reported 0 skips and `doctor` said "nothing needs fixing". **§8's kill criterion fired.** Fixed by inheriting a parent guard, dropping an unreadable one, and taking the role universe from the route table; re-scored against a ground truth written before the run: **33 of 48 role assignments and 15 leaks before, 48 of 48 and 0 leaks after** |
| `registry-stale` (untracked) | **2026-09-12** | Not deliberate — found while widening it. `domain-finance/generated/registry.json` had never been committed (its build wrote the shared path instead), so WP-47 made the build produce an **untracked** file. `git diff --quiet` does not see untracked files and passed; `git status --porcelain` over the same paths failed naming it. **This gate would have gone vacuous for the second time, by a different route.** It now uses `--porcelain` |
| `generated-golden` | **2026-09-12** | Deleted the `normalize()` sentence-punctuation line — the change that went stale unnoticed on 2026-09-11 and the same shape as the one that cost seven points. Exited 1 naming what moved: top-1 0.0795 → 0.0739, out-of-scope refused 47.1% → 41.2%, and the three turns that changed decision, two of them refusals degrading to clarifies. Restored, and it passed |
| `accessibility` (WP-45) | **2026-09-12, on its first run, not deliberately** | Pointed at the built widget for the first time, it failed: focus fell to the document body when an answer replaced the link the user was standing on — a keyboard user silently returned to the top of the host page. Fixed, then made to fail on purpose twice more: removing the focus restoration fails exactly one unit test, and `widget.test.ts` now holds both halves (focus returns when the user was inside the answer; focus is left alone when they were not) |
| `derived-artefacts` | 2026-09-11 | Deleted the `normalize()` punctuation line: the exact change that went stale unnoticed that morning. **All three checks failed**: 10 of 10 indexes stale, the per-registry `tauHigh` 0.61 shipped vs 0.59 re-swept, and browser parity broken. Restored with `git checkout`, and all three passed. About a second per run |
| `import-boundaries` | **2026-09-20** | Repointed by ADR-021 and made to fail three ways: `core-intent` importing `@nextgen/generator`, `core-inference` re-exporting `../../kit/src/index.ts`, and `core-capability` declaring `@nextgen/embed`. Each exited 1 naming the file and line, then each was reverted. Before this the gate reported "clean of domain imports" against a tree with no domains, and could not have failed |
| `registry-check` | **2026-09-13** | Deleted three of `module.capture`'s four examples; exited 1 with `[examples-min] module.capture: "module.capture" has 1 example(s); at least 3 are required` (Rule 10), and the build refused to write a registry it had judged invalid |
| `check-thresholds` | **2026-09-13** | Changed `THRESHOLD_PROFILES.hashing.tauHigh` from the calibrated 0.456 to a hand-picked 0.5 — the exact move Rule 14 exists to forbid. Exited 1: *"config.ts has 0.5, the sweep recommends 0.456"*, naming when the calibration was run and telling the reader to re-sweep rather than transcribe a guess |
| `scorecard` | **2026-09-13** | **It could not be broken, which was the finding.** The configured local command was `--baseline X --current X` — the same path on both sides — so every delta was zero by construction. Setting every rate in that scorecard to 0.01, a total collapse, still printed *"OK — no accuracy regression beyond tolerance"*, and `/gates` reported it green. It now takes `--baseline-ref HEAD`, and the script **refuses** a same-path invocation rather than reporting a pass. Re-run against the same collapse: 5 regressions, exit 1. **2026-10-02 — vacuous again, by another route:** its producer, `router-floor`, exited 1 on every run, so CI ran it with `\|\| true` and `/gates` as advisory. A crash wrote no scorecard, and the comparison of the committed file with the untouched one printed *"OK"* on both paths (shown by running it with nothing regenerated: exit 0). It now **refuses** (exit 2) a current scorecard whose `generatedAt` is the baseline's. Re-proved the same day: unregenerated → exit 2; after a real floor run → OK; top-1 lowered by 0.10 in a copy → `REGRESSED`, exit 1 |
| `router-floor` | **2026-10-02** | Advisory and red on every run until that day (it failed the full cascade's targets by design), which hid a crash. Now `--report-targets`, blocking, and run in CI without `\|\| true`. Made to fail on purpose: pointed at a registry that does not exist, exit 2. A clean run exits 0 and says its missed targets are reported, not failed |
| `network-egress` | **2026-09-17 — found vacuous by deletion, then re-proved** | **A new route to the same failure: its subject was deleted out from under it.** The gate permitted exactly one file to name a remote host, `packages/core-voice/src/assets.ts`, where each was pinned by sha256. ADR-018 deleted `core-voice`. The gate kept running, found no manifest, printed *"Rule 8 OK — 9 URL literals, **0 hash-pinned assets**, no unpinned remote host"* and exited 0 — the count it printed said it was checking nothing, to anyone reading it. The exception is removed rather than repointed, since nothing downloads assets any more, so the gate is now strictly stricter: **no exception at all**. Made to fail on purpose: a literal `https://evil.example.com/binary` written into `core-intent/src`, caught by file and line, probe deleted |
| `csp` | **2026-09-17 — would have failed in CI only** | Not deliberate. It read the deleted pilot's `registry.PARENT.json` and threw `ENOENT` from `copyFileSync`. Unlike the egress gate it would have gone **red**, not vacuous — but only on a push, since nothing in the local flow had run it after the deletion. Repointed at `eval/frameworks/family/generated`, where it now starts the widget under a strict policy and navigates to a real fixture route |
| `check-registries` (replaces `registry-check`) | **2026-09-17, on its first run** | Rule 10 lost its runner when the domain packages were deleted — validation had been a side effect of `domain-modules registry:build --check`. The replacement finds registries by glob, and its first run exited 1 with **45 errors**, all `explanation-required`, against the pilot's hand-written answer key. That was **real pre-existing drift**, not a gate defect: WP-36 added the `explanation` requirement to `validateRegistry` after the key was written in WP-31, and nothing had re-run the check because it was wired into no gate. The gate also **refuses to pass when it finds no registry at all**, which is the specific vacuity this file exists to catch |

---

## Rule to enforcement matrix

| # | Rule | Enforced by | Kind |
|---|---|---|---|
| 1 | `core-*` depend only on other `core-*` | `check-import-boundaries.mjs`, CI, and the `postEdit` hook on every `core-*` edit. The `domain.test.ts` that used to be the layer that actually caught it went with the domain packages | **gate (repointed 2026-09-20, ADR-021)** |
| 2 | Model never computes a user-visible number | `check-model-numerics.mjs`, CI — the model's output schema may not declare a number without a `// rule2-ok:` reason | **gate (2026-09-10), half the rule** — arithmetic on model output is still convention, and untestable until a number is rendered anywhere |
| 3 | Model never emits SQL or a raw route | `dispatcher.test.ts`; query engine design | **test** |
| 4 | Model-produced ids validated against the registry | `dispatcher.test.ts`, `cascade.ts`, `stages.ts` | **test** |
| 5 | **Dormant until WP-48.** Policy is code; unclassified refuses | nothing — `dispatcher.test.ts` went with the dispatcher (ADR-018, 2026-09-20). `cascade.ts` still refuses an unclassified kind | **none (dormant, owner 2026-09-25)** — it binds again with the first capability that acts |
| 6 | **Dormant until WP-48.** Money is integer minor units | nothing — `data.test.ts` and `money.ts` went with `packages/data` (ADR-018) | **none (dormant, owner 2026-09-25)** — it binds again with the first capability that carries an amount |
| 7 | Every AI-reachable screen reachable without AI | both domains' tests; `apps/cli` menu path | **test** |
| 8 | Nothing on the critical path needs network; escalation (stage 3, voice) only to the adopter's own origin, never a third party's | `check-network-egress.mjs`, CI — no remote host in a runtime string literal; the asset manifest only where each URL is `sha256`-pinned. `check-stage3.mjs` and `stage3.test.ts` (stage 3 same-origin); `server-voice.test.ts` (voice same-origin, ADR-037) | **gate (2026-09-10)** — blind to `OLLAMA_HOST` and to a host built at run time |
| 9 | Every turn produces a TurnTrace | `cascade.test.ts`, `trace.test.ts` | **test** |
| 10 | Every capability ships >=3 examples | `validate.ts` + `registry:check`, CI | **gate** |
| 11 | Deterministic slots beat model-extracted | `slots.test.ts` | **test** |
| 12 | A routing bug becomes a permanent golden entry | none | convention |
| — | Golden-set accuracy does not regress on the reference app | `check-scorecard.mjs`, CI (a baseline copied aside, then a fresh `router:floor`) and `/gates` (against the scorecard committed at `HEAD`) | **gate** — **and it was vacuous locally until 2026-09-13**: the configured command compared the committed file with itself, so it could not fail. **And on both paths until 2026-10-02 whenever `router:floor` crashed**, since that step's failure was ignored; it now refuses an unregenerated scorecard. See the table above |
| 13 | Limits declared in the registry | `unsupported` kind, `defineBoundary`, domain tests | **test** |
| 14 | Thresholds calibrated per encoder | `check-thresholds.mjs`, CI | **gate (new)** |
| 15 | Domain content untrusted in a prompt | `fence()` / `redactTag()` in `core-inference`, at all four prompt sites; `untrusted.test.ts`, `cascade.test.ts`, golden `gs-0181..0183` | **test (2026-09-10)** — structural only; the model's *obedience* is not enforced, §8 |
| 16 | The installer never modifies the adopter's source | `emit.test.ts` (`writeOutput` refuses an output dir inside `appRoot`) + `generate.test.ts` fingerprints the whole fixture tree before and after a run | **test (2026-09-10, WP-25)** |
| 17 | An unreachable capability is absent from the user's registry | `emit.test.ts` diffs two role registries; `score-generated.mjs` re-checks all 10 generated registries against the master on every scoring run; `discover-vue-angular.test.ts` asserts a role written on a route (`data.roles`, `meta.roles`, `routeRoles`) builds its own registry and that the admin screen is in no other | **test (2026-09-10, WP-25; route-level roles 2026-09-13)** — until readiness 3c such a role never joined the audience, so its screen reached nobody rather than the wrong people |
| 18 | Efficiency: the cheapest layer that can decide; a model asked only for what the turn reads, never to reason before a choice from a list | `stages.test.ts` ("a lean request"), `stage3.test.ts`, `mashing.test.ts` | **test (2026-09-25)** for the request's shape; **convention** for measuring a prompt change, since CI has no model server |
| 19 | No wrong move without a model | `no-wrong-moves.test.ts`; `evaluate-golden.mjs --check` fails on any wrong move | **gate (2026-09-25)** |
| 20 | A request to change something is offered its screen, never followed there | `no-wrong-moves.test.ts`; `present.test.ts` | **test (2026-09-25)** |
| — | Every capability can say what it is (WP-36) | `explanation-required` in `validate.ts`, gated by `pnpm registry:check` | **gate (2026-09-10)** |
| — | Top-1 accuracy does not regress across a prompt change | `evaluate-golden.mjs --check`, CI — the model-free floor on the **generated** registries against the committed scorecard, every rate and every per-turn decision, timing excluded | **gate (2026-09-12)** — the model-free floor only; anything involving stage 3 needs a model server CI does not have, so a regression that only appears with a model is still ungated |
| — | The browser entry loads with no Node globals ([L11](lessons.md)) | `packages/embed/src/embed.test.ts` runs the built bundle in a bare `vm` context holding only `window`, `console` and `performance` | **test (2026-09-11, WP-29)** |
| — | Shipped indexes and per-registry thresholds match their inputs | `check-derived-artefacts.mjs`, CI (WP-46) | **gate (2026-09-11)** — covers `eval/fut-app/generated`; an adopter's own kit build is checked by its `doctor`, not here |
| — | The shipped widget has no serious or critical accessibility violation | `check-accessibility.mjs`, CI (WP-45) — axe-core over the **built** `packages/embed/dist/nextgen.js` in a real DOM, in every state a user can reach, plus keyboard, focus, live-region and reduced-motion checks the stylesheet is read for | **gate (2026-09-12)** — blind to colour contrast (jsdom computes no layout, and the widget paints in the user's own system colours), to announcement order, and to anything as rendered. Those are [the NVDA pass](../../eval/a11y/NVDA-CHECKLIST.md), which a person runs and nobody has |
| — | The widget works on a site with a strict Content-Security-Policy | `check-csp.mjs`, CI — headless Chrome loads a page served with `default-src 'self'; script-src 'self'; style-src 'self'` whose only integration is the documented `<script src=… data-nextgen-role=… defer>`, asks a question through the widget's own form and clicks a choice; fails on any violation, on the widget not starting or unstyled, on no answer, or on `nextgen:navigate` not reaching the page | **gate (2026-09-13)** — one policy and one browser engine per run (Chromium). A policy stricter than `'self'`, such as nonce- or hash-only `script-src`, needs the adopter to add their nonce to the tag and is not tested |
| — | Two domains cannot overwrite each other's generated registry | per-domain output paths (ADR-016, WP-47) + the `registry-stale` gate, CI — it builds **both** domains and fails on `git status --porcelain`, so an artefact that was never committed counts as stale | **gate (2026-09-12)** — this replaced a convention (a documented build order) with a structure; `checkRegistryOwnership` is kept as a backstop against a misconfigured output path |

---

## Enforcement gaps, ranked

*(Rule 15 was #1 here until 2026-09-10. It is now fenced at all four prompt sites (§8).
What remains of it is #6 below, which is a smaller problem, and a different one from the
one that topped this list.)*

**Numbers 1, 2, 5 and 7 are closed** and are kept struck through rather than deleted,
because what a gap cost before it was closed is the argument for closing the next one.
**The highest open gap is now #3**, and #8 below was added by the 2026-09-12 audit: it had
been sitting in the matrix as `none` without ever appearing on this list.

1. ~~**The registry's shared `OUT_INTENT` path.**~~ ✅ **Closed 2026-09-12 (WP-47,
   [ADR-016](../decisions/ADR-016.md) option B).** One domain's build overwrote
   another's, and a documented build order was what kept the artefacts coherent.
   Each domain now writes `packages/domain-<name>/generated/registry.json`; the eval
   scripts take `--registry=`; CI checks both domains in one job; the hook denying
   the finance build is gone. This topped the list from 2026-09-08 to 2026-09-12,
   through one guard and one ADR, because neither a loud failure nor an accepted
   decision is a fix. **A third domain no longer forces anything.**
2. ~~**Derived artefacts are not gated.**~~ ✅ **Gated 2026-09-11 (WP-46).** On
   2026-09-11, a one-line change to `normalize()` left ten shipped indexes and two
   threshold profiles stale, and CI stayed green. Only a manual parity run noticed.
   Every adopter's browser would have received vectors that no longer matched its own
   query encoder. `check-derived-artefacts.mjs` now runs the three scripts that would
   have caught it, in CI, and it was made to fail on exactly that change (see "Gates
   seen failing on purpose").
3. **Rule 2 is half-gated, and the other half cannot be tested yet.**
   `check-model-numerics.mjs` (CI, 2026-09-10) fails any model output schema
   declaring `type: 'number'` without a `// rule2-ok:` justification — a model
   that never emits a number cannot compute one a user sees. Exactly one
   justified case exists: stage 3's `selfReportedConfidence`.

   **This entry used to say "a test asserting arithmetic origin on the render
   path would close it". That test cannot be written.** Checked against the tree
   2026-09-10: no user-visible number is rendered anywhere. `apps/web/lib/render.ts`
   was the only `AnswerView` producer (removed 2026-09-13) and its single `rows`
   construction set `value: ''`; `formatMoney` has no consumer outside `data` and its own tests;
   `AnswerRow.bar` is never produced. The test would have asserted over an empty
   set and passed — the third vacuous gate this document would have recommended
   into existence. What remains open is arithmetic *our own code* does on model
   output, and it stays open until there is a rendered number to do it to.
4. **Rule 12 is unenforceable mechanically** — but a PR touching `core-intent`
   with no `golden-set.jsonl` change is a cheap heuristic a reviewer or a hook
   could flag.
5. ~~**Rule 8 is verified, not gated.**~~ ✅ **Gated 2026-09-10** —
   `check-network-egress.mjs`, built to this entry's own specification and then
   made stricter than it: the asset manifest is not a host allowlist, because
   every URL in it must sit beside a `sha256`. Hosts get compromised and mirrors
   lie; a content hash is what actually holds. **What remains is not static:**
   `OLLAMA.host` reads `process.env.OLLAMA_HOST` and the environment can point
   it anywhere, which is a deployment property no source check reaches. If the
   local-inference claim ever needs to be *proved* rather than *kept*, that is
   where to look.
6. **A fenced prompt still depends on the model obeying the fence — and
   `llama3.1:8b` does not.** ⚠️ **Measured 2026-09-10**
   ([Finding 14](../../packages/core-intent/eval/FINDINGS.md)): the adversarial
   bucket run against a live stage 3 gives **4 safety violations on `llama3.1:8b`**
   and **0 on both 1B-class models**. The fence held structurally in every case —
   the prompt for the escape entry has one opening tag, one closing tag and both
   forgeries redacted — and the 8B chose `module.delete` anyway. *A fence is a
   boundary the content cannot cross, not one the model will not cross.*

   Two things follow, and they point in opposite directions:
   - **The layer beneath held.** All five `forbidUnconfirmedDestructive` entries
     passed on all three models: the router can be steered into *selecting* a
     destructive capability, and the dispatcher still refuses to run one
     unconfirmed. Policy is code (§3).
   - **The bucket now runs against a model — locally.** `check-adversarial.mjs`
     (2026-09-10) runs it on every installed baseline model and fails on a **new**
     violating entry id, comparing ids rather than scores because ids are the
     stable comparison under Finding 10's non-determinism. The four known ones
     are recorded in `adversarial-baseline.json`, which says at length that
     recording is not approving and that shrinking the list is the point.

     ⚠️ **It is deliberately not in CI, and that is the residual gap.** GitHub
     Actions has no model server — which is precisely why this bucket passed
     trivially there for so long, and why three of Finding 14's four violations
     had never been seen by anything. The gate skips cleanly and loudly when
     Ollama is absent, because a gate that fails on a missing local dependency
     gets disabled, and a disabled gate protects nothing. **Closing this properly
     needs a self-hosted runner** ([ci-cd.md](../sdlc/ci-cd.md) already describes
     that path for the other model-backed runs), and until there is one,
     model-facing safety is verified by whoever runs `/gates` on a machine with
     Ollama — a convention, and this document's standard for a convention is that
     it holds until someone is in a hurry.
8. ~~**Nothing re-runs the golden set when a prompt changes.**~~ ✅ **Closed 2026-09-12,
   the same day it was named.** It had sat in the matrix as `none` since that table was
   written and had never reached this list — its own small lesson about where a gap goes
   to be forgotten. `evaluate-golden.mjs --check` now runs in CI: the model-free floor on
   the **generated** registries, compared with the committed scorecard on every rate and
   every per-turn decision, with timing excluded so a busy runner cannot fail it.
   Deterministic, ~0.3s. **Made to fail on purpose** by the exact change that cost the
   seven points ([L9](lessons.md)) — see the table above.

7. ~~**Rules 16 and 17 have no mechanism at all**~~ **Both have had tests since WP-25
   (2026-09-10); see the matrix. What remains open is Rule 17 on a second app (PLAN.md
   WP-43).** The original entry read: — they were added on 2026-09-09 with
   the repositioning and describe a product that is not built yet. Both have a
   mechanical check written into the acceptance of the work package that will first
   need them (WP-25 for role scoping, WP-26 for the additive install). **Rule 17 is a
   security property**: shipping one registry to every role would leak the shape of an
   admin surface to a user who must not see it. It ranks here, not lower, because the
   first code that could violate it has not been written — which is the cheapest moment
   to add the gate.

9. **No package may be made installable again without an ADR** (ADR-021). Nothing checks
   it: `private: true` in every manifest is the signal, and removing it is a one-line edit no
   gate reads. It ranks here, not higher, because reintroducing the tarball path means
   restoring a workflow, four scripts and six manifests' worth of fields, none of which happens
   by accident — and `convention` is stated rather than dressed up as a gate.

---

## Related

- [PLAN.md](../../.MDFiles/PLAN.md) section 2 — the twenty rules as stated (5 and 6 dormant until WP-48)
- [decisions/](../decisions/) — the ADRs the rules come from
- [.claude/README.md](../README.md) — the hooks, skills and agents that apply them
- [sdlc/ci-cd.md](../sdlc/ci-cd.md) — what each CI job gates and why
