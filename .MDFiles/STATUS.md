# Status

**As of 2026-09-22, branch `feature/ship-readiness-review`** (stacked on `feature/ui-polish-and-reasoning`),
committed and unpushed. One page. If it disagrees with the code,
the code wins and this page is the bug. The plan, the rules and the full work-package log are
in [PLAN.md](PLAN.md); this is what you read first.

## Ship-readiness review, 2026-09-22

A review of the whole product as an adopter and a visitor meet it: the shipped `adapter/` run on a copy
of judo_app (Next.js + next-intl), and the widget driven in headless Edge on a desktop, a dark host and an
emulated phone. What it found, all fixed and pinned by tests:

- **Blocker: `doctor` failed every screen of a locale-routed app.** Since 2026-09-21 the generator no longer
  declares `[locale]` as a slot (the page fills it), but the registry validator still demanded it, so a
  Next.js `[locale]` app got 12 `route-param-declared` errors under PROBLEMS and exit 1. `core-capability`
  now owns one `isLocaleParam`, read by the validator, the generator and the widget.
- **Every printed command was wrong from where the adopter stands.** "Next: node scan.mjs …" with an absolute
  path, run from the app root where the tool is `nextgen-tool/scan.mjs`; `doctor` offered a
  `nextgen calibrate` command that does not exist. Commands now print as they were run, relative to the
  current folder. `build` says when a role file failed validation instead of exiting 1 silently.
- **`doctor` ends with numbered "Next steps"** for the build's state (problems, GUESSED lines, knowledge
  gaps, calibration, preview, the script line), and no longer quotes ADR, WP or Rule numbers an adopter
  cannot look up — nor do `init`'s warnings, `SKIPPED.md`, `INFERRED.md` or the preview page.
- **Attachments are off by default** (owner's decision; [ADR-024](../.claude/decisions/ADR-024.md)
  addendum, Proposed): `data-nextgen-attach="on"` or `attach: true`. A default-on button that most apps
  cannot wire was a dead end for every visitor of an adopter who did not read far enough.
- **"I don't know what to do here" was routed**, not answered as being lost (no marker word in it), and got
  two unrelated screens; the same for "não sei o que fazer aqui", "what do I do here", "o que faço". Now
  recognised. A new test routes every golden utterance with a destination and every fixture example
  phrase past small talk (the claim in row 14 was a one-off check until now).
- **The landing screen said only "Ready when you are."** It now says, beneath, what the assistant is for (a
  sentence, not suggested questions — the earlier "no pre-written questions" decision stands). The docked
  orb says "Ask where to go" on hover or keyboard focus. The thread's scrollbar is thin and in the host's
  colours at the screen's edge, and an opened "Why?" scrolls into view.
- Drift: GETTING-STARTED said the adapter had no version (it has `VERSION`), called `bottom-right` the
  default position (it is the emptier side), and never mentioned `knowledge.json` — the measured biggest
  lever; now step 5a. The bench's role link rendered a literal `<!--ROLE-->`.

Verified today: every gate in `sdlc.config.json` passes, including `adversarial-live` against a model
server, except `router-floor`, which is non-blocking and runs against a legacy fixture registry untouched
by this change (the HEAD scorecard comparison passed). **Not done:** a phone-sized hint (touch has no
hover), and any of the owner items below.

## What this is

A drop-in AI navigation layer for a web app that already exists. A developer copies one folder
([`adapter/`](../adapter/)) into their repository; it reads the app's routes, roles and text,
and generates what the app's users then get: an assistant that takes them where they asked to
go and says what they will find there. Nothing is installed, nothing calls out, and no file of
the adopter's is modified.

## The engine, in two artefacts

| Runs | Where | Source | Ships as |
|---|---|---|---|
| **Scanner** — `init`, `build`, `doctor`, `calibrate` | once, on the adopter's machine | `kit` + `generator` | `adapter/scan.mjs` (3.6 MB, no dependencies) |
| **Assistant** — the three-stage router and the widget | in each visitor's browser | `embed` + `core-intent` | `adapter/runtime/nextgen.js` (140 KB, 51.2 KB gzipped) |

