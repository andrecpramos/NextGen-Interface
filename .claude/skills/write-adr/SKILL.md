---
name: write-adr
description: Decide whether a change needs an Architecture Decision Record, and write it in this repo's format. Use when an architectural choice is being made, when a definition-of-done asks for an ADR, when superseding an earlier decision, or when a trade-off would otherwise be resolved silently in code.
---

# Writing an ADR

## First: is one owed?

**The reversibility test.** If undoing this choice later means touching more than
one layer, coordinating a migration, or changing something users depend on — it
needs an ADR now.

Owed:

- A dependency that will spread across layers
- A change to a layer boundary or the dependency rule
- A storage engine, a wire format, a runtime
- A policy table — anything encoding "what is allowed to happen"
- Anything that weakens a principle in `.claude/docs/vision.md`

Not owed:

- A library used in one module
- A naming convention
- A refactor that changes no interface

**The cheap test:** if you are writing a long comment explaining why the obvious
approach was not taken, that comment wants to be an ADR.

**When in doubt, don't.** ADRs for reversible choices dilute the set until nobody
reads any of them, and that costs more than a missing record.

## Then: write it

```bash
ls .claude/decisions/           # find the next number — sequential, never reused
cp .claude/decisions/ADR-000-template.md .claude/decisions/ADR-0NN-<slug>.md
```

Title names the **choice**, not the topic. "ADR-004 — Confirm writes, never reads"
is findable; "ADR-004 — Action policy" is not.

### Context

Write for a reader in two years who was not present. They are the entire audience,
and they will not have access to today's conversation.

**Include the measurements.** "It was too slow" ages into an unfalsifiable claim.
"p95 was 4.2s against a 2s budget, on the reference device, on the date" stays useful.

### Decision

Active voice, declarative: *"We will X."* Not "we should", not "we are
considering". If it has not been decided, status is `Proposed` — but the sentence
is still declarative.

### Alternatives considered

The section that stops the decision being relitigated. Give each a real hearing —
one dismissed in half a sentence reads as one never actually considered, and it
will be proposed again next quarter.

Always include **do nothing**. Sometimes it wins, and it is the only alternative
guaranteed to be available.

### Consequences — the negative ones

**This is the point of the document.** An ADR with no downsides is advocacy, not a
decision record. Every real choice costs something, and whoever lives with the
cost deserves to have been warned.

If you genuinely cannot name a downside, the decision was not a decision — go back
and check whether an ADR is owed at all.

### Compliance

Name what enforces this: a gate id, a hook, a test, or **convention**.

If `convention`, add a row to `.claude/docs/critical-infrastructure.md`'s gap list. An
unenforced ADR is a strong suggestion, and calling it binding does not make it so.

## Superseding

Never edit an accepted ADR and never delete one.

1. Write the new ADR; its `Supersedes:` names the old one
2. Set the old one's status to `Superseded by ADR-NNN` — **that pointer is
   mandatory**, a superseded ADR with no forward link is a trap
3. Leave the old one's content untouched. The record of a wrong decision and why
   it was reversed is more valuable than the decision was
4. Update the index in `.claude/decisions/README.md`
5. Update any rule in `PLAN.md` §2 that cited the old ADR

## After writing

- Add it to the index table
- If it creates or changes a rule, update `PLAN.md` §2 and
  `.claude/docs/critical-infrastructure.md`
- Tell the user it needs their acceptance. **You do not accept ADRs** — status
  stays `Proposed` until they say otherwise.
