# PLAN archive — what PLAN.md said before 2026-09-20

**Verbatim.** Moved out of [PLAN.md](PLAN.md) on 2026-09-20 because it described a state that no
longer existed and made the current one impossible to see: a queue mixing finished work, obsolete
pilot numbers and owner to-dos, and two sections written about the tree and the pilot application
as they stood *before* the 2026-09-17 reset ([ADR-018](../.claude/decisions/ADR-018.md)).

**Kept, not deleted, because it is the record.** [ADR-013](../.claude/decisions/ADR-013.md) cites
§3 and §4 by number, and the queue is the account of how M5 and M6 were built and what shipping
them found. **Nothing below is current** — where it disagrees with the code, the code wins.
For the state as it is, read [STATUS.md](STATUS.md); for what is open, [PLAN.md](PLAN.md) §0.

Several links and names below point at files that no longer exist (`fut-app`, `domain-*`,
`core-dispatch`, `INSTALL.md`). That is the past being described accurately; they are not
corrected here.

---

## §0 as it stood on 2026-09-18 — the queue, the readiness table, the decisions

### The queue

**Phase: M5 — the two folders (2026-09-17).** M0–M2 are closed, M3's engineering is
built, and M4 produced a working CLI kit. The reset in ADR-018 changed what "done" means
for M4: the unit of distribution is no longer eight tarballs from a private release, it
is **a folder copied into the adopter's repository and handed to their coding agent**.

**M5 is two directories, and neither exists yet in full:**

| | What it is | Who reads it | State |
|---|---|---|---|
| **`adapter/`** | What the adopter copies. Zero npm, zero network. | **their coding agent** | ✅ **built 2026-09-17** — `AGENTS.md`, `FIELD-NOTES.md`, `scan.mjs` (3.6MB, no dependencies), `runtime/nextgen.js`. Two blocking gates |
| **`preview/`** | The bench: see the result, judge the UI, the model and the voice. | **the owner** | ✅ **built 2026-09-17** — `pnpm preview`. Bench with the full trace, the mock app with the real widget, host-page variants |

> ## ▶️ M5 is done; M6 is done — 2026-09-18
>
> **M6 makes it an assistant rather than a menu**, and it is the largest change of
> direction since ADR-013. Three ADRs accepted in one session: a model at run time over the
> adopter's own origin ([ADR-017](../.claude/decisions/ADR-017.md)), the model writing to
> visitors with every claim validated ([ADR-019](../.claude/decisions/ADR-019.md)), and
> rules extracted from the adopter's code with provenance
> ([ADR-020](../.claude/decisions/ADR-020.md)). Four work packages in §7.8, in an order
> that was not negotiable — and **all four are done**: a same-origin transport, off by
> default; a model that may now write to a visitor with every claim it makes checked
> against that visitor's own registry before they see it; every control's own validation,
> read with the file and line it came from; and, the riskiest of the four, what a form's
> own handlers appear to require, shipped only when the pattern is exact and measured at
> **0% wrong** before it shipped rather than after.
>
> **What shipping WP-53 actually found**, and it is the kind of finding worth naming: the
> first version of the action-claim detector flagged *"this screen is called Settings"*
> and *"shows recently added players"* — ordinary, safe sentences that happen to share a
> bare word with a completion-claim list. Caught by writing the false-positive tests
> before trusting the mechanism. English now needs a first-person or passive frame around
> the verb; Portuguese forms stay bare, because they are genuinely rare outside a
> completion claim. This is the exact shape of mistake WP-53's Stop-if exists to catch,
> found during the build rather than after.
>
> **WP-54 found the same kind of thing from the opposite direction — a reason to stop
> rather than a bug to fix.** Two of ADR-020's five read-tier sources — a route guard's
> requirement, the navigation hierarchy — turned out to reproduce a leak `emit.ts` already
> has a name for: stripping the `roles` annotation from a shipped registry exists precisely
> because telling one role who else can reach a screen is itself a disclosure. Stating that
> same fact in prose, or shipping a nav tree with another role's labels in it, is the
> identical leak in a new shape. Left undone, and said so in §7.8 rather than shipped
> quietly with the rest.
>
> **WP-55 — "the risky one" — is the only work package in M6 whose deliverable was a
> measurement, not just a mechanism.** ADR-020's inferred tier reads what a submit
> handler's own code appears to require: a disabled button, a guard that bails out with a
> message. 19 realistic scenarios, read against the source the way WP-42 read generated
> descriptions: **14 shipped, 0% wrong, 1 vague.** Both defects the measurement found were
> fixed before anything shipped — `setFieldError('field', 'message')` was reading the
> field's own name as if it were the message (fixed: take the *last* string literal, not
> the first), and a disabled checkbox's sentence-shaped label read as a run-on through the
> noun-phrase template (fixed: phrased the way `steps.ts` already phrases a checkbox's
> guided step). The Stop-if — more than 5% wrong — did not fire, and it did not fire
> because it was actually checked, not assumed safe from the shape of the code.
>
> **Two rules were tightened by this, not loosened.** Rule 4 now covers identifiers inside
> prose, and Rule 16 now enumerates the five edits an agent may make rather than leaving it
> to judgement. Rule 9 was restated: it was always about explainability, and had been read
> as "no model text at all" — that reading is corrected in `TurnTrace`'s and `whyFor`'s own
> doc comments now, not just in this file. Rule 13 gained the sibling ADR-020 named for it:
> a rule is extracted, never judged by the model, exactly like a limit is declared rather
> than inferred — and that now covers both tiers, not only the one WP-54 shipped first.
>
> **The number M6 exists to move:** stages 1 and 2 settle **15.7%** of turns; the rest ask
> the visitor back. All four work packages built the pipe, the safety check and the app's
> own knowledge of itself — its forms' declared shape and, now, what their handlers appear
> to require; whether the number actually moves is a question about a real deployment's
> real questions, which nothing built so far has measured. That is still honest to say now
> that M6 itself is closed: measuring it is its own, separate piece of work.
>
> M5 is closed: **WP-49 and WP-50 are both built**, and what is left of it is the owner's.
>
> **Both folders exist and both are checked by running them**, not by asserting about
> them — `pnpm adapter:check` copies the adapter into a scratch directory with no
> `node_modules` above it and runs init, build and doctor for real; `pnpm preview:check`
> loads the bench in a headless browser and asserts two turns from the committed golden
> set. Between them they found six defects that 602 unit tests could not see, because
> every one lived in a built artefact rather than in source.
>
> **The next thing is the owner's acceptance run (WP-35), and it is now cheap to start:**
> copy `adapter/` into any real application, paste its path into a coding agent, and read
> what `doctor` says. [ACCEPTANCE-RUN.md](ACCEPTANCE-RUN.md) has the procedure and it names no
> application.
>
> **What changed about the owner's items.** Three of the four were defined against the
> private pilot application and its generated artefacts, which are deleted (ADR-018):
>
> | | Was | Now |
> |---|---|---|
> | WP-45 | The NVDA pass, 17 items | **unchanged** — [NVDA-CHECKLIST.md](../eval/a11y/NVDA-CHECKLIST.md) survives, ~15 min |
> | WP-44 | Record 20 pt-PT utterances against Whisper/Piper | **void.** `core-voice` is deleted; the voice an adopter's users get is the browser's, on-device (§7.7) |
> | WP-42 | Mark 25 pilot descriptions right/vague/wrong | **generalised.** The readable-app finding (15 right, 4 vague, 1 wrong of 20) stands and is in FIELD-NOTES §3; the pilot sheet is gone |
> | WP-35 | Drop the kit into the pilot, deploy, measure | **still the acceptance test, and no longer names an app.** [ACCEPTANCE-RUN.md](ACCEPTANCE-RUN.md) is written against any real application |
>
> **The claims stay where they were measured**: *"automated accessibility checks pass; no
> screen reader has confirmed it"*, and no cost-per-session figure at all.
>
> **WP-48** is still deferred behind its trigger: before any `write` or `destructive`
> capability ships to an adopter (§7.5, §8). The trigger has not fired.