`preview/` is a bench for judging the result and is never exported. `core-capability`,
`core-inference` and `core-intent` are the engine both artefacts are built from, and sit below
everything else. No package is installable or published
([ADR-021](../.claude/decisions/ADR-021.md)). The structure and the one dependency rule are in
[architecture.md](../.claude/docs/architecture.md).

## What was verified today

Run on this branch, not quoted: typecheck clean; all unit tests pass; the Rule 1, egress,
prompt-fencing and model-numerics gates; documentation links; registry validation;
`adapter/` is current and **a copy of it runs in a directory with no `node_modules` and every
network path throwing**; stage-3 interop; derived artefacts and thresholds; the accessibility
audit of the built widget; the widget under a strict CSP in a real browser; the golden-set
gate; and the bench in a headless browser.

**Run against a model server on 2026-09-21** (Ollama was reachable): `adversarial-live` — which had been
reporting OK without running; repaired, and its first real run recorded one new violation, `gs-0175`,
that reproduces on a clean HEAD — and a with/without-knowledge comparison of the model stage (row 11).
**Not run today:** `router:eval`, and
the two checks only a person can make (below).

## What is measured, and where

Quoted from the repository, not re-measured today.

- **Rehearsed on six more real apps, 2026-09-21** (scratch copies of the owner's other repos, the
  shipped adapter run as an adopter would: WeFitAll, judo_app, Branches_CV, coach-hq-web,
  Motorsport-Legends, and the pilot itself, `fut-app/web`; a seventh, Templates_Services_v1, has no
  router and the scanner said so). Recall was complete on the five checked against their route tables
  (2/2, 12/12, 1/1, 13/13, 11/11, catch-alls correctly excluded). **The pilot came out as 0 screens** —
  its pages and role sets live in sibling workspace packages — **and now as 56 screens across 10 roles**,
  with the role table found automatically and `PLAYER` reaching only its own `/my/*` screens; its
  ADMIN and FINANCE registries are empty because the app says those are not workspace roles. **56 is
  not the whole app**: its table ends `...workspaces.flatMap(…)`, plugin routes assembled at run time,
  which cannot be read statically; that spread is now named in `SKIPPED.md` (before, it vanished).
  What they found, all fixed and pinned by tests: a page component declared in the route table's own
  file; a Next.js app's `[locale]` prefix taken for a section *and* declared as a slot the visitor must
  fill (so "sign in" at 1.00 still asked a question); next-intl translations unread; the app's language
  guessed alphabetically; an inline guard taken for the page ("Protected Route"); two routes of one
  component with one title; HTML entities; a monorepo's sibling packages unreadable; toasts, dialogs and
  `{{placeholders}}` presented as what a screen shows; a bare `<Navigate>` used as a screen's name. Not fixed, and not measured: refusals on an uncalibrated app
  (row 10 below), and a guard written inside a page component (every screen `PUBLIC` — `doctor` warns).
  No question was asked of a real visitor: routing was probed with author-written questions.
- **It reads apps it has never seen.** Six public apps, six routing frameworks, ground truth
  written first: 55 of 55 destinations, 0 wrongly declared, 0 files changed
  ([field-apps/RESULT.md](../eval/field-apps/RESULT.md)).
- **It does not leak screens between roles — after it did, once.** On a seventh app the first
  run leaked 15 of 48 role assignments and a pre-committed kill criterion fired; re-measured
  against the same ground truth, 48 of 48 and 0 leaks
  ([tutor-app/RESULT.md](../eval/tutor-app/RESULT.md)).
