# `nextgen calibrate`, run on an app nobody here wrote

**2026-09-12.** The app is
[bulletproof-react](https://github.com/alan2207/bulletproof-react) (MIT), the same public
application used to test `init`/`build`/`doctor`. 8 screens, one audience, 3
declared boundaries.

```bash
nextgen calibrate <kit folder> --golden eval/bulletproof-react/golden-set.jsonl
nextgen build <kit folder>
nextgen doctor <kit folder>
```

## What happened

```
32 turn(s) across 1 role(s), 8 destination(s).
Split by destination: 15 to calibrate on (4 destinations), 17 held out.

tauHigh 0.22   delta 0   boundaryMargin 1   actionBoundaryMargin 1

On the HELD-OUT turns — never optimised against, so this is the real number:
  settled without a model:   35.3%
  of the routable, accepted: 54.5%
  of those, right screen:    83.3%
  out-of-scope refused:      0.0%
  real requests refused:     0.0%
```

`doctor` then said **"Calibrated for this app"** where it had said "NOT calibrated", which
is the loop closing: the command writes a file, the next build uses it, and the report
changes.

**Rule 16 held.** `git status` in the clone shows exactly what it showed before: one
untracked `nextgen/` folder from the original `init` run, and no modified file. This run
wrote to a kit folder outside the clone entirely.

## The result is not good, and the command says so

Two warnings printed, both earned:

> **No margin was found that refuses anything** without also refusing real requests, so
> these thresholds NEVER refuse: an out-of-scope question becomes a clarifying question
> instead of a stated limit.

> The sweep guarantees 100% precision on the turns it calibrated against, but on the
> held-out turns it is **83.3%** — it sends some users to the wrong screen confidently.
> That gap is what the held-out split exists to show; the calibration number alone would
> have looked perfect.

Both warnings were added *because of this run*. The first version of the command reported
`boundaryMargin 1` and `out-of-scope refused: 0.0%` as ordinary numbers in a table, which
is exactly how a bad calibration gets accepted: nothing said the refusal half had simply
failed to find any setting at all.

## What this run does and does not prove

**Does:** the command works end to end on an application this repository did not write —
it reads a built bundle, scores against the real registry, splits by destination, writes
a file, and the next build picks it up. And it reports its own failure modes rather than
presenting every sweep as a success.

**Does not:** say anything about whether bulletproof-react *should* ship these thresholds.
The golden set was written by an agent from the app's routes, not by someone who knows how
its users speak — a weaker instrument than the real thing, and the point of the exercise
was the command, not the app. 32 turns over 8 screens is also close to the floor: with 4
destinations on the calibration side, the sweep is choosing from very little.

The honest reading of `out-of-scope refused: 0.0%` is that **this golden set's 9 refusal
turns do not resemble the app's 3 declared boundaries closely enough for similarity to
connect them** — the boundaries are generic ("Acting outside this application", "Changing
records for you", "Questions about anything else"). That is a finding about declaring
boundaries well, and it matches the limit README states: out-of-scope detection is this
system's weakest edge, and it is disclosed rather than papered over.
