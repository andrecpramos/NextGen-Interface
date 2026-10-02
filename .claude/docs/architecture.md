# Architecture

**Rewritten 2026-09-20.** The earlier version of this file described a Dart/Flutter mobile
finance assistant — Drift, SQLCipher, GoRouter, llama.cpp over FFI, a dispatcher and a query
engine — a product ADR-006, ADR-013 and ADR-018 replaced. What survived is below, described
by what the code does. Where this file and an accepted ADR disagree, the ADR wins.

## System view

Two artefacts run in two places. Everything else in the repository builds them or measures
them.

```
 ON THE ADOPTER'S MACHINE, once                    IN A VISITOR'S BROWSER, every turn
┌───────────────────────────────────────────┐    ┌───────────────────────────────────────────┐
│ adapter/scan.mjs          (packages/kit)  │    │ adapter/runtime/nextgen.js (packages/embed)│
│                                           │    │                                           │
│  detect ──▶ generator ──▶ registries      │    │  widget ──▶ the router (core-intent)      │
│  routes, roles,   one per role, each with │    │            stage 1 ──▶ stage 2 ──▶ stage 3 │
│  translations     its precomputed index   │    │            deterministic  embedding  opt-in │
│                                           │    │                          │                 │
│  init · build · doctor · calibrate        │    │                          ▼                 │
└───────────────────┬───────────────────────┘    │  Outcome + TurnTrace ── "why?" is answered │
                    │  bundle/  (served, each     │  from the trace, never by the model       │
                    └── role its own files) ─────▶└───────────────────────────────────────────┘

   beneath both:  core-capability (the registry contract)  ·  core-inference (model runtimes)
```

`adapter/` is committed build output of the left box and the right box, and is the only thing
an adopter receives ([ADR-018](../decisions/ADR-018.md), [ADR-021](../decisions/ADR-021.md)).
`preview/` is a bench for judging the result and is never exported.

## The packages, and the one dependency rule

| Package | What it is | Depends on |
|---|---|---|
| `core-capability` | the registry contract: schema, validation, builders | — |
| `core-inference` | swappable model and embedding runtimes, the untrusted-text fence | — |
| `core-intent` | the three-stage router, thresholds, calibration, the trace | the two above |
| `generator` | reads an application's source; emits one registry per role | `core-capability`, `core-intent` |
| `embed` | the widget, as one script tag under a strict CSP | `core-capability`, `core-intent` |
| `kit` | `init` / `build` / `doctor` / `calibrate` / `preview` | `generator`, `embed`, `core-intent` |

**Rule 1:** `packages/core-*` depend only on other `core-*` packages. The engine sits below
everything that reads or serves an application, so it cannot learn about one. Gated by
`check-import-boundaries.mjs` and by a hook on every `core-*` edit (ADR-021). No package is
installable or published.

## Intent recognition: the three-stage router

A model asked to emit structured output over a large capability surface, quickly, will be
wrong often enough to destroy trust. So the model is the last resort, not the first, and
what it may do is small:

```
Utterance
   │
   ├─ Stage 1: DETERMINISTIC   (~2ms)
   │     Phrase match against the registry's triggers. A hit is a decision. No model.
   │
   ├─ Stage 2: EMBEDDING RETRIEVAL   (milliseconds)
   │     Cosine match against the role's precomputed index. Returns the top candidates
   │     with scores. Accepted only above tauHigh AND clear of the runner-up by delta.
   │     Still no model.
   │
   └─ Stage 3: THE MODEL   (opt-in, off by default)
         Sees ONLY the top three from stage 2 — never the full registry. It selects a
         declared id and fills typed slots. Low confidence is a clarifying question,
         never a guess. When on, a turn POSTs to a path on the adopter's OWN origin
         (ADR-017); what it writes back is validated before a visitor sees it (ADR-019).
```

Why this ordering:

- **The model's job shrinks to something small models can do**: choose among three labelled
  options. Recalling a whole registry from a long prompt is not.
- **Registry growth stops hurting.** Adding a capability grows an index, not a prompt.
- **Constrained output guarantees a parseable answer, not a correct one.** Hence the
  confidence gate and the clarify outcome.

Thresholds are config **calibrated per encoder and per registry**, never hand-set (Rule 14,
`check-thresholds.mjs`, `check-derived-artefacts.mjs`). The router returns a decision plus a
capability; `toOutcome` in `core-intent/src/types.ts` maps that pair to one of:

