# What a registry-driven AI navigation layer actually measured

**A solo build, September 2026.** This is the write-up of a project that set out to test
one idea, ran the test on a real application, and got a split answer: the thing works
better than what it replaces, and the mechanism that was supposed to make it cheap does
not.

Everything below is traceable to a committed artefact. Where a claim rests on a number,
the number is linked; where it rests on a test, the test is named. The last section is a
table of every claim and its evidence, because a write-up nobody can check is marketing.

---

## 1. The problem

A large web application is a menu problem. `fut-app`, the application this was measured
against, is a football-club management system: **146 page components across 30 feature
areas, ten roles, Portuguese-language, role-gated throughout.** A coach who uses it daily
knows where things are. A guardian who opens it twice a season does not, and does not know
the vocabulary either — they want *"is my son cleared to play on Saturday?"*, not
*"Medical → Availability"*.

The usual answer is a command palette, and `fut-app` already has one. The idea under test
was whether an assistant that reads the application's own source could do better — and do
it cheaply enough to sit in front of every visitor of every adopter.

## 2. The idea being tested

> **The capability registry, not a prompt, is the application's contract.** The model never
> computes, never emits SQL and never picks a route — it selects a *declared id* and fills
> *typed slots*. Everything that must be correct — policy, navigation, refusal, the app's
> limits — is declared data the engine reads.

The consequence that matters commercially: if most turns can be settled by matching against
declared data, most turns cost nothing. A three-stage cascade does the work —

1. **Deterministic** — exact phrase match. ~2ms, no model.
2. **Embedding** — cosine similarity against a precomputed index. Milliseconds, no model.
3. **The model** — only for what 1 and 2 cannot settle, choosing among a shortlist of ids.

The claim to be tested was that stages 1 and 2 carry most of the traffic.

## 3. What was built

A generator that reads an application's source and emits its registry, and an engine that
routes against it.

**The generator** ([`packages/generator`](packages/generator/README.md)) parses the app's
route table and permission module with the TypeScript compiler API, reads each page
component's body, and emits **one registry per role** — because a capability a user cannot
reach must be *absent* from what they receive, not hidden in it
([ADR-014](.claude/decisions/ADR-014.md)). It writes nothing into the application it reads.

On `fut-app` it turned **154 discovered routes into 145 capabilities plus 4 declared
limits, across 10 role registries**, skipping 9 routes and recording why for each
([SKIPPED.md](eval/fut-app/generated/SKIPPED.md)).

**How good is a machine-written registry?** A registry was hand-written first, by a person,
before any generator existed ([WP-31](eval/fut-app/GROUND_TRUTH.md)), covering 45 routes.
Scored against it, the generator got **100% recall and 100% role exactness** — every route
found, every role set exactly right, zero leaks across ten registries
([REPORT.md](eval/fut-app/REPORT.md)).

> ⚠️ **Read the denominator.** That 100% is over the 45 routes a human independently wrote
> down. The other 100 capabilities are not hand-verified, because verifying them would mean
> reviewing 100 pages — exactly the work the ground truth deliberately avoided. The honest
> claim is *"of the routes a careful developer wrote down independently, the generator got
> every one right"*, not *"the registry is correct"*.

## 4. How it was measured

**210 questions** ([GOLDEN_SET.md](eval/fut-app/GOLDEN_SET.md)), tagged by role and
language: 41% "take me to…", 42% "what is…", 16% out-of-scope, 63% Portuguese.

The honest problem with a golden set is who writes it. Here:

- **Expected answers come from the hand-written ground truth**, which predates the
  generator.
- **Questions were generated from the application's rendered copy** — the strings a user
  actually reads — never from the registry. The writer never saw a capability id, route,
  description or example.
- **A different model wrote them** (`qwen2.5vl:7b`) from the one that wrote the registry
  (`llama3.1:8b`).

It is still model-written from the app's own copy, which is the weakest of the three
sources the plan allowed, and the plan's own stop condition required saying so
prominently. **The 34 out-of-scope questions are hand-written and unaffected — and they are
where the worst result is.**

