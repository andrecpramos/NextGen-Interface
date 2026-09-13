---
name: add-capability
description: Add, change, or remove a capability in a domain package (domain-modules, domain-finance) — the registry entry, the generated artefacts, the golden-set entries, and the router check that proves it did not crowd an existing capability. Use whenever a new thing the assistant can DO is being introduced, a route is added to a domain, or a capability's description, triggers, params or examples change.
---

# Adding a capability

A capability is the engine's only view of a domain. One declaration produces
three artefacts — the registry the intent router reads, the route table the app
router reads, and the golden-set fixtures that assert those two agree. Get the
declaration right and the rest is codegen; get it wrong and the router quietly
degrades for every *other* capability too.

## Where things live

| What | Path |
|---|---|
| The declarations | `packages/domain-<name>/src/capabilities.ts` |
| Generated route table + fixtures | `packages/domain-<name>/generated/` |
| The registry the router reads | `packages/domain-<name>/generated/registry.json` (one per domain, WP-47) |
| The golden set | `packages/core-intent/eval/golden-set.jsonl` |
| Scorecards | `packages/core-intent/eval/scorecards/` |

`domain-modules` is the registered domain (WP-14). `domain-finance` stays as the
reference domain that proves the engine is domain-agnostic — changing one does
not mean changing the other.

## Steps

### 1. Decide it is a capability at all

A capability is a *kind of turn*, not a topic. `domain-modules` deliberately has
five, not sixty: the router only has to recognise save / browse / search /
delete / undo. What the content *means* is decided inside `module.capture`'s own
execution by a larger model, not by the router.

Before adding one, ask whether an existing capability's execution should handle
it instead. Every added capability narrows stage-2 margins for its neighbours
(ADR-009) — the registry is a shared resource, not a free list.

If the thing is something the app deliberately *cannot* do, it is a
`defineBoundary` entry, not a capability. Out-of-scope is declared and matched by
the same retrieval, never judged by the model (ADR-009, Rule 13).

### 2. Write the declaration

```ts
defineCapability({
  id: 'module.capture',              // <domain>.<verb>, stable forever — traces reference it
  kind: 'write',                     // read | write | destructive | navigate
  route: '/modules/new',             // must exist and be reachable WITHOUT the AI (Rule 7)
  title: 'Remember this',
  description:                       // what a USER would say it does, not what the code does
    'Save something the user wants remembered — extract the important information ...',
  explanation:                       // REQUIRED. What the user is TOLD when they ask what
    'Saving something you want to remember. Tell me the thing ...',  // this is. Served
  explanationSource:                 // verbatim, never generated per turn (WP-36).
    'packages/domain-modules/src/capabilities.ts',
  triggers: ['remember this', 'save this', 'take a note'],
  params: {
    body: { type: 'string', required: false, description: 'what you want me to remember' },
  },
  examples: [                        // >=3, and Rule 10 is a CI gate, not a style nit
    'remember that my passport expires in June 2027',
    'save this: the wifi password is on the router label',
    "note that the landlord's number is 555-0142",
  ],
})
```

**`kind` selects the policy the dispatcher enforces** (ADR-004, Rule 5) —
`read` executes, `write` confirms, `destructive` confirms and issues an undo
token, anything unclassified **refuses**. Policy is code in the dispatcher; it is
never prompt text. Choosing `read` for something that writes is not a
mislabelling, it is a missing confirmation.

**The description is the retrieval surface.** Stage 2 embeds it. Two capabilities
whose descriptions overlap semantically compete, and both get worse — this is the
single most common cause of a router regression. Differentiate by what makes them
*different*, not by adding adjectives to both.

**The examples are load-bearing.** They feed the golden-set generator and the
few-shot pool. Write them the way a user actually talks, including the sloppy
phrasings — not three rewordings of the trigger.

### 3. Regenerate — same commit, always

```bash
pnpm registry:build      # domain-modules (what the root script builds since WP-14)
pnpm registry:check      # validate only — this is the CI gate
```

Commit `packages/domain-<name>/generated/` — the registry included — alongside the
source change. A declaration edited without regenerating is silent drift: the app
and the router disagree, and nothing fails until a user hits it.

> Since WP-47 each domain writes its own `generated/registry.json`, so
> `pnpm registry:build:finance` is safe to run and CI checks both domains in one
> job. Before that they shared one path and running the wrong build silently
> replaced the registry the router reads.

### 4. Prove you did not crowd the neighbours

New capability, changed description, or changed triggers — all three need this.

```bash
pnpm router:inspect      # score distributions and recall@k — ALWAYS look here first
pnpm router:floor        # stages 1+2 only: the deterministic run, the regression net
```

`router:floor` exits non-zero by design (without stage 3 it cannot meet absolute
accuracy targets). What matters is the **comparison against the committed
baseline**, which is what CI gates:

```bash
node tooling/scripts/check-scorecard.mjs \
  --baseline packages/core-intent/eval/scorecards/hashing-nostage3.json \
  --current  packages/core-intent/eval/scorecards/hashing-nostage3.json \
  --tolerance 0.05
```

If accuracy dropped, **do not raise a threshold.** Thresholds are calibrated, never
hand-set (Rule 14 — hand-tuning has cost accuracy three times here). Go to the
`router-regression` skill.

### 5. Golden-set entries

Every new capability needs entries, and they must keep the corpus balanced —
direct commands 20%, natural paraphrase 30%, ambiguous 15%, multi-turn 10%, out
of scope 10%, adversarial 10%, non-English 5%. A corpus that drifts toward happy
paths stops detecting the failures that matter.

Add the negative cases too. For a `destructive` capability, an adversarial entry
that must **never** reach it is not optional — the adversarial→destructive count
has to stay zero.

## Definition of done

- [ ] `kind` matches what the capability actually does to data
- [ ] Route exists and is reachable without the AI (Rule 7)
- [ ] >=3 examples, in real user phrasing
- [ ] An `explanation` a user would actually want to read — it is served to them
      verbatim, so write it for them, not for the embedder (WP-36)
- [ ] `pnpm registry:check` passes
- [ ] Generated artefacts regenerated and staged in the same commit
- [ ] `pnpm router:floor` compared against the committed baseline, no regression
- [ ] Golden-set entries added, buckets still balanced
- [ ] Scorecard committed if it moved

## Related

- `packages/core-capability/README.md` — the schema itself
- [ADR-004](../../decisions/ADR-004.md) — capability kinds and the policy table
- [ADR-009](../../decisions/ADR-009.md) — why out-of-scope is declared, not judged
- [.claude/roles/qa.md](../../roles/qa.md) — golden-set composition and regression triage
- `router-regression` skill — when step 4 goes red
