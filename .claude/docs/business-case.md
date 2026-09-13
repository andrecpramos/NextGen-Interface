# Business case — who pays, why, and what would have to be true

**Written 2026-09-08.** Companion to [PLAN.md](../../PLAN.md), which is the execution
document. This file is for humans deciding *whether* to build; PLAN.md is for whoever
is building. Nothing here is settled — it is a set of falsifiable claims and the tests
that would falsify them.

**Status of the project, stated honestly:** a portfolio project with a plausible
commercial thesis, built solo. That framing is deliberate. It means the first
milestone is *a measured result*, not a customer — and it means the ideas below are
hypotheses to be tested cheaply, not a plan of record.

---

## 1. What is actually being sold

Not "AI on your website." That is a commodity and it is crowded.

> **A navigation and guidance layer that cannot send a user somewhere that does not
> exist, costs almost nothing per interaction, works without a network, and can prove
> why it did what it did.**

Every one of those four properties is a consequence of the registry architecture, and
each is something an LLM-chat-over-your-content product structurally cannot offer.
That is the entire commercial argument. If those properties turn out not to matter to
buyers, there is no business here — only good engineering.

---

## 2. Who it is for

### The wedge

**Applications used *occasionally*, by people who do not know the internal vocabulary,
where failing to self-serve creates a support cost.**

Every clause is load-bearing:

- **Occasionally** — daily users learn the interface and stop needing help. Infrequent
  users never do.
- **Do not know the vocabulary** — the user says "I crashed my car"; the app calls it
  "First Notice of Loss". No search box bridges that gap, because search matches words.
- **Failing to self-serve costs money** — this is what converts UX into a budget line.

Candidate verticals: insurance and claims portals · HR and benefits systems ·
government services · healthcare patient portals · tax software · utility and telecom
account areas · complex B2B SaaS with low-frequency administrative tasks.

### Who it is *not* for

- **Developer tools.** Power users, daily use, and Cmd+K already won.
- **Marketing sites.** Little to navigate and no support cost to deflect. WeFitAll is
  one of these and is retained only as a smoke test.
- **Small apps.** Under ~15 meaningful destinations, a good menu wins.
- **Anything where being sent to the wrong place is catastrophic** — until the
  guarantees in §5 are provable, not just architecturally true.

---

## 3. The three-way value

### 3.1 For the adopter — the buyer

| Value | How it is measured | Confidence |
|---|---|---|
| **Deflected support contacts** | Tickets/calls per 1,000 sessions, before and after | **High** — this is the hard number and the reason a budget exists |
| **Task completion** | % of users who start a journey and finish it | High — directly attributable |
| **Accessibility** | WCAG / European Accessibility Act obligations | Medium — a conversational path plus keyboard and screen-reader support is a genuine compliance asset. **Half-verified since 2026-09-12 (WP-45):** automated checks pass in CI and found one real defect; the screen-reader pass has not been run, so the compliance asset cannot be sold yet |
| **No re-platform** | Weeks of integration vs. a redesign programme | High — this is the pitch that gets the first meeting |
| **Demand intelligence** | What users asked for and could not get | **Underrated.** See below |

**The demand-intelligence angle is the most interesting unexploited asset.** Every turn
produces a `TurnTrace`. That means the adopter learns, with no extra work, exactly what
their users asked for that the app could not do — ranked by frequency, in the users'
own words. Nobody currently sells that well. It is a second product hiding inside the
first, and it is worth building the trace export for even if the assistant itself
underperforms.

### 3.2 For the adopter's users

They stop having to hold a model of the app's structure in their head. They ask in
their own words, in their own language, and are taken to the right place and told what
to do there. It disproportionately helps the people current interfaces fail: infrequent
users, people with low digital confidence, non-native speakers, and screen-reader
users — provided Rule 7 holds and nothing becomes AI-only.

### 3.3 For the adopter's own customers and business

Fewer abandoned journeys → more completed transactions. Lower cost-to-serve per
customer. Shorter time-to-value for new customers. And in regulated sectors, an
auditable record of what the assistant did and why, which is precisely what a chat
product built on model prose cannot produce.

---

## 4. Why buy this over the alternatives

| Alternative | Why it wins today | Where this beats it |
|---|---|---|
| **A chat widget over site content** | Instant setup, mature vendors, distribution | It answers; it does not *take you there*. It can invent pages. It costs a model call per turn. It cannot explain itself except by generating more prose |
| **Cmd+K command palette** | Instant, deterministic, users know it | Requires knowing the app's vocabulary. No guidance once you arrive. Not usable by phone or voice users |
| **Better search and IA** | Cheap, well understood | Matches words, not intent. Does not answer "what do I do now" |
| **A browser-level AI agent** | Zero work for the site owner | The site owner has no control, no audit trail, no guarantees — and gets no demand intelligence. **This is the most serious long-run threat** |
| **Rebuilding the app** | Fixes the root cause | Costs 100× more and takes two years |

