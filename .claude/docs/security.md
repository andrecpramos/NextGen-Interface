# Security & Privacy

The threat model for what this repository ships: a **generator** that reads an adopter's
source at build time, and a **widget** that runs as a guest on the adopter's page. Neither
holds a database, a user account or a key. The risks are of two kinds: what the tool does to
the adopter's codebase and visitors, and what a language model can be made to do once text
reaches a prompt.

Where this file and an ADR disagree, the ADR wins. What actually enforces each point is the
register in [critical-infrastructure.md](./critical-infrastructure.md).

## Assets

| Asset | Why it matters | Where it lives |
|---|---|---|
| The adopter's source tree | The tool reads it and must never change it (Rule 16) | the adopter's repository |
| The per-role screen inventory | Which roles reach which screens is the shape of the admin surface | `nextgen/review/` (never served) and `bundle/registry.<ROLE>.json` (served per role) |
| A visitor's words and voice | Personal data the adopter has no agreement to share with a vendor | the visitor's browser; the adopter's origin only if they enable escalation |
| A visitor's attachments | Arbitrary files from an untrusted source | the visitor's device; handed to the page, never sent anywhere ([ADR-024](../decisions/ADR-024.md)) |
| Turn traces | Utterances plus the decision record | in memory in the widget; never transmitted |

## Build time: the generator and the kit

- **Read-only on the adopter's tree.** The generator and `scan.mjs` write only into their
  own output folder (Rule 16). `check-adapter.mjs` fingerprints the whole target tree before
  and after a real run and fails on any difference.
- **No network.** The build pipeline makes no outbound request. `check-adapter.mjs` runs it
  with every outbound path throwing, and `check-network-egress.mjs` gates the source.
- **Role leaks fail closed.** A capability is emitted into a role's registry only if the role
  provably reaches it. An unreadable guard drops the route and reports it in `SKIPPED.md`
  rather than defaulting to public (Rule 17, [ADR-014](../decisions/ADR-014.md)).
- **`nextgen/review/` is never served.** It lists every screen with every role that can open
  it. The installing agent is told so, and `doctor` repeats it.

## Run time: the widget on the adopter's page

[ADR-029](../decisions/ADR-029.md) is the full list; in short:

- **Every destination is a path on this site.** `safeRoute()` accepts a single-`/` path on the
  page's own origin, with no backslash or control characters, and everything that becomes an
  `href`, a `location.assign` or a call to the adopter's `navigate` goes through it.
- **No HTML from data.** Text from a registry, a companion or the visitor is set with
  `textContent`; only constant icons compiled into the bundle reach `innerHTML`.
- **Strict CSP.** No inline script or style. `check-csp.mjs` runs the built widget under a
  strict Content-Security-Policy in a real browser.
- **The bundle loads from the page's own origin**, unless the adopter supplies their own
  `fetch` and with it the decision.
- **Maps built from registry keys have no prototype**, so a key such as `__proto__` cannot
  reach shared state.

## Network: only the adopter's own origin

Stages 1 and 2 run in the browser with no network (Rule 8). Two things may escalate, both
**off by default**, both switched on only by the adopter's build, and both refused if the
target is not the page's own origin:

- a stage-3 completion request ([ADR-017](../decisions/ADR-017.md));
- a spoken question sent to be transcribed ([ADR-037](../decisions/ADR-037.md)).

Never a third party's service, a browser's cloud speech recogniser included. Every
model-decided turn is disclosed in the *Why?* view.

## LLM-specific threats

### 1. Prompt injection through application content

The realistic vector is the adopter's own page and component text (screen titles, labels,
headings, `knowledge.json`), which nobody here reviewed, plus the visitor's utterance. Both
reach the stage-3 prompt.

- **Untrusted text is fenced and labelled** in every prompt, with an explicit instruction
  that content inside the fence is data, never an instruction (Rule 15).
  `check-prompt-fencing.mjs` gates every declaration site.
- **The candidate set is fixed before the model sees anything.** Stage 3 selects only from
  the shortlist stages 1 and 2 produced from the visitor's words, inside the role's own
  registry. Injected text cannot add a capability the role does not have.
- **Policy is code, not prompt text.** The widget has no dispatcher and performs no actions
  (Rule 20), so a model that "decides" to act has nothing to act with.

### 2. Hallucinated identifiers and claims

Every id, route or screen name the model produces is validated against the role's registry
before use, including inside prose (Rule 4, [ADR-019](../decisions/ADR-019.md)). A sentence
naming a screen the role does not have, claiming to have done something, or stating a number
the visitor would act on is removed, and the removal is recorded in the trace.

### 3. No model-authored SQL, no model-computed numbers

The model selects a declared id and fills typed slots; it never emits SQL or a raw route
(Rule 3) and never computes a number the visitor sees (Rule 2). The injection class is
removed rather than sanitised.

### 4. Traces are sensitive

A trace holds the visitor's words and the decision record. It stays in the widget's memory,
is never transmitted, and `why` renders from it with no model (Rule 9). The only things the
widget stores are a short arrival note in `sessionStorage`, so it survives a full page load,
and the visitor's own preferences (hands-free listening, answers read aloud) in
`localStorage`.

## Review triggers

A security review is required before merging anything that adds a capability of kind
`write` or `destructive`, changes what enters a prompt, adds a network path, changes how a
role's registry is assembled or served, or changes what reaches the DOM.