| # | Work package | Milestone | Size | Who |
|---|---|---|---|---|
| 1 | ✅ **WP-52** · **Stage 3 over the adopter's own origin, done 2026-09-18.** `SameOriginLlmRuntime`: resolves against the page, refuses off-origin, never throws. `--stage3 <path>` off by default. Proved live, not asserted: `check-stage3.mjs` builds a real bundle with kit and loads it with embed across a mocked network, disabling the origin check to confirm the gate catches it. `kit`/`embed` deliberately do not share the config type across their DOM-lib boundary — see the WP note | M6 | M | done |
| 2 | ✅ **WP-53** · **The assistant writes, and the validator checks it, done 2026-09-18.** `prose` on stage 3's schema; `validateClaims` drops any sentence naming a screen not in *this role's* registry, claiming to have acted, or stating a number — whole sentences, never edited. Found and fixed before shipping: the first lexicon flagged *"this screen is called Settings"* as an action claim; English now needs a qualifying frame, Portuguese forms stay bare (rarer as ordinary words). *Why?* discloses a count, never the removed text | M6 | L | done |
| 3 | ✅ **WP-54** · **Extract what the application states, done 2026-09-18.** ADR-020 read tier: native attributes plus zod/yup schemas bound through react-hook-form, each rule carrying its file and line. What a guard requires and navigation-as-a-relation deliberately not shipped — both would reproduce the exact role leak `emit.ts`'s `withoutRoles` exists to prevent | M6 | M–L | agent |
| 4 | ✅ **WP-55** · **Infer what the application does, done 2026-09-18.** ADR-020 inferred tier: a disabled-submit condition, a submit handler's own early-return guard. 19 candidates on a read sample, 14 shipped, **0% wrong** (1 vague) — well under the 5% bar. Two phrasing/argument-order bugs found and fixed before shipping | M6 | L | agent |
| 5 | ✅ **WP-51** · **The reset**, done 2026-09-17 ([ADR-018](../.claude/decisions/ADR-018.md)). Deleted the six packages reachable only from the terminal demo, `apps/cli`, the pilot's eval data and ~40 experiment scripts — **~18,700 lines**. Nothing on the shipping path broke: 602 tests, typecheck clean, and the golden-set gate still reports *"every rate and every decision matches"*. Rule 10's runner was rebuilt wider (12→5 registries by glob, validating files nothing had validated before); the egress gate was found **passing vacuously** and made stricter; five gates were repointed at fixtures, none retired. `adapter/FIELD-NOTES.md` carries what the pilot taught, with no trace of the pilot | M5 | L | done |
| 6 | ✅ **WP-49** · **`adapter/`, done 2026-09-17.** `AGENTS.md` as the entry point — seven `ASK` sections carried from the field-tested playbook — plus `scan.mjs`, one 3.6MB dependency-free bundle of init/build/doctor/calibrate, and `runtime/nextgen.js` prebuilt. **Proved by running it**, not asserted: `check-adapter.mjs` copies the committed folder and a fixture app into a scratch directory outside this repository and runs the real commands; 12 checks including Rule 17 and Rule 16 (38 files unchanged). **Five defects found, every one invisible to 602 unit tests** because every one was a failure of the bundle in a bare directory — the worst being `build` resolving the widget through `node_modules`, which shipped a bundle with no assistant in it while `doctor` called it a warning | M5 | L | done |
| 7 | ✅ **WP-50** · **`preview/`, done 2026-09-17.** `pnpm preview`. Three surfaces on one server: `/bench` (ask, and see the whole trace — every candidate stage 2 scored, **with the description it was scored on**), the mock app with the **real widget** mounted, and host-page variants for placement. Seeded by moving `packages/embed/demo` wholesale — which still read the deleted pilot data, making it the last live reference ADR-018's sweep missed. Checked in a real browser by `preview/check-bench.mjs` | M5 | M–L | done |
| 8 | ◐ **WP-41** · The drop-in kit, **built 2026-09-11**, `calibrate` added 2026-09-12. `nextgen init/build/doctor` ran on bulletproof-react and **modified 0 of its files**. Calibrating from the kit's own examples was measured **not usable**, and the uncalibrated default misroutes on a big app, so `doctor` says so. One line mounts an accessible chat box. **`nextgen calibrate` now exists** — it requires a golden set the adopter wrote, refuses below 20 turns, reports held-out numbers and warns when the result is worse than it looks; run end to end on bulletproof-react ([note](../eval/bulletproof-react/RESULT.md)). The sweep moved to `core-intent/src/calibrate.ts`, shared, so Rule 14 has one implementation. **Left: the owner's run** | M4 | M | **owner** |
| 9 | ✅ **WP-46** · Gate the derived artefacts, **done 2026-09-11**. `check-derived-artefacts.mjs` runs in CI, covering index staleness, per-registry calibration and browser/server parity. Re-breaking the `normalize()` fix turned all three red, and restoring it turned them green. About a second per run | M4 | S | done |
| 10 | ◐ **WP-42** · Audit the generated descriptions, **agent half done 2026-09-11**. Read against source on 3 apps: **15 right, 4 vague, 1 wrong** of 20. The wrong one described an error boundary's fallback as the screen; **two extraction bugs are fixed with tests**. Mechanically on `fut-app`: **9 of 145 share a description with another screen**. **Left:** the owner marks 25 rows (`DESCRIPTION_AUDIT.md`) | M4 | S–M | **owner** |
| 11 | ✅ **WP-43** · A second external app with role guards, **done 2026-09-12**. ⚠️ **It leaked on the first run and §8's kill criterion fired**: 16 screens, 4 of them admin-only, all shipped in one `PUBLIC` registry with 0 skips reported. Cause: a third guard shape (roles on a parent route) plus a default that turned an unreadable guard into "everyone". Fixed; re-scored against ground truth written before the run: **48 of 48 role assignments correct, 0 leaks, 100% recall** ([RESULT.md](../eval/tutor-app/RESULT.md)) | M4 | M | done |
| 12 | ◐ **WP-45** · Accessibility, **agent half done 2026-09-12**. `check-accessibility.mjs` runs the **built bundle** in a real DOM and audits every state a user can reach: **18 checks, 0 serious or critical**, now a CI gate. **It found a real defect on its first run** — focus fell to the document body when an answer replaced the link the user was standing on; fixed, with both halves of the rule as tests. **Left:** the owner runs [the 17-item NVDA pass](../eval/a11y/NVDA-CHECKLIST.md). Until then the claim is *"automated checks pass; no screen reader has confirmed it"* | M4 | S | **owner** |
| 13 | ◐ **WP-44** · Portuguese voice, **agent half done 2026-09-12**. A multilingual whisper model and a pt_PT voice are hash-pinned; 40 pt-PT turns across 8 roles, 3 passes, both recognisers on identical audio. **Agreement 93.3% (`base`) and 91.7% (`small`)** — above the 80% bar, but **the split is 26/26 in-domain and 11/14 at the boundary**, and word error is **46–59%** against English's 7.1%. Found that **Piper is not deterministic**, so the first model comparison was measuring different recordings (`VOICE-PT.md`). **Left:** the owner records 20 real utterances — the Stop-if is defined on real speech | — | S | **owner** |
| 14 | **WP-35** · **The owner's run.** Drop the kit into `fut-app`, deploy, measure cost per session on real traffic, check guided steps on a real form, record the side-by-side clip | M3/M4 | M | **owner** |
| 15 | ✅ **WP-47** · ADR-016 option B, **done 2026-09-12**. Each domain writes its own `generated/registry.json`; the eval scripts require `--registry=`. **Both domains now build back to back without clobbering, and CI diffs both in one job** — the gate got wider. The hook denying `pnpm registry:build:finance` is deleted along with its reason. Ranked gap #1 since 2026-09-08 is closed. Two Rule 1 holes found on the way (below) | M4 | S–M | done |