| Outcome | Meaning |
|---|---|
| `navigate` | take the visitor to a declared route |
| `answer` | say what a screen is or does, from its declared explanation |
| `clarify` | ask, or offer up to three screens to choose from |
| `out_of_scope` | the request is for something the application does not do — a declared limit (ADR-009), or an action request the router recognises by its verb (ADR-015) — so say so plainly |
| `perform` | an action that needs confirmation. Defined, and **deferred**: nothing ships a `write` or `destructive` capability to an adopter until WP-48 (PLAN.md §7.5) |

**Refusing to answer is a correct outcome.** In the field it offers rather than decides: for
most questions it shows up to three screens and the person picks. See README.md, "Does it work?".

## The capability registry

The registry is the contract between the application, the router and the widget. It is
**generated**, not hand-maintained — hand-maintained registries drift within weeks.
`packages/generator` reads an application's route table, guards, labels and translations and
emits, per role:

- `registry.<ROLE>.json` — the capabilities that role can reach
- `index.<ROLE>.json` — the precomputed embedding index, so a browser does no encoding work

and, once for the application, `thresholds.hashing.json` — the calibrated operating point.

**A capability a role cannot reach is absent from that role's registry**, not hidden in it
(Rule 17, ADR-014): shipping one registry to every role would leak the shape of an admin
surface. `review/master.json` lists every screen with every role, and is never served.

An entry, as the generator emits it (from `eval/frameworks/family/generated`):

```json
{
  "id": "communication.my_announcements",
  "kind": "navigate",
  "route": "/my/announcements",
  "title": "Anúncios",
  "description": "Anúncios — part of the communication area of the application, at /my/announcements.",
  "explanation": "Anúncios is a screen in the communication area … It shows: Enviado por, Anúncios, …",
  "explanationSource": "features/communication/pages/MyAnnouncementsPage.tsx",
  "examples": ["abre anúncios", "leva-me para anúncios", "…"],
  "triggers": ["anuncios", "announcements"]
}
```

`kind` is one of `navigate | read | write | destructive | unsupported`; `unsupported` is a
declared limit (ADR-009). The assistant cannot know about a route the application does not
have, because the registry is read from the application's own route table.

The `examples` block is not documentation. It is the test fixture *and* the retrieval text
the router scores against, which is why every capability needs at least three (Rule 10,
`pnpm registry:check`). There is no dispatcher any more: the package that executed a `write` or
`destructive` capability under a confirmation policy (ADR-004) was deleted with ADR-018, and
nothing ships such a capability to an adopter until WP-48 lands. Rule 5 therefore currently
governs code that does not exist.

## Trace: how explainability is actually built

Explainability cannot be a prompt asking the model to explain itself — that produces
plausible fiction. It is a recorded structure. Every turn returns a `TurnTrace`
(`core-intent/src/types.ts`) holding, among other fields:

- `utterance` and the `context` it was asked in;
- `decidedAt` — which stage decided: `deterministic`, `embedding`, `llm`, or `none`;
- `candidates` — what else it considered, with scores, and so why not;
- `outcome`, `capabilityId`, `route`, `params`, `missing`;
- `explanation` — the screen's declared explanation, copied verbatim from the registry;
- `latency` per stage, and the model's answer *after* the claim validator ran, with a
  count of what it removed (never the removed text).

"Why did you do that?" is answered from this record, with no model involved. It is a
product feature rather than a debug tool: *"prove why it sent this user there"* is what a
regulated adopter asks first. `pnpm preview` shows the whole trace behind every answer.
The trace IS the explainability feature — not a log.

## What the model may never do

- Compute a number a visitor sees (Rule 2). It phrases; code computes.
- Emit SQL, or a raw route. It selects a declared id and fills typed slots (Rule 3).
- Produce an identifier that is not validated against the registry, including one inside
  prose it writes (Rule 4, widened by ADR-019).
- Decide an application's rule. Rules are extracted from its code with their source file and
  line, and the model only phrases them (Rule 13, ADR-020).
- See untrusted application text unfenced (Rule 15, `core-inference/src/untrusted.ts`).

## Where to look next

- [README.md](../../README.md) — the product, the measurements, the structure
- [decisions/](../decisions/) — why it is shaped this way
- [critical-infrastructure.md](./critical-infrastructure.md) — which rule is enforced by what
- [adapter/FIELD-NOTES.md](../../adapter/FIELD-NOTES.md) — what goes wrong on a real application