- **What the developer tells it lifts routing a lot — on the fixture, written by the tool's
  author** ([ADR-023](../.claude/decisions/ADR-023.md), 2026-09-21). With a `knowledge.json` (what
  each screen is for, the words users say, what the app cannot do), the reference app's golden set
  went from 25.5% to 61.8% of in-scope turns executed on the right screen, the right screen ranked
  first 73% → 87%, out-of-scope refusal 50% → 71%, and no wrong screen executed. When the router
  still asks, the screen that is plainly ahead is now offered first as "you probably want X" (right
  in 3 of 3 everyday cases). It also caused a false refusal that only a screenshot found — a declared
  limit sharing a word-fragment with a real screen — now golden entry `fam-0069`. It is not yet a
  field result: FIELD-NOTES §4 found the opposite for model-written *replacement* phrasing on a real
  app, and the golden set is easy. The interview that produces the file is `adapter/AGENTS.md` ASK 9.
- **Routing quality**, on the reference fixture with no model: 0% sent to a wrong screen, 3.7%
  of in-scope questions wrongly refused, 50% of out-of-scope requests refused
  ([README](../README.md)). For most questions it *offers* two screens rather than deciding
  (three until 2026-09-21: the right screen was among the first two in 21 of the 21 fixture turns
  the router would not act on, and a visitor who knows nothing of the app cannot rank three
  unfamiliar names — so each of the two now says what it is for). PLAN.md §0 records that stages 1 and 2 settle **15.7%** of turns outright, while the
  README's table counts every turn that ended in a decision without a model; the two use
  different definitions of "settled", so read each source before quoting either.

## What is not done — and whose it is