**Deferred with a hard trigger:** **WP-48**, the injection defence for `gs-0174`. It must
land before any `write` or `destructive` capability ships to an adopter (§7.5, §8).
Rule 15's fence landed with PR #7, and Finding 14 measured its limit. The fence holds
structurally, but `llama3.1:8b` still obeys an instruction placed inside it (4
adversarial violations). So the fence narrows WP-48 without replacing it.

**Why this order.**
- **WP-49 before WP-50.** The bench exists to show a result; without the folder that
  produces one, it has nothing to show. `preview/` built first would be a preview of the
  CLI kit — the thing being replaced.
- **WP-50 before WP-35.** The owner's acceptance run is expensive and happens once. Going
  into it without having seen the answers, the UI and the voice on a bench is spending the
  one real trial on defects a local page would have caught.
- **WP-35 is last by design.** A drop-in folder is proven by someone other than its author
  dropping it in.
- ~~WP-41, WP-42, WP-43, WP-46~~ ✅ Done. WP-41's CLI is still how this installs until
  WP-49 replaces it; it is superseded, not deleted.

**Closed, and where the details are (§7):**
- **M0:** WP-23, WP-15, WP-16 and WP-17 are all ✅.
- **M1:**
  - ✅ WP-31, WP-30 (GO), WP-25, WP-32 and WP-36.
  - WP-33 triggered its kill criterion, which became D-4.
  - WP-38 and WP-40 each triggered their Stop-if; WP-40's became D-5.
  - WP-39 was reverted.