**The honest competitive read:** the category is crowded and well funded, and
browser-level agents may eventually make site-side integration unnecessary for
navigation. The defensible position is narrow and specific — *bounded, auditable,
near-zero-marginal-cost* interaction — and it is worth most to buyers who are regulated,
cost-sensitive at volume, or both. Everyone else will use a cheaper chat widget.

---

## 5. Pricing hypotheses

Per-seat is the wrong shape — visitors are not seats. Candidates:

1. **Per resolved session** — aligns price to value, and value is measurable. Hard to
   forecast for the buyer, which procurement dislikes.
2. **Tiered by app size + traffic** — number of capabilities × monthly sessions.
   Predictable; the most likely fit.
3. **Flat per site** — simplest, leaves money on the table with large adopters.
4. ~~**Free tier by capability count**~~ — this rested on the marginal cost of a
   model-free turn being approximately zero. **It is not available.** See below.

The economics hinge on one number: **the model-free resolution rate.** At 90% the
product is nearly free to run and option 4 is viable. At 40% every turn has a model
cost and the pricing must cover it.

### ⚠️ That number is measured, and it is 11.0%

**Do not price this as a cheap product.** On `fut-app` — 146 real pages, 210 questions
written from the app's own screens, a real sentence encoder — **11.0% of turns are settled
correctly without a model call.** 187 of 210 reach the model.

The history is worth keeping, because the target was pre-committed and has never once been
met: **65%** in the original roadmap before a line of the router existed, **30%** measured
at WP-01, **2.4%** at [WP-33](../../eval/fut-app/MEASUREMENT.md) on a real application,
**8.1%** at [WP-38](../../eval/fut-app/WP38.md) after deliberately spending a budget to fix
it, and **11.0%** after WP-40 added a second, non-topical signal on top. Four of the five
are measurements rather than estimates, and the gap to 60% is still more than five-fold.

WP-38 is the one that closes the question, because it tried the three untried levers and
reported what each was worth: the free stage had never been switched on, switching it on is
worth ~6 points, the structural alternative fails its own precondition at 25.6%, and the
third lever was never about this number. **There is no cheap fix left that anyone has
identified.**

**What this does to each option above.** 1, 2 and 3 survive unchanged — they were never
premised on a near-zero marginal cost. Option 4 does not: a free tier now gives away a
model call per turn, and the pricing floor is inference cost, not hosting.

**What survives, and it is the thing to sell.** The product beats the incumbent it
replaces. The script tag an adopter installs shows the right screen for **69.9% vs 45.5%**
against `fut-app`'s own command palette, and **72.4% vs 37.1%** in Portuguese, the language
most of its users speak, and sends nobody to a wrong screen
([like-for-like.json](../../eval/fut-app/like-for-like.json)). It gets there with no model,
by offering up to three screens; a model-backed server picking one measured 56.8% vs 45.5%.
That no-model number is a claim about what the user sees, not a cost estimate — that waits
for a deployment. That is a better-navigation argument
and it is measured. It is not a cheaper-navigation argument, and §4's comparison against a
chat widget must stop implying otherwise: *"it costs a model call per turn"* is no longer
a point of difference on cost, only on what the model is allowed to do — a registry-bound
model cannot invent a page, and that is a correctness claim rather than an economic one.

---

## 6. What must be true

Falsifiable claims, in the order they should be tested. Each maps to a work package.

| | Claim | Test | Fails if |
|---|---|---|---|
| A1 | A usable, role-scoped registry can be generated from an app's source with no human editing | Generate for `fut-app`; score against its `deepLinks.ts`/`navConfigs` plus a hand-written sample | Precision or recall below ~70%, or **any** role mis-assignment |
| ~~A2~~ | ~~Most real questions resolve with no model call~~ | ⚠️ **TESTED AND FAILED.** 2.4% at WP-33, **8.1%** after WP-38 spent a budget on it, against a 60% bar. §5 and the rungs in PLAN.md §1.6 are repriced accordingly | ~~Below 60%~~ — it failed |
| **A2′** | *Replaces A2.* The assistant beats the navigation the adopter already ships | Same golden set, against `fut-app`'s own CommandPalette | It loses, or wins only in English. **Currently: 69.9% vs 45.5%, and 72.4% vs 37.1% in pt-PT, for the shipped script tag (56.8% vs 45.5% on the model-backed server) — holds** |
| A3 | Guidance can anchor to elements without breaking on the adopter's next deploy | Anchor, then change the app, then re-run | Anchors mispoint rather than degrade |
| A4 | Navigation + guidance alone is worth paying for | Ask three people in a candidate vertical | Everyone says "only if it answers with my data" |
| A5 | Data answering (phase 2) is achievable without owning the adopter's backend | Design against WeFitAll's NestJS bookings API | Requires bespoke work per adopter |
| A6 | Someone will pay | Three conversations with a named ICP | Nobody will quote a number |