**The baseline is the incumbent.** `fut-app`'s own `CommandPalette` was driven through its
real command list and its real matcher (a case-insensitive substring test against a
translated menu label), and given **the best result any content word in the question
produces** — deliberately generous, since a real person gets one guess. Typed the full
question verbatim it scores 0.6%, which is not a fair test and is reported only to show
why: nobody types a sentence into a command palette.

## 5. The result

> On a 146-page application it was never designed for, against a registry no human wrote,
> the assistant sent users to the right screen for **56.8%** of real questions — against
> **45.5%** for the command palette that application already ships — but only **11.0%** of
> turns were settled correctly **without a model call**, against a target of 60%.

| Cut | Assistant | Palette | |
|---|---|---|---|
| **Guardians** (48) | **45.8%** | 18.8% | **+27.1** |
| **Portuguese** (116 questions) | **59.5%** | 37.1% | **+22.4** |
| Coaches (104) | **61.5%** | 57.7% | +3.8 |
| **English** (60) | 51.7% | **61.7%** | −10.0 |

**It wins where it was aimed, and by the most where the user knows least.** A guardian —
infrequent user, no internal vocabulary — more than doubles. Portuguese, the language the
application is actually used in, gains 23 points. A coach who already knows the menu gains
a little. It still **loses in English**, because English questions borrow the English menu
words the substring matcher is looking for.

That last row is the useful one. The assistant is not better at search; it is better at
*not needing you to know the words*.

> **These are the numbers after WP-38 and WP-40.** The first measurement (WP-33) read
> 52.3% / 2.4%, and the shape of the result was the same: won in Portuguese and for
> guardians, lost in English, drew with coaches. The two later work packages improved
> every cut — coaches moved from −1.0 to +3.8, so "wins where it was aimed *and nowhere
> else*", which this section used to say, is no longer true. **The English row is the one
> that did not flip**, and it is the honest limit of the result.
>
> | | WP-33 | + WP-38 | + WP-40 |
> |---|---|---|---|
> | top-1 | 52.3% | 58.0% | **56.8%** |
> | settled free & correct | 2.4% | 8.1% | **11.0%** |
> | out-of-scope refused | 32.4% | 26.5% | **41.2%** |
>
> WP-40 trades **1.2 points of top-1 for 14.7 points of refusal**, deliberately: sending
> someone to a slightly worse screen is recoverable, telling them the app cannot do
> something it can is not. All three runs are in
> [MEASUREMENT.md](eval/fut-app/MEASUREMENT.md) and [WP38.md](eval/fut-app/WP38.md).

## 6. What failed, and why

### 2.4% model-free — the number the business rested on

Of 210 turns, **five were settled without a model call**, and all five were refusals. Stage
2 settled **nothing** it was asked to route. Two measured causes.

**The zero-dependency encoder does not survive scale.** The whole offline story assumed a
TF-IDF-style encoder small enough to ship to a browser.

| Encoder | recall@1 | recall@5 | Browser-capable, no network? |
|---|---|---|---|
| `hashing` — TF-IDF, zero dependencies | **4.0%** | 11.4% | **yes** |
| `nomic-embed-text` | **48.9%** | 67.6% | no |

Twelvefold. A lexical encoder can separate 7 capabilities; it cannot separate 145 against
paraphrased questions, and **no threshold repairs a ranking that puts the right answer
20th**. This had been logged as a risk — *"an adopter may have 200 destinations where ours
has 7; never tested at that size"* — and is now tested.

**Even with a real encoder, stage 2 cannot be both cheap and right.** Thresholds calibrated
against the golden set, split 40/60 by destination so no screen appears on both sides:

| Precision floor | Accepted (held out) | Actual precision |
|---|---|---|
| 100% / 95% | **no operating point exists** | — |
| 90% | 32.4% | 70.6% |
| 80% | 65.7% | 59.4% |

There is no setting that is both free and right. At the 80% floor, two of every five turns
it settles go to the wrong screen.

**And stage 1 never fires at all** — the generator emits no trigger phrases, so the 2ms
no-model path is dead weight on every turn. That is the cheapest untried lever and it is
not counted as an excuse above, because it is unmeasured.