- **M2:** WP-34 is ✅; the result is WRITEUP.md.
- **M3 (built, not yet in a live app), all ✅:**
  - WP-24: the engine, with 210/210 parity.
  - WP-26: installable.
  - WP-27: guided steps. Rendering on a real form moves to WP-35.
  - WP-29: the script tag, 9.3KB gzipped.
- **Formerly deferred, all ✅:** WP-18 (undo), WP-19, WP-21 (voice, English), WP-22, WP-28
  (external app, 1 → 8 routes), WP-11 and WP-37. WP-20 and WP-10 were closed as not this
  product.

**The headline result, restated for what ships (2026-09-13).** The script tag an adopter
installs — no model, at most three screens shown — **beats `fut-app`'s own CommandPalette**:
the right screen is among what it shows for **69.9% vs 45.5%**, shown first for **53.4% vs
42.6%**, **72.4% vs 37.1%** in Portuguese, and nobody is sent to a wrong screen
(`like-for-like.json`). The 56.8% vs 45.5% published before
is the server configuration with `llama3.1:8b`, which the script tag does not call. A turn
settled without asking the user is 11.0% on that server and 1.7% in the script tag, against
a 60% bar, so the cost claim stays withdrawn (D-4).
Out-of-scope refusal has a measured ceiling, which is accepted and disclosed (D-5). The
numbers are in `eval/fut-app/MEASUREMENT.md`.

### Readiness, 2026-09-13

Asked "how ready is it, 0–100%", the agent half was pushed as far as it goes without a real
adopter. Each item is a merged PR into `develop`:

| # | Gap | Closed by |
|---|---|---|
| 1 | The kit crashed when installed outside the repo; nothing ran on Node 20 | #21 — tarballs install into a foreign project on Node 20 and 23+, and `check-install` gates it |
| 2 | The widget broke under a strict Content-Security-Policy | #22 — no inline script or style; `check-csp` gates it in a real browser |
| 3 | Only React Router apps could be read | #23, #24, #25 — Next.js, Remix, SvelteKit, Nuxt, Vue Router, Angular; six public apps, every route found, 0 wrong destinations, 0 files changed ([RESULT.md](../eval/field-apps/RESULT.md)) |
| 4 | The kit could turn an adopter's own lint or format checks red, or ship every role's screens publicly | #26 — `doctor` warns before the first, refuses the second |
| 5 | No way to judge the answers before wiring anything in | #27 — `nextgen preview`, `doctor --report`, FIELD-TEST.md |
| 6 | The headline number described a configuration nobody installs | This PR — `like-for-like.mjs`, and every headline restated |

**What stays open is not an agent's to close:** a field test by someone who did not build it
(FIELD-TEST.md), the four owner items above — WP-35 among them, the live deployment — and the golden set's
circularity — its questions are model-written, so every number here is an upper bound until
real users ask real questions.

### Decisions

**No decision is open.** The owner answered all nine gaps in session on 2026-09-11. §13
records each one, with its reasoning.

