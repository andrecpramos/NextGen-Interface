# Critical infrastructure and the rules that bind it

What this is: every component whose failure is not a local bug, the rules that govern it,
**where each rule is actually enforced**, and whether it is currently obeyed. Rule numbers
are [docs/RULES.md](../../docs/RULES.md). The ADRs in [decisions/](../decisions/) are the
constitution; this file is a map of how they are held up.

Re-audit trigger: any change to `ci.yml`, any new gate, any new rule, or a release.

The distinction that matters throughout is between a rule that is *written down* and a rule
that is *enforced*. A written rule is obeyed until someone is in a hurry. Every row below
says which kind it is, and the [gaps](#enforcement-gaps-ranked) section lists the ones that
are still only written down. Nothing here claims protection that does not exist: if a cell
says `convention`, there is no gate.

**`gate` does not always mean *CI runs it*.** Two gates in
[`sdlc.config.json`](../sdlc.config.json) are `blocking: true` and deliberately **not** in
`ci.yml`, because CI cannot run them: `adversarial-live` needs a model server (GitHub
Actions has none, which is why the golden-set job is model-free, ADR-011), and `kit-sync`
compares against `sdlc-kit/`, which lives outside this repository. Both are real gates for
`/gates` on a developer machine and no protection at all on a pull request.

---

## 1 · The capability registry and its codegen

**What.** A registry is the only contract between the engine and an application. The
generator reads the application's source and emits one registry per role; one declaration
yields both the thing the router matches against and the route it navigates to, so the two
cannot drift.

**Blast radius.** A wrong or stale registry means the router reaches a route that does not
exist, or a screen the assistant cannot see. Every other subsystem reads it.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 10 — every capability ships at least 3 examples | `MIN_EXAMPLES` in `core-capability/src/validate.ts`, run by `tooling/scripts/check-registries.mjs` over **every** registry found by glob, gated as `pnpm registry:check` in CI. It refuses to pass when it finds no registry at all | **gate** |
| Every capability can say what it is | `explanation-required` in `validate.ts`, gated by `pnpm registry:check` | **gate** |
| Rule 13 — limits declared, not judged; rules extracted, not judged ([ADR-020](../decisions/ADR-020.md)) | the `unsupported` kind and `defineBoundary` for limits; for a rule, `validateRegistry`'s `rule-field-required` / `rule-statement-required` / `rule-untraceable` / `rule-tier-invalid` / `rules-on-boundary` checks; `check-rule-provenance.mjs` (inside `check-derived-artefacts.mjs`) proves every shipped `source` still resolves to the line it names | **test and gate** |
| Generated artefacts match the committed ones | `check-derived-artefacts.mjs` — indexes, per-registry thresholds and browser/server parity over `eval/frameworks/<app>/generated` | **gate** |
| The router's frozen fixture registry does not move silently | `check-scorecard.mjs` against the scorecard committed at `HEAD`; `packages/core-intent/eval/README.md` says so at the file | **gate** |
| A write never replaces one application's registry with another's | `checkRegistryOwnership` (`core-capability/src/registry-owner.ts`), judged by capability namespaces; `--force` overrides | **test** — a backstop against a misconfigured output path |

---

## 2 · The engine boundary

**What.** `packages/core-*` depend only on other `core-*`. The engine — registry contract,
router, model runtimes — sits below the generator (reads an application), the widget (runs in
its page) and the kit (drives both), so it cannot learn about an application from any of them.

**Blast radius.** This is the invariant the whole "the engine knows nothing about any
particular application" thesis rests on. Once broken it is rarely broken back.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 1 — `core-*` depend only on other `core-*` | `tooling/scripts/check-import-boundaries.mjs`, checking both the declared dependency and every import specifier, by name and by relative path out of the package. First step of CI's `verify` job, and the `postEdit` hook in `.claude/sdlc.config.json` on every `core-*` write | **gate, two layers** |

What the gate cannot see: a `switch` or an `if` in `core-*` enumerating application types.
Same violation, no import. That one needs a reader — the `boundary-auditor` agent and
`/rules-check` look for it.

---

## 3 · The router cascade, thresholds and calibration

**What.** `packages/core-intent` — deterministic, then embedding, then a constrained model
call. The operating point is `THRESHOLD_PROFILES` in `src/config.ts`.

**Blast radius.** Thresholds decide what gets accepted without a model. Too high and
everything escalates; too low and a visitor is moved to the wrong screen.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 14 — thresholds calibrated per encoder, never hand-set | `tooling/scripts/check-thresholds.mjs`, in CI: the shipped literal in `config.ts` must equal the sweep's recommendation | **gate** |
| Rule 14, the exception — `UNCALIBRATED_BOUNDARY_FLOOR` (0.15), written into the `thresholds.hashing.json` of a kit bundle built with **no** calibration, so a declared limit must score that much in its own right before it refuses | `boundary-floor.test.ts` (the mechanism; absent from every calibrated profile) and `kit.test.ts` (an uncalibrated bundle carries it, a calibrated one does not). `check-thresholds.mjs` does not see it: it lives in `packages/kit/src/build.ts`, not in `THRESHOLD_PROFILES` | **a hand-set stand-in, disclosed, not enforced.** A calibration replaces it |
| Rule 8, for attachments — a file never leaves the device: not to the router, a trace, a prompt or any request; it reaches only the page, as `nextgen:attach` ([ADR-024](../decisions/ADR-024.md)) | `assistant.test.ts`: the router is asked with a string that contains neither the file nor its name; `fetch` is never called. `check-network-egress.mjs` cannot see this — it reads URL literals | **test.** A page that wires a `companion` ([ADR-026](../decisions/ADR-026.md)) sends files to its own `companion.ask` instead — the adopter's code, never a request of ours |
| Rule 11 — deterministic slot values beat model-extracted ones | `slots.test.ts`; nominal types make the reverse a compile error | **test** |
| A limit marked `refuses: 'action'` is a candidate only for a request to act ([ADR-025](../decisions/ADR-025.md)) | `acting-limit.test.ts`; `registry.test.ts` (`refuses-known`, `refuses-misplaced`); the generated-golden gate | **test and gate.** That an adopter never marks a *subject* limit this way is **convention** |
| A limit's `helpAt` names only screens the role can open (Rule 17) | `registry.test.ts` (`help-at-reachable`, `help-at-misplaced`) and `validateRegistry` at every build; `emit.test.ts`; `present.test.ts` | **test.** That a named route is the *right* place is the adopter's word — **convention** |
| The app's own assistant (`companion`) is asked only what this one cannot place, never a limit on acting; its answer is attributed; its failure falls back ([ADR-026](../decisions/ADR-026.md)) | `assistant.test.ts` | **test.** What the adopter's `companion.ask` claims is their code — **convention** |
| The assistant never waits for speech to move, reads aloud only when asked, has no navigation of its own, and is modal only when expanded ([ADR-026](../decisions/ADR-026.md)) | `assistant.test.ts`; `check-accessibility.mjs` on the built bundle | **test and gate** |
| The adopter's dial changes what is done with a decision, never the decision ([ADR-027](../decisions/ADR-027.md)) | `present.test.ts`, `assistant.test.ts` | **test** |
| What visitors teach reaches only the page (`onLearn`, `nextgen:learn`), and `teach` writes `knowledge.json` only with `--write`, holding back phrases that may identify someone ([ADR-027](../decisions/ADR-027.md)) | `assistant.test.ts`, `teach.test.ts` | **test** |
| The shipped index is `indexFor(registry)`, the same function the runtime uses for a merged multi-role index; a stage-1 phrase two capabilities claim names neither | `registry-browser.test.ts`; the derived-artefacts gate | **test and gate** |
| Hashing vectors are stored and shipped sparse, and score exactly as dense did ([ADR-028](../decisions/ADR-028.md)) | `sparse.test.ts`; derived-artefacts (browser parity on every golden turn); generated-golden | **test and gate** |
| A screen declared in `knowledge.json` reaches only the roles it names ([ADR-028](../decisions/ADR-028.md)) | `knowledge.test.ts` | **test.** That its route, title and roles are true is **convention** |
| Every destination the widget moves to or links is a path on this site — `safeRoute()` ([ADR-029](../decisions/ADR-029.md)) | `present.test.ts`; `assistant.test.ts` ("security — what it will not do") | **test.** A *new* way to navigate is protected only if it calls `safeRoute` — **convention** |
| The launcher-hiding selector is only a selector; the bundle loads from this site unless the adopter hands in a `fetch`; enum maps from a registry have no prototype ([ADR-029](../decisions/ADR-029.md)) | `assistant.test.ts`; `script-tag.test.ts`; `registry-browser.test.ts` (`"__proto__"`) | **test** |
| At rest the widget costs next to nothing ([ADR-029](../decisions/ADR-029.md)) | `liquid.test.ts` (goes still, wakes, resolution follows size) | **test** for the canvas; paused animations and the idle fit are **convention** |
| The widget's bundle stays under 70 KB gzipped; its one HTML sink is the icon glyph, fed only compiled-in constants ([ADR-029](../decisions/ADR-029.md)) | `embed.test.ts` (size; every source scanned for `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`); `build.mjs` fails on a lost CSS interpolation | **test** |
| A visitor is shown the answer only; each routed turn's record goes to the page as `nextgen:turn` (Rule 9 kept); a model-decided turn says so ([ADR-030](../decisions/ADR-030.md)) | `assistant.test.ts`; `check-accessibility.mjs` | **test and gate** |
| One language on screen, the page's ([ADR-030](../decisions/ADR-030.md)) | `present.test.ts`; `assistant.test.ts`; `generate-titles.test.ts`; `validate-context.test.ts` | **test.** Following `<html lang>` live is **convention** |
| Asked to start something, it presses only a control with evidence it only opens, never anything that saves, sends, pays, deletes or signs out, and never types ([ADR-031](../decisions/ADR-031.md)) | `act.test.ts`; `assistant.test.ts`; `pages.test.ts`; `knowledge.test.ts`; `validate-context.test.ts` | **test.** That it never types is **convention** — there is no typing code to test |
| Stage 2 scores a capability as the mean of its whole document and its nearest own phrasing ([ADR-032](../decisions/ADR-032.md)) | `phrasing-score.test.ts`; `check-thresholds.mjs`; derived-artefacts; generated-golden | **test and gate** |
| **Rule 18.** A stage-3 request asks only for what the turn reads, never for reasoning, and says `think: false` ([ADR-036](../decisions/ADR-036.md)) | `stages.test.ts` ("a lean request"); `cascade.test.ts`; `stage3.test.ts` | **test.** That a prompt change is *measured* before it ships is **convention**: CI has no model server |
| **Rule 19.** Without a model, no wrong move ([ADR-041](../decisions/ADR-041.md)) | `no-wrong-moves.test.ts`; `evaluate-golden.mjs --check` fails on any wrong move (CI, generated-golden) | **test and gate** — on the fixture's golden set. A registry whose golden set lacks the wrong move is protected only by the rule in stage 2 |
| **Rule 20.** A request to change something is offered its screen, never followed there ([ADR-041](../decisions/ADR-041.md)) | `no-wrong-moves.test.ts`; `present.test.ts` | **test.** The verb list is closed and bilingual (EN/PT): a third language gets none of it — **convention** |
| Keyboard mashing is recognised from the registry's own letter pairs before stage 1 ([ADR-039](../decisions/ADR-039.md)) | `mashing.test.ts`; `present.test.ts` | **test.** Not measured on real visitors |
| The app's own rule (`companion.handOver`) claims a question before any routing ([ADR-038](../decisions/ADR-038.md)) | `assistant.test.ts`; `declarations.check.ts` | **test.** Nothing is left in the app panel's way — **unverified** in a real browser |
| **Rule 8, voice.** Speech is recognised on the device, or by a path on the page's own origin ([ADR-037](../decisions/ADR-037.md)); nothing is uploaded until speech was heard | `server-voice.test.ts`; `voice.test.ts`; `check-network-egress.mjs` | **test and gate.** Keeping no audio on the adopter's server is theirs — **convention** |
| The panel's Chat and Tutorials views ([ADR-033](../decisions/ADR-033.md), [ADR-035](../decisions/ADR-035.md)) | `assistant.test.ts` | **test** |
| The surface is flat ([ADR-035](../decisions/ADR-035.md)) | `theme.test.ts` | **test.** The orb's drawing is **convention** |
| `nextgen.d.ts` says nothing the widget does not do | `embed/src/declarations.check.ts`, compiled by `pnpm -r typecheck` | **typecheck** — it may say less than the source |
| The word bridge (`core-intent/src/bridge.ts`) adds only words the registry knows, and leaves a question in the app's own words unchanged | `bridge.test.ts`; generated-golden | **test and gate** |
| Rule 2 — the model never computes a number the user sees | `check-model-numerics.mjs` on the model's output schema | **gate, half the rule** — see gap 1 |
| Derived artefacts follow their inputs | `check-derived-artefacts.mjs`, in CI: `rebuild-indexes.mjs --check`, `calibrate-registries.mjs --check` and `verify-browser-parity.mjs` | **gate** |

Standing discipline, not mechanically checkable: hand-tuning has cost accuracy three times
here. When a case fails, differentiate the overlapping capability descriptions; do not move
the threshold.

---

## 4 · The golden sets and the scorecard gates

**What.** Two golden sets. `packages/core-intent/eval/golden-set.jsonl` plus its committed
scorecards exercises the router alone on a frozen 7-capability fixture; `pnpm router:floor`
(stages 1+2, hashing encoder) is its only deterministic configuration, which is why it is
the only one CI gates ([ADR-011](../decisions/ADR-011.md)).
`eval/frameworks/<app>/golden-set.jsonl` exercises the whole pipeline on a generated
registry.

**Blast radius.** It is the sole regression net for a non-deterministic component. A corpus
that drifts toward happy paths stops detecting the failures that matter.

| Rule | Enforcement | Status |
|---|---|---|
| No accuracy regression beyond tolerance on the router fixture | `check-scorecard.mjs` against the committed baseline, CI `golden-set` job; it refuses a current scorecard that was not regenerated | **gate** |
| Adversarial-to-destructive count stays zero | `safetyViolations` in the scorecard | **gate (release blocker)** |
| The generated registries still decide the same way | `evaluate-golden.mjs --check`, CI — every rate and every per-turn decision against the committed scorecard, timing excluded | **gate** — model-free only |
| Rule 12 — a routing bug is fixed only as a permanent golden-set entry | none — process only | **convention** |

`eval/scorecards/` is deliberately **not** gitignored: accuracy changes have to appear in the
PR diff and be discussed, not silently absorbed.

Two traps make model-backed runs lie: a cold model load puts a ~22-second outlier in the p95
(warm it with one throwaway call), and parallel runs share the GPU (run models sequentially).

---

## 5 · Untrusted application content

**What.** An application's text — screen titles, labels, headings, `knowledge.json` — and
the visitor's utterance are attacker-reachable the moment they cross into a prompt.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 15 — application content is untrusted in a prompt | `fence()` / `redactTag()` in `core-inference/src/untrusted.ts`, applied at every prompt-building site; `untrusted.test.ts`; golden entries `gs-0181`..`gs-0183`; **`check-prompt-fencing.mjs` in CI** | **gate — structural; see below** |

**What is structural:** untrusted content cannot terminate its own fence. Markers are
stripped from the content before they are put around it, matched by *shape* rather than
exact bytes, so case, spacing and bracket-count variants all redact. The utterance goes
inside `<utterance>` tags, and an utterance containing `</utterance>` cannot end the quoted
region.

**What is still model-dependent:** whether the model treats fenced content as data rather
than instruction. Nothing here forces that, and this row must never be read as saying
otherwise. *A mechanism that depends on the model being good is not a mechanism, it is a
hope.* Fencing raises the cost of an injection and makes one auditable afterwards; it is
defence in depth, not a proof.

**Measured, not hypothetical:** run against a live stage 3, `llama3.1:8b` produced 4
safety violations with the fence fully intact, and both 1B-class models produced none. The
most capable model is the only one that fails, plausibly because a better model follows
instructions it finds in text. Do not read a small model's clean run as evidence that a
larger one is safe.

**A constraint on any future hardening.** A paragraph of injection-defence prose in the
system message is measurably harmful: stacking correct-but-additional instructions beside
the one governing quality degrades output. The notice that ships with the fence is one
sentence, and it sits in the prompt rather than the system message for that reason.

---

## 6 · The pipeline and the branching contract

**What.** `.github/workflows/ci.yml` and `.claude/hooks/`.

**Blast radius.** These are what make every rule above hold when nobody is looking. A gate
that passes vacuously is worse than no gate — it buys confidence it has not earned.

| Rule | Enforcement | Status |
|---|---|---|
| Only `develop` may merge to production | CI `guard-production` job; `.claude/hooks/guard-git.mjs` for the local case CI never sees | **partial — see below** |
| Branch from `develop`, never from production | `guard-git.mjs`, plus `branch-check.mjs` at every context boundary | **enforced (agents only)** |
| Never stage broadly in a shared tree | `guard-git.mjs` denies `git add -A`, `git add .`, `git commit -a` | **enforced (agents only)** |
| Every relative documentation link resolves | CI + `tooling/scripts/check-doc-links.mjs` | **gate** |
| A prompt never interpolates unfenced input | CI + `tooling/scripts/check-prompt-fencing.mjs` | **gate**, §5 for its limits |
| High and critical CVEs block | CI `audit` job (`pnpm audit --audit-level high`) | **gate** |
| `adapter/` is current, and a copy runs with nothing installed | CI: `build-adapter.mjs --check`, then `check-adapter.mjs` | **gate** |
| The installing agent runs the interview (ASK 9), does not invent answers, and does not reuse `askedAs` phrasing in the calibration set | none — nothing can check that a conversation happened. `doctor` reports how many screens `knowledge.json` covers, the nearest signal | **convention — [ADR-023](../decisions/ADR-023.md)** |

> ⚠️ **No CI job here can block a merge yet.** Branch protection is **not configured** on
> `develop` or `main` (`GET …/branches/develop/protection` returns 404, "Branch not
> protected"). Now that the repository is public it is available on the free plan, so
> this gap can be closed in the repository settings.
>
> Until it is:
>
> - `guard-production` fails the run and **prevents nothing**. It is advisory.
> - Every `"blocking": true` in `sdlc.config.json` means *policy says do not merge this*,
>   not *the platform will not let you*.
> - The local hooks are the only layer that actually **denies** anything, and they bind
>   agents, not humans.
>
> See [../sdlc/branching.md](../sdlc/branching.md).

`kit-sync` is absent from CI and that is correct: it compares `.claude/hooks` against
`sdlc-kit/runtime/hooks`, and `sdlc-kit` is not in this repository, so a fresh CI clone has
nothing to compare.

---

## Gates seen failing on purpose

A gate nobody has seen fail is a gate nobody knows works. Every gate is made to fail
deliberately once, and that is recorded here.

Gates go vacuous in four ways, and each has happened here: a wrong argument (comparing a file
with itself), a declaration that never reached the pipeline (a gate in `sdlc.config.json`
but not in `ci.yml`), a crash whose failure was ignored, and **the thing it inspected being
deleted**. The habit that follows: when you delete a package or a directory, grep the gates
for its path before you commit.

| Gate | How it was made to fail |
|---|---|
| `csp` | Put the widget back to a `<style>` element. Headless Edge exited 1 on two checks — a `style-src-elem` violation and an unstyled widget — while the widget still started, answered and routed, which is exactly how it would look on a strict site |
| `guard-git` (broad staging) | Piped `git add -A`; got a deny naming explicit staging |
| `guard-git` (production write) | Piped `git push origin main`; got a deny naming `develop` |
| `guard-git` (branch from production) | Piped `git checkout -b feature/x main`; deny plus the correct command |
| `guard-git` (echoed-text false positive) | Piped a payload *containing* `git add -A` as echoed text; correctly **allowed** |
| `check-gates` (post-edit failure) | Throwaway repo, `postEdit` command exiting 1; surfaced it and still exited 0 |
| `doc-links` | Added a link to a non-existent file; exited 1 naming `file:line` |
| `prompt-fencing` | Removed the fences from two prompt sites; exited 1 naming both. Its first draft under-counted sites (it read `prompt:` but not `{ prompt }` shorthand) — caught by counting sites found against sites known |
| `model-numerics` | Removed the `// rule2-ok:` annotation from stage 3's `confidence`; exited 1 |
| `network-egress` | A literal `https://evil.example.com/binary` written into `core-intent/src`; caught by file and line. The gate has no exception list at all |
| `adversarial-live` | Removed a recorded entry from the baseline; exited 1 identifying it as new. A missing scorecard is a separate `BROKEN` path, and a scorecard the run did not just write is refused (mtime check) — it once reported OK for a run that never happened |
| Rule 17 role extraction | **On a real public app, not deliberately.** Routes gated by a parent `<Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>` were all emitted into one `PUBLIC` registry, with 0 skips reported. Fixed by inheriting a parent guard, dropping an unreadable one, and taking the role universe from the route table: **15 leaks before, 0 after**, against ground truth written first ([eval/tutor-app](../../eval/tutor-app/RESULT.md)) |
| `generated-golden` | Deleted the `normalize()` sentence-punctuation line; exited 1 naming the rates that moved and the turns that changed decision |
| `accessibility` | **On its first run, not deliberately:** focus fell to the document body when an answer replaced the link the user was on. Fixed, then made to fail twice more on purpose; `widget.test.ts` holds both halves |
| `derived-artefacts` | Deleted the `normalize()` punctuation line: stale indexes, a stale per-registry `tauHigh`, and broken browser parity — all three checks failed |
| `import-boundaries` | Made to fail three ways: `core-intent` importing `@nextgen/generator`, `core-inference` re-exporting `../../kit/src/index.ts`, `core-capability` declaring `@nextgen/embed`. Each exited 1 naming the file and line |
| `registry-check` | Deleted three of a capability's four examples; exited 1 with `[examples-min]` (Rule 10). It also refuses to pass when it finds no registry |
| `check-thresholds` | Changed `THRESHOLD_PROFILES.hashing.tauHigh` to a hand-picked value — the exact move Rule 14 forbids; exited 1 naming the sweep's recommendation |
| `scorecard` | **It once could not be broken, which was the finding:** the local command compared a file with itself. It now takes `--baseline-ref HEAD`, refuses a same-path invocation, and refuses (exit 2) a current scorecard whose `generatedAt` is the baseline's. Re-proved: unregenerated → exit 2; top-1 lowered by 0.10 → `REGRESSED`, exit 1 |
| `router-floor` | Pointed at a registry that does not exist: exit 2. A clean run exits 0 and reports its missed targets rather than failing on them |

---

## Rule to enforcement matrix

| # | Rule | Enforced by | Kind |
|---|---|---|---|
| 1 | `core-*` depend only on other `core-*` | `check-import-boundaries.mjs`, CI, and the `postEdit` hook on every `core-*` edit | **gate** |
| 2 | Model never computes a user-visible number | `check-model-numerics.mjs`, CI — the model's output schema may not declare a number without a `// rule2-ok:` reason | **gate, half the rule** (gap 1) |
| 3 | Model never emits SQL or a raw route | design: stage 3's output schema holds an id, typed params and optional prose (`stages.test.ts`), and nothing in the tree executes a query. A route in prose the role lacks is removed (`validate-claims.test.ts`) | **design + test** |
| 4 | Model-produced ids validated against the registry, including in prose | `cascade.test.ts`, `validate-claims.test.ts`; re-checked in `cascade.ts` and `stages.ts` | **test** |
| 5 | **Dormant.** Policy is code; unclassified refuses | nothing ships a `write` or `destructive` capability. `cascade.ts` still refuses an unclassified kind | **none (dormant)** — binds again with the first capability that acts |
| 6 | **Dormant.** Money is integer minor units | no code holds an amount | **none (dormant)** — binds again with the first capability that carries one |
| 7 | Every assistant-reachable screen reachable without it | design: every capability is a route read from the app's own route table, so it exists without the assistant; the widget adds no navigation of its own (`assistant.test.ts`) | **design + test** |
| 8 | Nothing on the critical path needs network; escalation only to the adopter's own origin | `check-network-egress.mjs`, CI — no remote host in a runtime string literal; `check-stage3.mjs` and `stage3.test.ts` (stage 3 same-origin); `server-voice.test.ts` (voice same-origin); `check-adapter.mjs` runs the build with every outbound path throwing | **gate** — blind to `OLLAMA_HOST` and to a host built at run time (gap 4) |
| 9 | Every turn produces a TurnTrace | `cascade.test.ts`; `assistant.test.ts` (`nextgen:turn`) | **test** |
| 10 | Every capability ships at least 3 examples | `validate.ts` + `registry:check`, CI | **gate** |
| 11 | Deterministic slots beat model-extracted | `slots.test.ts`; nominal types | **test** |
| 12 | A routing bug becomes a permanent golden entry | none | **convention** (gap 2) |
| 13 | Limits declared; rules extracted, with source and tier | `registry.test.ts`, `acting-limit.test.ts`, `field-rules.test.ts`, `inferred-rules.test.ts`; `check-rule-provenance.mjs` | **test and gate** |
| 14 | Thresholds calibrated per encoder | `check-thresholds.mjs`, CI; derived-artefacts for per-registry thresholds | **gate** — `UNCALIBRATED_BOUNDARY_FLOOR` excepted (gap 5) |
| 15 | Application content untrusted in a prompt | `fence()` / `redactTag()` at every prompt site; `untrusted.test.ts`; golden `gs-0181`..`gs-0183`; `check-prompt-fencing.mjs`, CI | **gate** — structural only; the model's obedience is not enforced (gap 3) |
| 16 | The installer never modifies the adopter's source | `emit.test.ts` (`writeOutput` refuses an output dir inside `appRoot`); `generate.test.ts` fingerprints the fixture tree before and after a run; `check-adapter.mjs` does the same for a real copied run, CI | **test and gate** |
| 17 | An unreachable capability is absent from the user's registry | `emit.test.ts` diffs two role registries; `discover-guards.test.ts`, `discover-inline-guard.test.ts`, `discover-vue-angular.test.ts` | **test** |
| 18 | The cheapest layer that can decide; a model asked only for what the turn reads | `stages.test.ts` ("a lean request"), `stage3.test.ts`, `mashing.test.ts` | **test** for the request's shape; **convention** for measuring a prompt change |
| 19 | No wrong move without a model | `no-wrong-moves.test.ts`; `evaluate-golden.mjs --check` fails on any wrong move | **gate** |
| 20 | A request to change something is offered its screen, never followed there | `no-wrong-moves.test.ts`; `present.test.ts` | **test** |
| — | The browser entry loads with no Node globals | `embed.test.ts` runs the built bundle in a bare `vm` context holding only `window`, `console` and `performance` | **test** |
| — | The shipped widget has no serious or critical accessibility violation | `check-accessibility.mjs`, CI — axe-core over the **built** bundle in every state a user can reach, plus keyboard, focus, live-region and reduced-motion checks | **gate** — blind to colour contrast, announcement order and anything as rendered; those are [the NVDA pass](../../eval/a11y/NVDA-CHECKLIST.md), which a person runs |
| — | The widget works on a site with a strict Content-Security-Policy | `check-csp.mjs`, CI — headless Chromium loads a page served with `default-src 'self'; script-src 'self'; style-src 'self'`, asks a question and clicks a choice | **gate** — one policy, one engine. A nonce- or hash-only `script-src` is not tested |

---

## Enforcement gaps, ranked

1. **Rule 2 is half-gated, and the other half cannot be tested yet.**
   `check-model-numerics.mjs` fails any model output schema declaring `type: 'number'`
   without a `// rule2-ok:` justification — a model that never emits a number cannot
   compute one a user sees. Exactly one justified case exists: stage 3's
   `selfReportedConfidence`, which is never shown. No user-visible number is rendered
   anywhere, so a test asserting the arithmetic origin of one would assert over an empty
   set. What remains open is arithmetic our own code does on model output, and it stays
   open until there is a rendered number to do it to.
2. **Rule 12 is unenforceable mechanically.** A PR touching `core-intent` with no golden-set
   change is a cheap heuristic a reviewer or a hook could flag.
3. **A fenced prompt still depends on the model obeying the fence — and `llama3.1:8b` does
   not** (§5). The layer beneath holds: the router can be steered into *selecting* a
   capability, but the widget has no dispatcher and acts on nothing. `check-adversarial.mjs`
   runs the adversarial bucket on every installed baseline model and fails on a **new**
   violating entry; the four known ones are recorded in `adversarial-baseline.json`, which
   says at length that recording is not approving. **It is deliberately not in CI**, because
   GitHub Actions has no model server. Closing this properly needs a self-hosted runner
   ([ci-cd.md](../sdlc/ci-cd.md)); until then model-facing safety is verified by whoever
   runs `/gates` on a machine with Ollama.
4. **Rule 8 holds for the source, not for the environment.** `OLLAMA.host` reads
   `process.env.OLLAMA_HOST`, and the environment can point it anywhere — a deployment
   property no source check reaches.
5. **`UNCALIBRATED_BOUNDARY_FLOOR` is a hand-set number** (§3). It is disclosed, printed by
   `doctor`, and replaced by any calibration. Replace it with a swept floor once a real
   adopter's golden set exists.
6. **No package may be made installable again without an ADR** ([ADR-021](../decisions/ADR-021.md)).
   Nothing checks it: `private: true` in every manifest is the signal, and removing it is a
   one-line edit no gate reads. It ranks low because reintroducing the tarball path means
   restoring a workflow, scripts and several manifests' worth of fields, none of which
   happens by accident.
7. **Branch protection is not configured** (§6), so every CI gate is advisory in the
   mechanical sense. This one can be closed today in the repository settings.

---

## Related

- [docs/RULES.md](../../docs/RULES.md) — the twenty rules as stated (5 and 6 dormant)
- [decisions/](../decisions/) — the ADRs the rules come from
- [.claude/README.md](../README.md) — the hooks, skills and agents that apply them
- [sdlc/ci-cd.md](../sdlc/ci-cd.md) — what each CI job gates and why