#### It has since been measured, and it was worth 6 points

That last paragraph was written as an admission. The lever was then tried, and the honest
follow-up is that it **did not rescue the number** — 2.4% became **8.1%**, not 60%.

Three things came out of it that are worth more than the six points
([WP38.md](eval/fut-app/WP38.md)):

**Triggers helped accuracy for a reason unrelated to triggers.** The embedded document for
a capability includes its trigger phrases, so adding 245 of them changed every stage-2
score as well as switching stage 1 on. Isolating the two — same registry, stage 1 disabled
— splits the +5.7 points of top-1 into **+5.1 from the richer document and +0.6 from stage
1 itself**. Nav labels turn out to be good *description* text. The model-free gain is the
mirror image: **all of it is stage 1**, because stage 2 has never accepted a single turn on
this registry at any calibrated threshold.

**The structural alternative failed its own precondition in twenty minutes.** Per-section
registries — score against ~5 capabilities instead of 145 — require picking the right
section first. Section recall@1 is **25.6%**. That caps hierarchical retrieval at 26%
against the flat registry's 58%, so it was abandoned before it was built. The previous
attempt at a structural fix was built first and reverted after.

**Improving retrieval made refusal worse.** Out-of-scope detection fell **32.4% → 26.5%**,
and the isolation run shows it is the document change, not stage 1: rank real capabilities
higher and the model is offered more plausible wrong answers, so it refuses less. Better
topical retrieval actively damages the thing topical retrieval was supposed to do. That is
the single most useful finding in the project, and it is the argument for the proposal that
out-of-scope needs a *verb* signal rather than a better boundary.

### Then the verb signal was built, and refusal went to 41.2%

The proposal was accepted and implemented. What is inside an utterance's *verb* — book,
pay, delete — is evidence about scope that cosine similarity cannot provide, because a
medical page and a request to book a medical appointment are about the same subject.
Out-of-scope refusal went **26.5% → 41.2%**, and the share of it done **without a model
call** more than doubled, **14.7% → 32.4%**, at an unchanged 1.1% of real requests wrongly
refused.

Three things the implementation found that the proposal had not:

- **Its own guard was inert.** The rule was "do not apply the signal when the top
  candidate is a write or destructive capability" — but a *generated* registry marks
  everything `navigate`, because it derives capabilities from routes and a route has no
  verb.
- **Keying the guard to the top candidate is wrong in principle.** Rewritten that way it
  still silenced none of the five false flags, because for all five retrieval had ranked
  the wrong screen. **A safety guard keyed to the ranking fails exactly when retrieval
  fails, which is when it is needed.** It asks the whole registry instead.
- **The verb lists had to be grouped by concept, not language.** The application documents
  itself in Portuguese — *"pode **eliminar** uma tarefa"* — and users ask in English —
  *"**delete** a task"*. Flat per-language lists never meet, so four in-domain questions
  about the app's own delete screen stayed flagged, and four is enough to block every
  operating point when the constraint is zero false refusals. This is why the original
  measurement of the mechanism did not reproduce until it was fixed.

### Declared limits collapse at scale

The mechanism that made refusal work without a model — the application declaring what it
does *not* do, and that declaration competing in the same ranking — reached **92.3%
out-of-scope detection on a 7-capability app**. On 145 capabilities it reached **32.4%**,
with **61.8% wrongly executed**: the assistant sent the user somewhere for a request the
application cannot serve.

```
"paga a minha quota de sócio"                      -> /my/consents
"marca uma consulta no hospital para o meu filho"  -> /my/children/medical
"delete this player from the club"                 -> /squad/players
```

Nothing dangerous ran — every generated capability is a navigation, so the worst case is a
wasted trip. But *"pay my membership fee"* landing on a consent form is confidently-wrong
navigation, which is the thing the mechanism exists to prevent.

**The obvious repair was built, measured, and reverted.** Writing one boundary per section,
carrying that section's own screen titles so a refusal shares the vocabulary of the requests
it must catch, raised the boundary's score from 0.594 to 0.690 — and moved detection **zero
points**, because the medical page the request must not reach scores 0.761 on the same
words.

