# SDLC — Requirements

## Functional requirements

Identifiers are stable; tests reference them.

### FR-NAV — Navigation

| ID | Requirement | Acceptance |
|---|---|---|
| FR-NAV-01 | Every registered screen is reachable by intent | Registry-generated test: each entry routes from ≥1 of its examples |
| FR-NAV-02 | Navigation carries parsed parameters | "last month's expenses" lands on `/transactions` with the date range applied |
| FR-NAV-03 | Unknown routes never execute | Model-emitted route absent from registry → `Clarify`, logged |
| FR-NAV-04 | Every screen is also reachable without AI | Manual traversal covers 100% of registry routes |
| FR-NAV-05 | Back stack remains coherent after AI navigation | Back from an AI-driven route returns to prior user location |

### FR-INT — Intent

| ID | Requirement | Acceptance |
|---|---|---|
| FR-INT-01 | Resolve intent from text | Golden set top-1 ≥ 90% |
| FR-INT-02 | Resolve intent from voice | End-to-end accuracy from audio corpus ≥ 85% |
| FR-INT-03 | Ambiguity produces a question | Ambiguous bucket → `Clarify` ≥ 95% |
| FR-INT-04 | Out-of-scope handled honestly | OOS bucket → `OutOfScope` ≥ 95%; no invented capability |
| FR-INT-05 | Multi-turn context resolves references | "delete that one" resolves against `ScreenContext` |
| FR-INT-06 | Majority of turns resolve without the LLM | Stage 1+2 rate ≥ 65% |

### FR-ACT — Actions

| ID | Requirement | Acceptance |
|---|---|---|
| FR-ACT-01 | Transaction CRUD via intent | All four operations pass golden set |
| FR-ACT-02 | Budget CRUD via intent | As above |
| FR-ACT-03 | Write actions confirmed before execution | No `write`/`destructive` executes without an accepted confirmation |
| FR-ACT-04 | Destructive actions are undoable | Undo restores prior state exactly; verified against DB snapshot |
| FR-ACT-05 | Unclassified capability refuses | Fail-closed test |

### FR-QRY — Query & analysis

| ID | Requirement | Acceptance |
|---|---|---|
| FR-QRY-01 | Aggregate spending by category and period | Values match a deterministic Dart fixture computation |
| FR-QRY-02 | Free-text search across entities | Merchant/memo/amount search returns expected fixtures |
| FR-QRY-03 | Numeric results are never model-generated | Code review + test asserting arithmetic origin |
| FR-QRY-04 | Model never emits SQL | Architectural test: Query Engine accepts ids + typed params only |

### FR-VOI — Voice (MVP 2)

| ID | Requirement | Acceptance |
|---|---|---|
| FR-VOI-01 | Offline STT | Whisper corpus WER within threshold, no network |
| FR-VOI-02 | Offline TTS | Piper renders answers including currency and dates |
| FR-VOI-03 | Barge-in | Speech playback cancels within 200ms of user input |
| FR-VOI-04 | Mic state unmistakable | Sphere `listening` state + semantic announcement |

### FR-OFF — Offline

| ID | Requirement | Acceptance |
|---|---|---|
| FR-OFF-01 | Core loop works with radio off | Full MVP-1 scripted set in airplane mode |
| FR-OFF-02 | App is useful before model download | Stages 1–2 functional on first launch |
| FR-OFF-03 | Cloud is opt-in and visible | Default off; when on, each remote turn is disclosed and traced |

### FR-EXP — Explainability

| ID | Requirement | Acceptance |
|---|---|---|
| FR-EXP-01 | Every turn produces a trace | 100% of turns; asserted in integration tests |
| FR-EXP-02 | "Why?" is available on every AI answer | UI affordance present; opens trace view |
| FR-EXP-03 | Explanations derive from the record | Trace view contains no model-generated narration |
| FR-EXP-04 | Data provenance is shown | `dataRead` lists tables, row counts, date ranges |

## Non-functional requirements

| ID | Requirement | Target | Verified by |
|---|---|---|---|
| NFR-PERF-01 | Turn latency, text | p95 < 2s | perf suite, reference device |
| NFR-PERF-02 | Turn latency, voice | p95 < 3s | perf suite |
| NFR-PERF-03 | Cold start | < 2s to interactive | perf suite |
| NFR-PERF-04 | Memory with model loaded | < 1.2 GB peak | perf suite |
| NFR-PERF-05 | Battery | < 4% per 10-min session | device farm |
| NFR-REL-01 | Crash-free sessions | ≥ 99.9% | production monitoring |
| NFR-REL-02 | Graceful degradation | Model failure never blocks the app | fault-injection tests |
| NFR-SEC-01 | Encryption at rest | AES-256 via SQLCipher | security test |
| NFR-SEC-02 | Key storage | Hardware-backed keystore | manual audit |
| NFR-SEC-03 | No financial data off-device by default | Zero egress observed | network test |
| NFR-SEC-04 | Injection resistance | 0 destructive actions from adversarial corpus | golden set |
| NFR-A11Y-01 | WCAG 2.2 AA | Full conformance | audit + automated checks |
| NFR-A11Y-02 | Text scaling | 200% without clipping | golden images |
| NFR-SCAL-01 | Domain-agnostic core | Domain #2 requires 0 lines changed in `lib/core/**` | MVP-3 exam |
| NFR-MAINT-01 | Coverage | ≥ 80% | CI gate |

## Constraints

- Local-first: no server exists in MVP 1–3
- Money as integer minor units, never floating point
- Mid-range Android is the reference device for all performance claims
- Solo developer capacity
- Model assets exceed store limits → on-demand delivery is mandatory, not optional

## Out of scope

Payments, transfers, or any irreversible external effect. Bank account linking.
Multi-user or sharing. Cloud sync. Adding any of these requires an ADR and a security
re-review.
