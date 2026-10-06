# Non-negotiable rules

These rules hold for every change to this repository. Breaking one is a defect, not a style
choice. They exist because the tool runs inside applications its authors do not control, in
front of users they will never meet, so the defaults have to be safe without anyone
remembering them.

Most are enforced by a test, a CI gate, a type or a package boundary. Which ones actually are,
and which are only written down, is the register in
[critical-infrastructure.md](../.claude/docs/critical-infrastructure.md). Read it before you
trust that a rule protects you.

The numbers are stable. Code, tests and ADRs cite rules by number, so a rule that stops
applying is marked **dormant** and never renumbered.

| # | Rule | Why, and where it is held |
|---|---|---|
| 1 | `packages/core-*` depend **only on other `core-*` packages**. They never depend on the generator, the widget or the kit, so the engine cannot learn about any one application. | [architecture.md](../.claude/docs/architecture.md). Gated by `check-import-boundaries.mjs` in CI and by a hook on every `core-*` edit. This is the product boundary |
| 2 | The model **never computes a number the user sees.** It phrases; code computes. | [ADR-003](../.claude/decisions/ADR-003.md) |
| 3 | The model **never emits SQL** and never a raw route. It selects a declared id and fills typed slots. | [ADR-003](../.claude/decisions/ADR-003.md) |
| 4 | Every model-produced identifier is **validated against the registry** before use, **including one inside prose a visitor will read.** A sentence naming a screen this role does not have is removed before display, and the removal is recorded. | [ADR-003](../.claude/decisions/ADR-003.md), [ADR-019](../.claude/decisions/ADR-019.md). Free text produces identifiers too, not only the selected id |
| 5 | **Dormant.** Policy is **code in the dispatcher**, never prompt text: read executes, write confirms, destructive confirms and can be undone, unclassified **refuses**. | [ADR-004](../.claude/decisions/ADR-004.md). Nothing ships a `write` or `destructive` capability today, so this protects nothing yet; do not cite it as a protection. It binds again, unchanged, with the first capability that acts. Rules 19 and 20 already follow its shape: policy in code, not in a prompt |
| 6 | **Dormant.** Money is **integer minor units plus a currency code**, never a float. | No code here holds an amount today. It binds the moment a capability carries one |
| 7 | Every screen reachable through the assistant is reachable **without** it. | [ADR-005](../.claude/decisions/ADR-005.md). A promise to adopters: installing this must never make any part of their site assistant-only |
| 8 | **Nothing on the critical path requires a network.** Stages 1 and 2 always work in the browser with nothing installed. Escalation may use the network (a stage-3 turn, or a spoken question sent to be transcribed), but only to **the adopter's own origin**, and it is off by default. **Never a third party's service**: no visitor's words or voice go to a vendor the adopter has no agreement with, a browser's cloud speech recogniser included. | [ADR-017](../.claude/decisions/ADR-017.md), [ADR-037](../.claude/decisions/ADR-037.md). Gated by `check-network-egress.mjs`, and `check-adapter.mjs` runs the whole build pipeline with every outbound path throwing |
| 9 | Every turn produces a **TurnTrace**, and *why it did that* is answered from the record, never from the model narrating its own reasoning. When the model writes to the visitor, the record also holds what it wrote and what the validator removed. | [architecture.md](../.claude/docs/architecture.md), [ADR-019](../.claude/decisions/ADR-019.md) |
| 10 | Every capability ships with **at least 3 examples** and golden-set entries. | [coding-standards.md](../.claude/docs/coding-standards.md). Gated by `pnpm registry:check`; the generator satisfies it mechanically |
| 11 | Deterministic slot values **always win** over model-extracted ones. | Enforced by nominal types in `core-intent` |
| 12 | A routing bug is not fixed until it is a **permanent golden-set entry**. | [sdlc/testing.md](../.claude/sdlc/testing.md) |
| 13 | The application's **limits are declared in the registry**, not inferred by the model. **Its rules are extracted from its code**, and the model does not judge those either: it phrases a rule, it never decides one. Every extracted rule carries its source file and line, and its tier: **read** from a schema or a control, or **inferred** from a condition. | [ADR-009](../.claude/decisions/ADR-009.md), [ADR-020](../.claude/decisions/ADR-020.md). The generator synthesises limits; it never skips them. `check-rule-provenance.mjs` proves every source pointer resolves |
| 14 | Thresholds are **calibrated per encoder**, never hand-set or copied. | Gated by `check-thresholds.mjs`. Per adopter too: margins are an artefact of the registry, and every app has a different one. Use `pnpm router:calibrate`, `pnpm eval:calibrate` or the kit's `calibrate` |
| 15 | **An application's content is untrusted the moment it crosses into a prompt.** | [security.md](../.claude/docs/security.md). That content is third-party page and component text nobody here reviewed. Gated by `check-prompt-fencing.mjs` |
| 16 | **The installer never modifies the adopter's source.** It reads their code and writes only new, additive artefacts. An agent installing on their behalf may edit, with the developer's answer first, and **only these five**: the script line in the page; a handler serving `bundle/` per role; a `nextgen:navigate` listener in their router; a `.gitignore` entry; a stage-3 endpoint if they enable one. Anything else means the agent has misunderstood. | [ADR-020](../.claude/decisions/ADR-020.md). `check-adapter.mjs` fingerprints the whole source tree before and after a run |
| 17 | **A capability the current user cannot reach is not in the registry they receive.** It is not filtered at render; it is **absent**, so an unreachable route is never offered and its existence is never revealed. | [ADR-014](../.claude/decisions/ADR-014.md). Shipping one registry to every role would leak the shape of the admin surface to everyone else. This is a security property, not a UX filter |
| 18 | **Settle each turn at the cheapest layer that can decide it.** A rule before a model, the browser before the network. A model call asks only for the fields the turn reads and never lets a model reason before choosing from a list. A change to a prompt or schema is measured for latency and accuracy before it ships. | [ADR-036](../.claude/decisions/ADR-036.md); [ADR-038](../.claude/decisions/ADR-038.md) (hand-over by rule) and [ADR-039](../.claude/decisions/ADR-039.md) (keyboard mashing, no model) follow it |
| 19 | **Without a model, the router never moves a visitor to a wrong screen, and never follows an out-of-scope request.** When the question's words do not tell the top screen from the runner-up, it asks. | [ADR-041](../.claude/decisions/ADR-041.md). The golden-set gate fails on any wrong move |
| 20 | **The assistant never acts.** A request to change something is offered its screen, never followed there: "I can't do that for you. Try here:" and a link. A request to *start* something (schedule, add, create) still moves and opens the form, because the visitor completes it there. | [ADR-041](../.claude/decisions/ADR-041.md), extending [ADR-025](../.claude/decisions/ADR-025.md) to every change request; bounds [ADR-031](../.claude/decisions/ADR-031.md) |

## Definition of done

A change is done when:

- [ ] Every rule above still holds, Rules 1 and 15 especially.
- [ ] Types compile under `strict`, and tests cover the new behaviour, including its failure paths.
- [ ] New capabilities have at least 3 examples **and** golden-set entries (Rule 10).
- [ ] The golden-set gates have not regressed, and `check-thresholds.mjs` is green.
- [ ] If the change sits upstream of a shipped artefact (text normalisation, the encoder, a
      registry), everything derived from it was regenerated and `check-derived-artefacts.mjs`
      is green.
- [ ] A browser-facing artefact was run with only a browser's globals, not only checked for
      existence.
- [ ] Any new turn path records a trace (Rule 9).
- [ ] An ADR was written if an architectural choice was made (the `write-adr` skill has the
      test for that).
