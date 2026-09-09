# The rules

> **Audited against the tree:** 2026-09-09
> Source of record: [PLAN.md](../../PLAN.md) §2. This file adds the column PLAN.md
> does not have — **where each rule is actually enforced** — and is the one an
> agent should read when deciding whether something is safe to do.

Fourteen numbered invariants. Every one is either enforced by something mechanical
or labelled `convention` — there is no third category, and a rule with no
enforcement is a rule that will be broken by someone in a hurry.

**Numbers are permanent.** A retired rule keeps its number and gets a
strikethrough pointing at what replaced it. Renumbering breaks every reference in
commit messages, PR reviews, code comments and CI job names — and rules 1, 4, 10,
11 and 14 are all cited from source.

`convention` means **nothing checks this**. That is a legitimate state for some
rules, but it must be visible: a reader who assumes a convention is a gate will
ship the violation. The ranked list of these is in
[critical-infrastructure.md](critical-infrastructure.md).

## The register

| # | Rule | Comes from | Enforced by | Kind |
|---|---|---|---|---|
| 1 | `packages/core-*` **never** imports a domain. Domains register into the engine. | [architecture.md](architecture.md) | `check-import-boundaries.mjs` — CI + `postEdit` hook on every `core-*` write | **gate** |
| 2 | The model **never computes a number the user sees.** It phrases; code computes. | [ADR-003](../decisions/ADR-003.md) | nothing mechanical | **convention** |
| 3 | The model **never emits SQL** and never a raw route. It selects an id + typed slots. | [ADR-007](../decisions/ADR-007.md) | `core-intent` types — the cascade cannot return free text | **type** |
| 4 | Every model-produced identifier is **validated against the registry** before use. | [ADR-003](../decisions/ADR-003.md) | `core-capability/src/validate.ts`, asserted in tests | **test** |
| 5 | Policy is **code in the dispatcher**, never prompt text. read→execute, write→confirm, destructive→confirm+undo, unclassified→**refuse**. | [ADR-004](../decisions/ADR-004.md) | `core-dispatch/src/dispatcher.test.ts` | **test** |
| 6 | Money is **integer minor units + currency code**. Never float. Not once. | [ADR-007](../decisions/ADR-007.md) | `packages/data/src/money.ts` types + tests | **type** |
| 7 | Every screen reachable by AI is reachable **without** it. | [ADR-005](../decisions/ADR-005.md) | nothing mechanical | **convention** |
| 8 | **The device is the source of truth.** Nothing on the critical path requires network. | [ADR-008](../decisions/ADR-008.md) | nothing mechanical | **convention** |
| 9 | Every turn produces a **TurnTrace**. Explainability is a record, never model narration. | [architecture.md](architecture.md) | `core-trace` tests | **test** |
| 10 | Every new capability ships with **≥3 examples** and golden-set entries. | [coding-standards.md](coding-standards.md) | `MIN_EXAMPLES` in `core-capability/src/validate.ts`, gated by `pnpm registry:check` | **gate** |
| 11 | Deterministic slot values **always win** over model-extracted ones. | [lessons.md](lessons.md) — cost a real bug | spread order in the cascade; **no test asserts it** | **convention** |
| 12 | A routing bug is not fixed until it is a **permanent golden-set entry**. | [../sdlc/testing.md](../sdlc/testing.md) | nothing mechanical | **convention** |
| 13 | The application's **limits are declared in the registry**, not left to the model to infer. | [ADR-009](../decisions/ADR-009.md) | the `unsupported` kind + `defineBoundary`, asserted in both domains' tests | **test** |
| 14 | Thresholds are **calibrated per encoder**, never hand-set and never copied between encoders. | [lessons.md](lessons.md) — cost accuracy three times | `check-thresholds.mjs` **does not exist on this branch** | **convention** ⚠️ |

## Where the gaps are

Five of fourteen are `convention` — 2, 7, 8, 11, 12 — plus 14, which is the
expensive one:

**Rule 14 is unenforced and has already cost accuracy three times.**
`tooling/scripts/check-thresholds.mjs` exists on `docs/plan-restructure`,
unmerged. Until it lands, a hand-edited threshold ships silently. The `postEdit`
reminder on `packages/core-intent/eval/**` is a nudge delivered at the moment of
temptation, which is the best available substitute — but it is not a gate.

**Rule 11 has no test.** The spread order `{ ...model, ...deterministic }` is
correct in the cascade today and nothing would catch its reversal. That reversal
is exactly the bug recorded in [lessons.md](lessons.md).

Ranked fixes: [critical-infrastructure.md](critical-infrastructure.md).

## Adding a rule

A rule earns a number when all four hold:

1. Breaking it is expensive **and not locally obvious** — the damage shows up
   somewhere other than where the mistake was made.
2. It states a prohibition or an obligation, not a preference. "Prefer
   composition" is a standard; "core never imports a domain" is a rule.
3. A violation can be described concretely.
4. There is a plan for enforcement — even if that plan is "convention for now".

If it fails (1), it belongs in [coding-standards.md](coding-standards.md).
If it fails (4), add it anyway marked `convention` — an honest gap on the register
beats an unwritten rule, which is enforced by nothing *and* invisible.

When a rule graduates from `convention` to `gate`, update this table, PLAN.md §2,
and [critical-infrastructure.md](critical-infrastructure.md) in the same commit.