| | Decision | Result |
|---|---|---|
| ~~**D-5**~~ | ✅ **2026-09-11: (a), accept the out-of-scope ceiling and disclose it.** Disclosed in [README.md](../README.md), WRITEUP.md §10 and business-case.md §7 | Re-opens if a rung adds actions |
| ~~**ADRs**~~ | ✅ **2026-09-11: ADR-013 and ADR-014 accepted. ADR-016 accepted, option B** — **implemented 2026-09-12 (WP-47)**, with one divergence recorded in the ADR: no default registry path anywhere, because a default naming `domain-modules` inside `core-intent` broke Rule 1 | — |
| ~~**fut-app**~~ | ✅ **2026-09-11: agents do not install into `fut-app`.** The owner drops the kit in (WP-41), and that run is WP-35 | — |
| ~~**Push**~~ | ✅ **2026-09-11: both feature branches pushed, and PRs opened into `develop`.** **Done the same day: #6 merged, and #7 rebased onto it with its scorecards regenerated** | — |
| ~~**Gaps 5–8**~~ | ✅ **2026-09-11:**<br>• Accessibility → WP-45; the owner does the NVDA pass.<br>• Cost per session → measured live in WP-35 only.<br>• Injection → WP-48, deferred with a hard trigger.<br>• Generalisation → WP-42, WP-43 and WP-44 | — |
| ~~**D-4**~~ | ✅ **ANSWERED 2026-09-10, in session: option (b) — spend WP-38's budget first.** Spent. Model-free reached **8.1%**, not 60%, so WP-38's own "Stop if" fired and the answer resolves to **(c), reposition the claim** — done in business-case.md §5. **M3 is unblocked** | ~~all of M3~~ |
| ~~D-3~~ | ✅ **ANSWERED 2026-09-11, in session: (c) semantic matching primary, (a) build-time selector as fallback, (b) never** | ~~WP-27~~ |
| ~~D-1~~ | ✅ decided — both reference apps survive (ADR-013) | — |
| ~~D-2~~ | ✅ decided — `registry.domainDescription` (ADR-013) | — |

Everything this file previously carried as an open decision — Rule 7's meaning, language
scope, Layer 5's extent, the generator's confidence policy, `TAU_ACT_BY_KIND` — was
resolved and is recorded in §7 or §13 where it landed.

---

## 3. Where the work stands

### The pilot target — `fut-app`

**Chosen 2026-09-09**, replacing WeFitAll. Verified on disk the same day at
`<fut-app>/frontend`.

| | |
|---|---|
| Stack | React 18 · **React Router 7** · Vite — the same adapter serves WeFitAll |
| Size | **30 feature areas · 146 page components** — academy, squad, training, performance, competition, medical, nutrition, psychology, compliance, finance, guardian, tactics, video, … |
| Access control | **Role-gated routes** — `ROUTE_ROLES`, `BackendRole` (STAFF, COACH, GUARDIAN, ADMIN). This forces **Rule 17** |
| Generator input | `src/lib/deepLinks.ts` — a hand-maintained manifest of **36 routes with i18n labels, icons, roles and a written *reason* each**, plus `navConfigs` and a `navGate.test.ts` drift gate |
| Language | Portuguese, via i18n keys |
| Baseline to beat | **It already has a `CommandPalette`** |

**Why this is the right target.** 146 pages across 30 features, multi-role, used
occasionally by guardians and coaches who do not know the internal vocabulary — that is
precisely the ICP in business-case §2. It proves *value* as well
as mechanism, which WeFitAll's 3 routes never could.

**Two things it gives us for free.** `deepLinks.ts` and `navConfigs` are hand-written by
a developer for an unrelated purpose, which makes them **unbiased partial ground truth**
— better than a ground truth written to score a generator. And the existing
`CommandPalette` is a **baseline to measure against**: *"does asking in your own words
beat the command palette?"* is a far stronger claim than any absolute number.

**WeFitAll is retained as a smoke test** — a 3-route single-page gym site with ~11 scroll
sections. It answers "does the adapter still work on a trivial app", in about twenty
minutes. It is not a value test and must never be reported as one.

### What exists, and whether rung A1 can use it

| Built | Reusable? |
|---|---|
| Three-stage cascade, calibration, thresholds | ✅ **after WP-16** removes the hardcoded finance framing |
| Policy table and dispatcher | ✅ unchanged |
| Declared boundaries / model-free refusal | ✅ and it is the core safety property |
| Registry format, `defineCapability`, codegen, validation | ✅ it becomes the **integration contract** |
| `TurnTrace` + `explain()` | ✅ and it becomes a selling feature |
| ~~`packages/ui`~~ | **removed 2026-09-13** with `apps/web`; the guided-step anchor resolver and its 16 tests moved to `embed` |
| `core-voice` | ◐ acceptance-tested in English (WP-21). The runtimes are desktop binaries, so a browser needs a different transport |
| `core-inference` runtime seam | ✅ the seam is right. Stages 1+2 need no transport at all in the browser (WP-24), and the `core-inference/ollama` subpath keeps Node-only code out of browser bundles (WP-29) |
| `data`, `domain-modules`, `domain-finance` | ◐ **reference applications** now: the generator's ground truth |
| `apps/cli` | ◐ reference implementation (`apps/web` removed 2026-09-13) |
| `generator` | ✅ the build step (WP-25, WP-27, WP-28). The kit wraps it (WP-41) |
| `embed` | ✅ the script tag (WP-29) |

### What does not exist

As of 2026-09-11:

- **The drop-in kit** (WP-41): one command, a `doctor`, a one-line mount. Every piece
  exists, but nothing joins them yet into the single action an adopter takes.
