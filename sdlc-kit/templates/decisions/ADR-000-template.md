# ADR-{{NNN}} — {{Title: the decision, not the problem}}

**Status:** {{Proposed | Accepted | Superseded by ADR-NNN | Deprecated}}
**Date:** {{YYYY-MM-DD}}
**Supersedes:** {{ADR-NNN, or —}}
**Rules affected:** {{Rule N from ../rules.md, or —}}

> Title rule: name the choice, not the topic. "ADR-004 — Confirm writes, never
> reads" is findable. "ADR-004 — Action policy" is not.

## Context

{{The forces. What is true that makes this decision necessary now, what
constraints apply, and what happens if nothing is decided.

Write it so a reader in two years who was not present can reconstruct the
situation. That reader is the entire audience for this document, and they will
not have access to the conversation you are having today.

Include the measurements. "It was too slow" ages into an unfalsifiable claim;
"p95 was 4.2s against a 2s budget, measured on {{hardware}} on {{date}}" stays
useful.}}

## Decision

{{One paragraph, in the active voice, stated as something the project now does.

> We will {{X}}.

Not "we should", not "we are considering". An ADR records a decision that has been
taken. If it has not been taken, the status is `Proposed` and that is fine — but
the sentence is still declarative.}}

## Alternatives considered

The section that stops the decision being relitigated. Each alternative gets an
honest hearing — an alternative dismissed in half a sentence reads as one that was
never actually considered, and it will be proposed again.

### {{Alternative A}}

**What it is.** {{...}}
**Why not.** {{The specific disqualifying property. "Too complex" is not a
reason; "requires a coordinated migration across three services" is.}}

### {{Alternative B}}

**What it is.** {{...}}
**Why not.** {{...}}

### Do nothing

{{Always consider it explicitly. Sometimes it wins, and it is the only
alternative that is guaranteed available.}}

## Consequences

### Positive

- {{What this makes possible or cheap}}

### Negative

- {{What this makes harder, slower, or more expensive}}

**This subsection is the point of the document.** An ADR with no negative
consequences is advocacy, not a decision record — every real choice costs
something, and the person who has to live with the cost deserves to have been
warned. If you genuinely cannot name a downside, the decision was not a decision.

### Neutral

- {{Things that change without being better or worse — new conventions,
  relocated responsibilities, things future readers will find surprising}}

## Reversibility

**Cost to reverse:** {{low | medium | high}}
**What reversing would require:** {{concretely — the files, the migration, the
coordination}}

If this says `low`, ask whether the ADR was needed. If it says `high`, this
section is what the next person reads first.

## Compliance

**How this is enforced:** {{a gate id, a hook, a test, or **convention**}}

If the answer is `convention`, add a row to
[../critical-infrastructure.md](../docs/critical-infrastructure.md)'s gap list. An
unenforced ADR is a strong suggestion, and calling it binding does not make it so.

## Notes

{{Links to the discussion, the spike, the benchmark, the incident. Anything a
reader would want and cannot reconstruct.}}