**The reason is not fixable by writing better boundaries.** Cosine similarity ranks by
*topic*, and what makes *"book my son an appointment"* out-of-scope is its **verb**. *"Show
me my son's medical status"* and *"book my son a medical appointment"* are the same topic
and opposite requests.

A verb signal was then measured and it separates them where similarity cannot — **88.2% of
out-of-scope questions flagged against 2.8% of in-domain ones**, taking model-free refusal
from 20% to **45%** on held-out data with zero false refusals. It is proposed, not shipped
([ADR-015](.claude/decisions/ADR-015.md)).

## 7. Findings worth keeping

These generalise past this project.

**1. A threshold is an artefact of the encoder *and* of the registry it scores.** Guessing
one at 0.62 when the encoder's cosine maxes at 0.572 sent every turn to the model and
produced 10.4% accuracy. The same lesson recurred at the other end of the scale: a
threshold calibrated for 7 capabilities accepts nothing at 145.

**2. Declared refusal beats model refusal in proportion to how bad the model is.** Left to
itself, out-of-scope detection tracked model size almost perfectly — 85% on an 8B model,
30% on a 1.5B one, **0% on a 1B one that never produced a refusal at all**. Adding declared
limits took that 1B model from 0% to 40%: the structure was worth most exactly where the
model was worth least. *(At 145 capabilities it stops working; see above. Both facts are
true, and the second does not cancel the first — it bounds it.)*

**3. Field order in a schema is not cosmetic.** A model asked for `title`, `summary`, `body`
returned a 24-character header for a multi-section document. Moving `body` first took the
output to 1056 characters. Small models are lazy about long fields ordered last.

**4. Output fields compete for attention exactly like stacked instructions do.** Adding a
third field to a working prompt — the same system message, one more schema entry — cost
**7 points of top-1 accuracy**, 54.5% → 47.2%. The new field was fine; the two already there
got worse. Splitting it into two calls recovered it. *This one was learned the expensive
way, twice: the neighbouring lesson about instructions had already been written down and
was read as being about the system message. It is about the completion.*

**5. Wrong context in a prompt has a measurable accuracy cost, not just a correctness
risk.** An engine that described itself as a finance tracker while serving a notes
application misrouted *"transfer 500 euros to my brother"* to a destructive capability.
Removing the wrong description **improved** top-1 by 2–6 points on every model — the wrong
context was competing for attention on every call, not only the ones it broke.

**6. A cache key not derived from the call's real inputs is a cache that cannot be
invalidated.** Two consecutive fixes to a generated summary were silently discarded because
the key was computed from a differently-ordered list than the prompt received. The symptom
was a football-club application describing itself as *"an Academy Management application…
educational institutions, student records"*, twice, after being fixed.

**7. A validation that silently matches nothing reports success.** A calibration filtered on
a field that one whole bucket of test cases does not carry, so a margin of zero passed
because nothing was checking it. Separately, a CI step diffed a directory the build never
writes, and was green for weeks while real drift went ungated.

## 8. What this adds up to

**The engineering thesis held. The economic one did not.**

Everything delegated to *structure* worked, at every model size: zero hallucinated
capability ids in roughly a thousand constrained calls, the policy table never bypassed,
deterministic slot values never overwritten, and a registry generated from source that
matched a human's on every route and role it could be checked against. The model never
picked a route, and never needed to.

What did not survive contact with a real application is the claim that *most turns cost
nothing*. At seven capabilities, stages 1–2 settled most traffic. At 145 they settle
essentially none, because the browser-capable encoder cannot rank that many candidates and
no threshold repairs a bad ranking.

So the honest position is:

- **As a product**, it beats the incumbent for the users it was built for, and the evidence
  supports saying so — but it currently costs a model call per turn to do it.
- **As a cost argument**, it is unsupported at adopter scale, and the three untried levers
  (trigger phrases, a real sentence encoder in the browser, per-section registries) are
  measurable but unmeasured.
- **As a safety story**, declared limits are the right shape and the wrong size: they need
  a signal that is not topic similarity before this should be put in front of real users.