- **A live deployment inside a real app** (WP-35, which is the owner's run).
- **Calibration for an adopter who has no golden set.** Every calibration so far used
  hand-written questions (§9). For `fut-app` it lives in an eval script
  (`calibrate-registries.mjs`), not in the
  generator.
- **Evidence beyond two role-gated apps.** Role extraction is now validated on a second,
  external app (WP-43) — where it leaked first and was fixed — but a guard written *inside*
  a page component is still not read at all. 100 of the 145 generated descriptions have
  never been read by a person (WP-42).

Everything this section used to list now exists, and §7 describes each one:
- declared explanations (WP-36);
- the browser runtime (WP-24);
- guided steps (WP-27);
- the installable package (WP-26);
- the script tag (WP-29);
- a measurement against questions we did not write (WP-33).

The generator ([packages/generator](../packages/generator/README.md), WP-25) emits 145
capabilities and 4 boundaries across 10 registries for `fut-app`. It scores 100% recall
and 100% role exactness on WP-31's ground truth (`REPORT.md`).

**The asymmetry has moved.** It used to be that the engine was ahead of the packaging and
the evidence. Now the engine, the generator and the packages are all built and measured.
What is behind is **the last metre**: one command that an adopter can run, proven by
someone who did not write it.

### The five AI layers

| Layer | Status |
|---|---|
| 1 · Conversation | ✅ text; ✅ voice acceptance-tested 2026-09-11 (WP-21): 97.5% agreement between typed and spoken, **English and synthetic speech only** |
| 2 · Intent Recognition | ✅ built, honestly re-measured against the modules registry (WP-17), and domain-agnostic in the stage-3 prompt (WP-16) — no known open work at this layer |
| 3 · Action | ✅ built. Rung A1 uses `read` + `navigate` only |
| 4 · Navigation | ✅ **closed 2026-09-11.** The engine resolved routes from WP-03 and every response carried one; **nothing read it** — this row said "surface missing" for the entire project, and for a navigation product it was the main event. `destinationFor()` now decides, and `Assistant.tsx` pushes through the app's own router, so Rule 7 holds by construction. The policy is a pure function with 24 tests, because every interesting case is one where moving would be *wrong*: a `confirm` (arriving before the user approves defeats ADR-004), a `read` (replacing the answer with the form that produced it), and a **what/why question** (WP-36 — asking about a screen is not asking to be put on it) |
| 5 · Knowledge | ✅ WP-15 landed — `relatedModules()` + body-inclusive corpus, in the reference app |

### Tests

647 tests across 15 packages, all green on 2026-09-12, after WP-41, WP-46, WP-42's agent
half, WP-43, WP-47 and the agent halves of WP-45 and WP-44 landed. `services/api` had none, and was deleted on 2026-09-13.

| Package | Tests | | Package | Tests |
|---|---|---|---|---|
| `core-intent` | 130 (incl. WP-41's shared calibration sweep) | | `generator` | 103 (incl. WP-42's extraction fixes and WP-43's guards) |
| `data` | 60 (incl. WP-18) | | `core-capability` | 59 (incl. WP-27, the registry-ownership guard) |
| ~~`apps/web`~~ | removed 2026-09-13 | | `core-inference` | 42 (incl. the Rule 15 fence) |
| `domain-modules` | 39 | | `domain-finance` | 34 |
| `core-trace` | 28 | | `core-dispatch` | 26 |
| ~~`ui`~~ | removed; its 16 anchor tests moved to `embed` | | `apps/cli` | 15 |
| `kit` | 17 (WP-41: init, build, calibrate, doctor) | | `embed` | 27 (the script tag, the chat box, WP-45's focus rule) |
| `core-voice` | 7 (asset store, and WP-44's manifest) | | | |

---

---

## 4. The tree, and what is broken in it

**Rewritten 2026-09-17 after WP-51.** Six packages, all on the path to an adopter.

```
NextGen_Interface/
├── adapter/          ◐ WP-49 — WHAT AN ADOPTER COPIES
│   └── FIELD-NOTES.md    ✅ what real applications taught this tool
│       (AGENTS.md · scan.mjs · runtime/ — not yet)
├── preview/          ⬜ WP-50 — the bench. Not started
├── packages/
│   ├── core-intent/      ✅ cascade · stages · embedder · slots · action · registry(-browser) · 130 tests
│   ├── core-capability/  ✅ define · validate (incl. guided steps) · codegen · 59 tests
│   ├── core-inference/   ✅ runtimes · ModelStore · ./ollama subpath · 42 tests
│   ├── generator/        ✅ discover · pages · steps · prose · ids · config · emit · 164 tests
│   ├── embed/            ✅ the script tag and the chat box, strict-CSP clean · 160 tests
│   └── kit/              ◐ WP-41 — nextgen init · build · doctor · preview · calibrate · 47 tests
├── eval/
│   ├── frameworks/       the measurement — fixture apps, `--app <name>`, plus the harness
│   ├── field-apps/       six public apps, ground truth written before the run
│   ├── tutor-app/        Rule 17 on an app we do not own
│   ├── bulletproof-react/ calibrate, run on an app nobody here wrote
│   └── a11y/             axe result + the NVDA checklist the owner still owes
├── tooling/scripts/  check-import-boundaries · check-thresholds · check-scorecard · check-registries
│                     check-packaging · check-doc-links · check-kit-sync · check-derived-artefacts
│                     check-prompt-fencing · check-model-numerics · check-network-egress · check-adversarial
│                     check-accessibility · check-csp · check-install · check-release
└── .MDFiles/PLAN.md · README.md · INSTALL.md · GETTING-STARTED.md · CLAUDE.md · .claude/decisions/ (18 ADRs)
```

**Deleted 2026-09-17 (ADR-018), recoverable from git history:** `core-dispatch`,
`core-trace`, `core-voice`, `data`, `domain-modules`, `domain-finance`, `apps/`, and the
private pilot's `eval/` data. The router's own golden set survives as a **frozen fixture**,
`packages/core-intent/eval/fixture-registry.json` — repointing to it reproduced the
committed scorecard byte-for-byte on every accuracy figure, which is how the move was
shown to be lossless.

**Toolchain:** Node 25.1.0 · pnpm 11.1.2 · Ollama with `qwen2.5:1.5b`, `llama3.1:8b`,
`qwen2.5vl:7b`, `nomic-embed-text`. Ollama is probed, never required.

### Live defects

| | Defect | Why it matters | Fixed by |
|---|---|---|---|
| **1** | ~~**The stage-3 prompt hardcodes finance.**~~ **FIXED 2026-09-09 (WP-16)** — `stages.ts` now reads `registry.domainDescription` (D-2, ADR-013). *"transfer 500 euros to my brother"* is refused (`gs-0197`), permanently, against the modules registry. Removing the hardcoded text also **improved** top-1 accuracy 2–6 points on both models (FINDINGS Finding 13) | **Fatal to the product** — the engine cannot serve arbitrary apps while asserting it is one specific app. **Demonstrated:** *"transfer 500 euros to my brother"* routed to `module.revert`, a destructive capability, instead of being refused. The policy gate held; nothing was deleted | **WP-16** ✅ |
| **2** | ~~`llama3.1:8b` took >4 min to load, then timed out a turn~~ (2026-09-08) | **RESOLVED as a false alarm 2026-09-09 (WP-17)** — did not reproduce: warm reload today took 8.7s on GPU. Likely a one-off (GPU contention or a CPU fallback that day), not a persistent defect. §5, FINDINGS Finding 12 | **WP-17** ✅ |
| **3** | ~~**Undo is unimplemented for the shipping reference app**~~ **FIXED 2026-09-11 (WP-18).** `module.delete` and `module.revert` now restore from the journal row captured before they ran. The original entry read: `undo.ts` reverses `transaction.delete` and `budget.delete`, both `domain-finance`; the registered app's `module.delete` and `module.revert` have no restore path. **The false claim is fixed (2026-09-10)**: `canUndo()` is declared next to the switch that would have to honour it, and the CLI's confirmation now says *"this is permanent and cannot be undone"* where it used to promise a journal that could. **The undo itself is still missing** | Rule 5's destructive path is nominal. Contained only because no rung ships a write capability — but the *prompt* was lying at the exact moment a user confirms a permanent deletion | **WP-18** ✅ |
| **4** | ~~**Generated golden fixtures are 0 bytes** in both reference apps; CI diffs them~~ **FIXED 2026-09-10 (WP-19)** — `generateGoldenEntries` required a hand-written `expect` block before an example counted, and no example in either app had one. Every example now becomes an entry, its expectation derived from the capability; an `expect` block *refines* it (params, `maxStage`) rather than gating it. 24 entries for `domain-modules`, 81 for `domain-finance` | An artefact that asserts nothing inside a gate. **Decide the example format before WP-25 generates examples at scale** | **WP-19** ✅ |

### Dead weight — swept 2026-09-09

A full repo sweep for ideas the plan no longer contains. **Verified, not suspected.**
Removing the first three is WP-37 (§7.5); the rest need a decision, not a cleanup.

| Item | Evidence | Verdict |
|---|---|---|
| ~~`tooling/tsconfig`~~ | Byte-identical to the root `tsconfig.base.json`, extended by nothing | **DELETED 2026-09-10 (WP-37)** |
| ~~`tooling/eslint-config`~~ | Only a `package.json` — no `index.js`, no ESLint dependency, no dependents | **DELETED 2026-09-10 (WP-37)** |
| ~~`hashing-llama3.1_8b.txt`~~ | 0 bytes, tracked, beside a real `.json`. Its real path was `packages/core-intent/eval/scorecards/`, not the `eval/scorecards/` recorded here | **DELETED 2026-09-10 (WP-37)** — and it was the only 0-byte tracked file left in the repo |
| ~~`services/api`~~ | 3 files, `src/index.ts` is `export {}`, zero dependents | **DELETED 2026-09-13**, the owner's decision (ADR-013 addendum). Before that, **decided in [ADR-013](../.claude/decisions/ADR-013.md), 2026-09-09** — keep, empty, reserved for Ladder B2's hosted trace store; use for nothing on rungs A1/B1/C1 without a new ADR |
| ~~**`domain-finance` is orphaned**~~ | **RESOLVED 2026-09-09 (WP-16)** — a `devDependency` of `apps/cli`; `domain-swap.test.ts` runs the real router against it. `NextGenApp` still cannot *register* it (its use cases are module-specific) — a separate, larger question | Closed |
| `core-voice` (whisper + piper) | Live code, 4 tests, imported by `apps/cli` — but on **no rung of any ladder**, and its runtimes are desktop binaries a browser cannot load | **Parked, not dead, and now verified.** WP-21 measured it on 2026-09-11: 97.5% agreement (`acceptance.mjs`). A browser transport is still unscoped work that nobody has costed |
| Vision / image capture | Live in `core-inference` and `domain-modules`, on no rung | **Reference-app feature.** Keep, expect no investment |
| ~~`.claude/docs/roadmap.md`~~ | Planned a **Flutter** build [ADR-006](../.claude/decisions/ADR-006.md) rejected, and a `git init` that already happened | **DELETED 2026-09-10 (WP-11)** — but **not wholly dead, and this row was wrong to say so.** Four live doc links pointed into it, one of them load-bearing: FINDINGS scores WP-01's verdict against its Sprint 0 exit criteria. Those, and the success-metrics table that first set model-free resolution at ≥65%, are preserved in history.md |
| ~~7 product docs~~ | ✅ **DONE 2026-09-10 (WP-11).** `README.md` rewritten around the navigation layer and its measured numbers; `vision.md` now scores each of its four goals against evidence (goal 1 is half-met and its offline half failed); `project.md` was already current; `apps/web/README.md` named a `FinanceApp` root that no longer exists; `core-voice/README.md` claimed "not yet implemented" for code that ships and is imported. `SETUP.md` named `domain-finance` as the registry source in two places — it has been `domain-modules` since WP-14, so anyone following it edited the wrong file. `roadmap.md` deleted, its two surviving parts moved to `history.md` | **WP-11** ✅ |
| ~~`golden.generated.jsonl` ×2~~ | **RESOLVED 2026-09-10 (WP-19)** — 24 and 81 entries respectively; the CI diff now has something to be stale about | Closed |
| ~~`apps/cli` → `@nextgen/core-capability`~~ | **NOT dead — this entry was stale.** WP-16 added `domain-swap.test.ts`, which imports `capabilityDocument` from it. Re-verified 2026-09-10 before WP-37 would have deleted a live dependency | **Keep** |

**Checked and clean**, so nobody re-runs these: ADR-001 and ADR-002 are correctly marked
SUPERSEDED and no other ADR status has drifted · all 13 tsconfigs extend one base ·
**every non-index source file under `packages/*/src` is imported somewhere** (verified,
not assumed) · **zero** TODO/FIXME/XXX/HACK comments in `packages`, `apps` or `tooling` ·
every `package.json` script target exists · all 334 markdown links across the repo
resolve, the only three failures being deliberate `ADR-0NN` placeholders in the
`write-adr` template · `check-import-boundaries.mjs` and `check-thresholds.mjs` both
green.

✅ **Done 2026-09-10 (WP-37).** Deleting them was the coherent change it was billed as —
lockfile, workspace globs, seven doc references — and re-verifying first was worth it:
one row of the table above was **stale** (`apps/cli` genuinely uses `core-capability` now),
one had the **wrong path**, and a related environment note in `CLAUDE.md` overstated the
number of BOM-carrying manifests by five to one. **A sweep that is not re-verified before
it is acted on is a sweep that deletes something live.**
### Branch state

**Verified 2026-09-11**, with `git rev-list` against `develop` and `git ls-remote origin`.
`origin` holds four branches: `main`, `develop` and the two open PRs. Everything else below
is local-only.

| Branch | vs `develop` | On `origin` | Carries |
|---|---|---|---|
| `develop` | — | yes | everything through the PR #3/#4/#5 reconciliation (sdlc-kit, plan restructure, WP-14) |
| `feature/plan-execution` | merged | yes | WP-15 onward. **Merged into `develop` on 2026-09-11 (PR #6)** |
| `feature/rule-15-untrusted-fence` | 9 ahead, 0 behind | yes, **PR #7** | Rule 15's fence, CI gates for Rules 2, 8 and 15, and ADR-016 (accepted). **Rebased onto `develop` on 2026-09-11, after PR #6 merged.** Its five conflicts were resolved by keeping both sides, and the scorecards were regenerated with `pnpm router:floor` rather than hand-merged |
| `chore/claude-workflow` | 2 ahead, 6 behind | no | **superseded**: the pre-rename `.ai/` workflow, which landed on `develop` renamed to `.claude/` |
| `docs/plan-restructure` | 8 ahead, 6 behind | no | **superseded**: the pre-rename version of this file |
| `docs/runbook` | 2 ahead, 6 behind | no | adds `RUNNING.md` and deletes `SETUP.md`. Its `roadmap.md` deletion targets a pre-rename path that no longer exists (see below) |
| `feature/modules-knowledge-layer` | 0 ahead | no | nothing; superseded by `feature/plan-execution` |
| `feature/reconcile-plan-restructure`, `feature/sdlc-kit` | 0 ahead | no | fully merged (PRs #5 and #4). Local leftovers, safe to delete |

⚠️ **`RUNNING.md` does not exist on this branch.** The operations doc at the time was
`SETUP.md` — rewritten 2026-09-10 (WP-11) and, at the time, correct about which registry
the router loads. That made `docs/runbook` a **merge decision, not a cleanup**: it would
have deleted a `SETUP.md` that was then current in favour of a `RUNNING.md` written before
the repositioning. `SETUP.md` was itself deleted 2026-09-18, superseded by
[GETTING-STARTED.md](GETTING-STARTED.md); this row is historical.

**A caution this table earned.** Two of its rows were stale in the same way: they
described what a branch *was for* rather than what its diff *does*. `docs/runbook`'s
deletion of `roadmap.md` targeted `.ai/roadmap.md` — dead since the `.ai` → `.claude`
rename — and that phantom blocked WP-11's last item for two days. **Re-run
`git diff --name-status develop...<branch>` before believing any row here.**

---