| | Item | Who |
|---|---|---|
| 1 | **The owner's acceptance run** on a real application ([ACCEPTANCE-RUN.md](ACCEPTANCE-RUN.md), WP-35). Also the first time anyone but the author uses it, and the first measurement of the 15.7% on real questions. **It should include the interview (ASK 9) with the real developer answering** — the one thing the fixture numbers cannot show | **owner** |
| 2 | **The screen-reader pass** ([NVDA-CHECKLIST.md](../eval/a11y/NVDA-CHECKLIST.md), about 15 minutes). Until then the claim is *"automated checks pass; no screen reader has confirmed it"* | **owner** |
| 3 | **Accept or reject [ADR-021](../.claude/decisions/ADR-021.md)** — retiring the tarball path, and repointing Rule 1 | **owner** |
| 4 | Decide whether Rules 5 (dispatcher policy) and 6 (money) stay. Both govern code that no longer exists; they are kept as tripwires for when WP-48's trigger fires | **owner** |
| 5 | `core-capability` exports code for hand-declared capabilities that nothing outside it calls (23 of its 41 exports are used by no production code outside the package). Removing it changes the engine's public surface, so it waits on a decision about the capability ladder | **owner** |
| 6 | ~~`adapter/` carries no version~~ — **done 2026-09-21:** `adapter/VERSION`, an id of the two shipped files (their hashes; no date, so the staleness check stays a byte comparison), printed on `doctor`'s first line. It identifies a *build*, not a release number: there is still no release process, and no one has been given a release to name | done |
| 7 | WP-48, the prompt-injection defence — must land **before** any `write` or `destructive` capability ships | deferred, hard trigger |
| 8 | **Push and open the PRs.** `feature/ui-polish-and-reasoning` is 34 commits ahead of `develop` and unpushed (the last five, 2026-09-21: the engine and scanner, the widget, the gates, the docs, the rebuilt adapter; before them the orb's dots, ADR-022, the knowledge file and interview, ADR-023, and the chat screen). It is stacked on `feature/drop-in-reset`, because `develop` has no `preview/` or `adapter/`, so it merges after that one. Each commit was gated as part of the whole tree, not on its own, and the five of today were split by area at file granularity (several files carry more than one change) | **owner** |
| 9 | **Accept or reject [ADR-022](../.claude/decisions/ADR-022.md), [ADR-023](../.claude/decisions/ADR-023.md) and [ADR-024](../.claude/decisions/ADR-024.md)** — the orb's dependency, the `knowledge.json` contract, and "an attachment never leaves the device; the look is glass, metal and light in CSS". Agents never accept ADRs | **owner** |
| 10 | **Declared limits are sticky.** A limit wins whenever it beats the best screen at all (`boundaryMargin` 0, calibrated on a golden set with no counter-example), so a limit sharing a word-fragment with a real screen refuses real questions (ADR-023). Needs a calibrated floor for declared limits, and more golden entries of this kind to calibrate on. The interview has the agent test each limit by hand meanwhile. **Worse on an unseen app (2026-09-21 rehearsal on WeFitAll, a 2-route landing page, uncalibrated, no `knowledge.json`):** every real screen scored ~0.00, so limits scoring 0.07–0.16 won — 7 of 12 everyday questions refused; genuine out-of-scope controls scored 0.19–0.32. A floor on a limit's *absolute* score would separate them there but not on the club fixture (in-scope reaches 0.15, true refusals start at 0.14), and any such number is a hand-set default under Rule 14 until a sweep decides it. **Done (option b, 2026-09-21):** a bundle built with *no calibration* carries `boundaryFloor` 0.15, so a limit must score that in its own right to refuse; calibrated apps and the calibrated reference profile are unchanged, and a calibration replaces it. On WeFitAll, refusals of the 12 everyday questions fell 7 → 1 and all 7 out-of-scope controls were still refused. It is a hand-set stand-in chosen after seeing that data, listed as such in [critical-infrastructure.md](../.claude/docs/critical-infrastructure.md) — the Rule 14 gate cannot see it. **Still open:** replace it with a swept floor once a real adopter's golden set exists; the structural stickiness on a *calibrated* app (a limit sharing a word-fragment with a screen) is unchanged | owner, when a real golden set exists |
| 11 | **Measured 2026-09-21: the knowledge context does not visibly help the model stage — and the model stage itself is the bigger finding.** Stage 3 reads the app summary, glossary, `rules` and limits, fenced and role-scoped (ADR-023 addendum). llama3.1:8b, the club fixture's 69 labelled turns, each routed through the full cascade with and without the registry's `context`: **51 right either way**; of the 3 turns that differ, one got worse (`fam-0015`, `/settings/notifications` → `/settings`), one better (`fam-0036`), one out-of-scope request newly refused (`fam-0065`) — noise. Only **24 of 69 turns reach the model at all**; the rest settle in stages 1–2. Median model latency 1.5 s without, 2.0 s with; one call with context hit the 30 s timeout and degraded to a question. **What the numbers do not say:** one run (no repeat, and Finding 10 says identical 8B runs flip), one model, and the fixture's golden set is the one its knowledge was written against — so this can find a harm but not prove a benefit. **What they do say, and it matters more:** with the model on, **3 of 55 in-scope turns were executed on the wrong screen (5.5%) and 2–3 of 14 out-of-scope requests were executed**, with or without context — the model-free cascade wrongly executes none. Stage 3 is off by default (ASK 8) and that is the right default; it is not "better by knowing more". Not done: a second model, a repeat, and any app but this fixture. Script: not committed (scratch) | owner: decide whether stage 3 is worth offering |
| 12 | ~~The signature look~~ — **done 2026-09-21:** glass, metal and light in CSS, derived from the host's scheme and accent (the idle orb is a complete dotted globe; surfaces are lit-edged glass over a soft aurora; primary actions are accent metal; a light host gets white glass with soft depth; solid fallbacks without `backdrop-filter`, under reduced transparency and in forced colours). Judged by screenshots on a light host, a dark host and an emulated phone, and **contrast measured on the real glass in Edge** (text hidden, the pixels behind each label sampled, WCAG ratio against the label's computed colour): every label at or above **4.96:1 dark, 5.09:1 light**, muted text the tightest; jsdom cannot judge this, so no gate does — a repeatable check is a scratch script, not committed. **Not** measured on a low-end phone (blur cost is the risk — blur is spent only on the composer, corner controls, drawer and docked bubbles, not on each message), and not yet seen by the owner on a real app | owner to judge |
| 13 | ~~Chat extras~~ — **done 2026-09-21:** start over, copy, ↑/↓ recall, and a quieter layout (one tools row, turns grouped). Not done, deliberately: shortcuts beyond ↑/↓ and Esc (browsers reserve most of the sensible ones) | done |
| 14 | **Small talk and dead ends, done 2026-09-21 — and what it is not.** "Hi", "thanks", "who are you", "I have no idea what to do here" are answered, not routed (`embed/src/chat.ts`); being lost gets a few places to begin, taken from the page's own navigation. Two options, each with its purpose; a refusal ends with what the assistant *can* do. Recognition is by exact phrase plus a closed vocabulary, in en and pt only: a word about the app makes it a question, so a phrase it does not know is still refused, and a third language gets none of it. Checked against all 101 golden utterances and 327 registry phrases (0 intercepted), not against real visitors. **The assistant navigates and explains; it does not perform actions** ("make an appointment" takes the visitor to where it is done) — that stays until WP-48 | owner to judge on a real app |
| 15 | ~~Coach role routes worst~~ — **not doing it.** The fixture's coach screens are thin (41% executed against 73% for parents), but most apps will not look like that, and writing more fixture knowledge to lift one role's number would be tuning the demo, not the product (owner, 2026-09-21) | dropped |
| 16 | **Photos and files, done 2026-09-21 — and what it is not** ([ADR-024](../.claude/decisions/ADR-024.md)). A paperclip, a camera on touch-first devices, paste and drop; a tray of chips with previews (drawn on a canvas, so a strict CSP is not tripped); four files, 15 MB each, photos and common documents, judged by one function for every way in. **What is attached never leaves the device**: the router gets the words only; the page gets the files as a cancelable `nextgen:attach` event; the visitor is told which happened. Off unless `data-nextgen-attach="on"` (since 2026-09-22, ADR-024 addendum); `doctor` and ASK 5 tell the adopter and the installing agent. **Not done:** the assistant cannot *use* a file (no vision, by decision) — routing the visitor to the screen that has an upload form needs the scanner to record which screens take a file (a schema change) and a golden set; an adopter who turns it on without wiring the event gets an honest but inert button. **Not measured:** a real upload into a real app, HEIC outside Safari (falls back to an icon), the screen-reader pass on the new controls (NVDA-CHECKLIST items 18–22, added) | owner to judge on a real app |

