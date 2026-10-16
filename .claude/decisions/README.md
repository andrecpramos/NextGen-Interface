# Architecture Decision Records

Binding decisions and the reasoning behind them. An accepted ADR outranks every other doc in
this repository except the code. Numbers are never reused: a gap in the sequence is a record
that was retired because the thing it decided no longer exists here. A superseded record keeps
its number and points forward in its `Status:` line.

How to write one, and whether a change needs one, is the `write-adr` skill.

| ADR | Decision | Status |
|---|---|---|
| [ADR-003](ADR-003.md) | Hybrid three-stage intent router, not LLM-only | Accepted |
| [ADR-004](ADR-004.md) | Action policy: capability kinds, confirmation, and undo | Accepted |
| [ADR-005](ADR-005.md) | AI-first, not AI-only: conventional navigation is retained | Accepted |
| [ADR-009](ADR-009.md) | Out-of-scope is declared in the registry, not judged by the model | Accepted |
| [ADR-011](ADR-011.md) | CI gates on deterministic runs and tolerances, never on model accuracy | Accepted |
| [ADR-012](ADR-012.md) | The visual system is a bespoke "graphite HUD", not Material 3 | Accepted |
| [ADR-013](ADR-013.md) | The product is a drop-in AI navigation layer for an existing app, not a personal assistant | Accepted |
| [ADR-014](ADR-014.md) | Rule 17 ships as one registry per role, generated from one annotated master | Accepted |
| [ADR-015](ADR-015.md) | Out-of-scope needs a verb signal, not a better boundary | Accepted |
| [ADR-016](ADR-016.md) | Where the generated registry lives | Implemented |
| [ADR-017](ADR-017.md) | The script tag escalates to the adopter's own origin, and only when they switch it on | Accepted |
| [ADR-018](ADR-018.md) | The product is one folder that is copied, not a set of packages that are installed | Accepted |
| [ADR-019](ADR-019.md) | The assistant may write to the visitor, and every claim it makes about the app is validated before they see it | Accepted |
| [ADR-020](ADR-020.md) | The generator reads an application's rules, and everything it infers carries where it came from | Accepted |
| [ADR-021](ADR-021.md) | The tarball path is retired; `adapter/` is the only way in | Accepted |
| [ADR-022](ADR-022.md) | The orb is alive from thinking-orbs' engine; the rest is rebuilt in CSS, with no React in the script tag | Accepted |
| [ADR-023](ADR-023.md) | The adopter tells the assistant about their app: `knowledge.json`, written in an interview | Accepted |
| [ADR-024](ADR-024.md) | What a visitor attaches never leaves their device; the page may take it, and the look is glass, metal and light in CSS | Accepted |
| [ADR-025](ADR-025.md) | A limit about the assistant acting refuses only a request to act, and a limit points to where the visitor can do it themselves | Accepted |
| [ADR-026](ADR-026.md) | The assistant is a chat panel beside the app, asks one question instead of offering a menu, and merges the app's own assistant in rather than competing with it | Accepted |
| [ADR-027](ADR-027.md) | How clever and how bold the assistant is belongs to the adopter: a decide dial, lessons from real use, search, and several roles per user | Accepted |
| [ADR-028](ADR-028.md) | Built for complex apps: a sparse index, item screens reached through their list, screens the adopter declares, and a numbered path to improve it | Accepted |
| [ADR-029](ADR-029.md) | A guest on the adopter's page: it costs nothing at rest, and trusts nothing it is given | Accepted |
| [ADR-030](ADR-030.md) | The visitor reads the answer, in one language; the adopter reads the "why" | Accepted |
| [ADR-031](ADR-031.md) | It uses the app as a user would: it opens what the visitor asked to start, and presses only what can only open | Accepted |
| [ADR-032](ADR-032.md) | A screen is scored against all of it and against its nearest phrasing, averaged | Accepted |
| [ADR-033](ADR-033.md) | The panel names what the app merged in, as options, and lists the app's tours to pick from | Accepted |
| [ADR-035](ADR-035.md) | The panel has a Chat view and a Tutorials view, the surface is flat, and the orb sits centred | Accepted |
| [ADR-036](ADR-036.md) | Stage 3 asks only for what the turn reads, and asks a reasoning model not to reason | Accepted |
| [ADR-037](ADR-037.md) | Voice may be recognised by the app's own server, never by a third party's | Accepted |
| [ADR-038](ADR-038.md) | A turn can be handed to the app's assistant by a rule, before any model is asked | Accepted |
| [ADR-039](ADR-039.md) | Keyboard mashing is recognised from the app's own letter pairs and never reaches a model | Accepted |
| [ADR-040](ADR-040.md) | An uncalibrated build does not get a hand-set margin rule; the gap is closed by calibrating sooner | Accepted |
| [ADR-041](ADR-041.md) | No wrong move without a model, and a request to change something is offered its screen, never followed | Accepted |
| [ADR-042](ADR-042.md) | The assistant knows what each screen lets a visitor do, and who may; a limit never contradicts the app | Accepted |
| [ADR-043](ADR-043.md) | Stage 3 chooses from the role's whole application, and says how much context it needs | Accepted |