A pre-committed kill criterion said "below 60% model-free, reposition or stop, and publish
the number either way". It is 2.4%. The number is published.

---

## 9. Every claim, and where to check it

| Claim | Evidence |
|---|---|
| 145 capabilities + 4 limits across 10 role registries, 9 routes skipped with reasons | [`eval/fut-app/generated/`](eval/fut-app/generated/SKIPPED.md), [REPORT.md](eval/fut-app/REPORT.md) |
| 100% recall and role exactness vs a hand-written registry, over 45 routes | [`score-generated.mjs`](eval/fut-app/score-generated.mjs), [GROUND_TRUTH.md](eval/fut-app/GROUND_TRUTH.md) |
| Assistant 52.3% vs palette 45.5%; per-role and per-language splits | [MEASUREMENT.md](eval/fut-app/MEASUREMENT.md), `scorecard-ollama-llama3_1_8b.json` |
| The palette baseline is the app's real command list and matcher | [`palette.mjs`](eval/fut-app/palette.mjs) |
| 2.4% settled without a model call | [`evaluate-golden.mjs`](eval/fut-app/evaluate-golden.mjs) |
| recall@1 of 4.0% vs 48.9% between encoders | [`inspect-retrieval.mjs`](eval/fut-app/inspect-retrieval.mjs) |
| No precision/coverage operating point that is both free and right | [`calibrate-registries.mjs`](eval/fut-app/calibrate-registries.mjs), `thresholds.ollama.json` |
| 61.8% of out-of-scope wrongly executed; section boundaries changed it by zero | [MEASUREMENT.md](eval/fut-app/MEASUREMENT.md) |
| A verb signal separates 88.2% vs 2.8%, and doubles model-free refusal | [`experiment-action-verbs.mjs`](eval/fut-app/experiment-action-verbs.mjs), [ADR-015](.claude/decisions/ADR-015.md) |
| Rule 16 — the generator writes nothing into the app it reads | `generate.test.ts` fingerprints the whole fixture tree before and after |
| Rule 17 — a role's registry omits what it cannot reach | `emit.test.ts` diffs two role registries; re-checked on every scoring run |
| Declared refusal 0% → 40% on a 1B model | [FINDINGS.md](packages/core-intent/eval/FINDINGS.md) Finding 7 |
| Field order changed extraction from 24 to 1056 characters | [history.md](.claude/docs/history.md), WP-14 |
| A third output field cost 7 points of top-1 | [lessons.md](.claude/docs/lessons.md) L9, [MEASUREMENT.md](eval/fut-app/MEASUREMENT.md) |
| Removing a wrong domain description improved accuracy 2–6 points | [FINDINGS.md](packages/core-intent/eval/FINDINGS.md) Finding 13 |
| Golden-set gates are not run-to-run deterministic | [FINDINGS.md](packages/core-intent/eval/FINDINGS.md) Finding 10 |

**Reproduce the headline numbers:**

```bash
node --experimental-strip-types packages/generator/src/cli.ts eval/fut-app/generator.config.json --model llama3.1:8b
node eval/fut-app/score-generated.mjs
node --experimental-strip-types eval/fut-app/calibrate-registries.mjs --embedder ollama
node --experimental-strip-types eval/fut-app/evaluate-golden.mjs --embedder ollama --stage3 llama3.1:8b
```

Warm every model with a throwaway call first and run them sequentially — a cold load puts a
20-second outlier in the p95 and makes every latency figure meaningless.

## 10. What is not claimed

- **Not that the registry is correct.** 45 of 145 capabilities are hand-verified.
- **Not that the questions are unbiased.** They are model-written from the application's own
  copy, and a question and a registry example can land on the same vocabulary by common
  descent. The out-of-scope third is hand-written and is where the worst result is.
- **Not that this transfers.** `fut-app` is an application I have access to. A generator
  built against one application may not survive a second, and that remains the largest
  unproven step.
- **Not that anything here is production-ready.** 61.8% of out-of-scope requests are
  wrongly executed. That is a fix, not a footnote.