## Known limits, stated rather than hidden

- **A guard written inside a page component is invisible to route discovery**, so such an app
  generates one audience and every screen reaches everyone. `init` warns and `doctor` lists the
  roles it found; the adopter has to compare them with their own
  ([FIELD-NOTES.md §1](../adapter/FIELD-NOTES.md)).
- **A locale prefix is filled from the page the visitor is on** — from the URL, and where the URL has
  none (next-intl `localePrefix: 'as-needed'`, default language) from `<html lang>`. That last step
  assumes `<html lang>` is the locale code the router uses (next-intl sets it so; an app that writes
  `pt-PT` where its routes say `pt` would be sent to `/pt-PT/…`). Untested against a running
  `as-needed` app: the fill is unit-tested, the redirect behaviour of the router is the router's.
- **It declines about half of the requests for things the app cannot do.** It executes none of
  them and asks a question for the rest. A measured ceiling, accepted (PLAN.md §13, D-5).
- **The cheaper-inference claim is withdrawn.** On the private pilot, turns settling without a
  model fell far short of the 60% kill criterion (PLAN.md §13, D-4). What is claimed is a
  better way to navigate, not a cheaper one.
- **The scanner cannot use a model to write descriptions**, by construction. Descriptions come
  from the app's own labels.
- **The golden sets' questions are model-written**, so every accuracy number is an upper bound
  until real users ask real questions.

## Where to go next

| You want to… | Read |
|---|---|
| add it to an app | [GETTING-STARTED.md](GETTING-STARTED.md) |
| judge what an adopter would get | `pnpm preview` — [preview/README.md](../preview/README.md) |
| understand how it is built | [architecture.md](../.claude/docs/architecture.md), then [README.md](../README.md) |
| work on it | [CLAUDE.md](../CLAUDE.md), then the `new-feature` skill |
| see what was decided and why | [.claude/decisions/](../.claude/decisions/) |
| see what is enforced by what | [critical-infrastructure.md](../.claude/docs/critical-infrastructure.md) |