**A4 is the one most likely to fail, and it is the cheapest to test.** It needs three
conversations, not three months of code. Test it early and out of order.

---

## 7. Known weaknesses in the current plan

1. **The pilot is an app we own.** *(Revised 2026-09-09.)* `fut-app` — 146 pages, 30
   feature areas, role-gated, occasional users who do not know the vocabulary — is a
   genuine instance of the ICP in §2, so unlike WeFitAll it can prove **value** as well
   as mechanism. But it is ours, and a generator built against it may not transfer.
   *(Updated 2026-09-11.)* On one public app we do not own (WP-28), discovery found 1 of 8
   routes until it was fixed. That app had no role guards, so **role extraction on a
   second app is still unproven**. That is WP-43.
2. **The value proposition needs data; rung A1 does not have data.** "I no longer need
   to call customer service" requires answering *from the app's data* — Ladder A2 in
   PLAN.md §1.6. A1 navigates, guides and explains. The ladder schedules the climb
   rather than hiding the gap, but it means the first measurement is a technical proof,
   not a commercial one.
3. **The valuable apps are behind a login.** Reading from source sidesteps this for
   generation, which is why it was chosen — but any *data* capability in phase 2 walks
   straight back into auth, permissions and per-user scoping.
4. **Accessibility is in the pitch and is now half-verified.** *(WP-45, 2026-09-12:
   the axe run exists and is a CI gate — 18 checks, 0 serious or critical, on the built
   bundle in a real DOM, and it found and fixed one real focus defect. The screen-reader
   pass has still not happened.)* Until it does, the sayable claim is exactly
   *"automated accessibility checks pass; no screen reader has confirmed it"*. Claiming
   more before testing it is the fastest way to lose a public-sector buyer.
5. **Solo capacity is the binding constraint**, and the failure mode is not technical:
   it is thirteen work packages half-finished at month six.
6. **Out-of-scope refusal has a measured ceiling, and it is disclosed rather than
   solved.** *(D-5, 2026-09-11.)* Some requests ask for things the app cannot do. The
   browser path declines 47.1% of them, and with a model in the loop 41.2% are declined,
   against a ~70% target. It is cheap to live with at rung A1: the assistant only reads
   and navigates, and anything destructive always asks for confirmation. **It stops being
   cheap the moment a rung adds actions**, so any move up Ladder A re-opens it.

---

## 8. Kill criteria

The repo already has this discipline — WP-01 defined "below ~70% ⇒ redesign" before
measuring, and it is the reason that decision was trustworthy. The same applies here.
**Write the threshold down before running the test.**

| Stop and reconsider if | Then |
|---|---|
| The generator spike cannot produce ≥70% of a hand-written registry in **one week** | "Fully automatic" is dead. Fall back to *generated draft + developer edit* and re-test A6 with the extra friction priced in |
| Model-free resolution on a real golden set is **<60%** | The cost advantage — the entire commercial argument — is gone. Reposition as a quality/auditability play or stop |
| Guidance anchors mispoint rather than degrade | Ship navigation only; guidance is unsafe on apps we do not control |
| Three ICP conversations produce no willingness to pay | It is a portfolio project. That is a fine outcome — but stop spending as if it is a business |
| Month 3 arrives with no measured result on a real app | Scope is winning. Cut to the single smallest demonstrable thing |

---

## 9. What this is worth even if it never sells

Worth stating, because it changes how much risk is acceptable:

- A working demonstration of registry-bounded AI navigation with a **provable decision
  record**, measured against the navigation a real application already ships, is a strong
  engineering portfolio piece regardless of adoption. *(This said "with model-free
  resolution" until WP-38 measured it at 8.1%. The demonstration is real; that particular
  adjective was not.)*
- The findings are publishable and non-obvious: schema field order changing extraction
  quality, declared boundaries outperforming model refusal *in proportion to model
  weakness*, thresholds as an artefact of the registry rather than the encoder, and
  **improving topical retrieval making out-of-scope refusal measurably worse** — a
  trade-off that is invisible until both are measured in the same run (WP-38).
- **The negative result is itself the strongest part.** A pre-committed threshold, missed
  four times across four measurements, with the levers tried and costed rather than
  hand-waved, is a rarer artefact than a project that hit its number.
- The architecture survived two product pivots without core changes, which is itself
  the evidence for the thesis.

That is the floor. The business case is upside on top of it — which is the right way
round for a solo project, and the reason the plan is sequenced measure → write-up →
deploy rather than build → sell.
