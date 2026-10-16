# The bench

**Where to see what an adopter's users would get, and decide whether it is good enough.**

```bash
pnpm preview                  # builds the widget, then serves the bench
pnpm preview -- --app school  # by name, once there is more than one fixture app
PORT=5000 pnpm preview
```

It answers the questions a scorecard cannot: *is the router too eager or too timid? does
this read well in the app's own language? does the voice work? where does the orb put
itself on a page that was not designed for it?*

## This directory is never exported

`adapter/` is what an adopter copies. **This is not part of it**, and the separation is
load-bearing rather than tidy.

The bench serves **every role's bundle at once** and lets one page switch between them.
In production that would be a security defect: a role's registry *is* its entitlement
([ADR-014](../.claude/decisions/ADR-014.md)), so a screen a role cannot reach is **absent**
from what it receives, not hidden in it. Keeping the switch in a directory that never
leaves makes that mistake structurally impossible instead of a matter of remembering.

It binds to `127.0.0.1`, and every page says so.

## What is where

| | |
|---|---|
| `/bench` | Ask, and see the whole trace. The instrument. |
| `/` and any route | The mock application — every route in the registry is a real page, with the **real widget** mounted. Where to judge how it looks and behaves. The page is English by default, so the widget speaks English; `?lang=pt` (or the switch under the roles) shows it in Portuguese. The fixture's own screens stay Portuguese either way — they are its test data. |
| `/hosts` | The same widget on host pages of other shapes: no CSS, themed left nav, themed right nav, a phone frame. |
| `/alive` | The orb and the composer's light in every state, side by side, on a dark or a light page and any accent, with or without the dotted mind; then the React originals (`border-beam`, `voice-glow`, `liquid-gooey`, `metal-fx`, `img-fx`) running as published, so you can judge what an adopter with React could add. Built from the widget's own source by `preview/build.mjs`, so it shows what ships. Options are linkable: `/alive?theme=light&accent=8b7cf6&mind=off`, `?extras=metal-fx` for one demo. |

Two surfaces on purpose. The bench is not the widget: a bench that only showed what a
visitor sees could not answer *"why did it do that"*, and a widget that showed margins and
stage latencies would not be a product.

## What the trace tells you

Every turn records which stage decided, every candidate stage 2 scored **with the
description it was scored on**, the winning margin, and per-stage latency. Nothing there
is generated at run time and no model is involved in producing it — it is read back from
what the router recorded.

The description column is the useful one. It is the largest part of what stage 2 embeds,
so when two screens score within a hair of each other, that is almost always where the
cause is — and the fix belongs in the declaration, **never in a threshold**
([Rule 14](../docs/RULES.md)).

## Linking to a turn

`?ask=` routes on load and `?role=` picks the role, so a turn worth discussing can be
linked or screenshotted:

```
http://127.0.0.1:4173/bench?role=PARENT&ask=quero%20ver%20o%20estado%20m%C3%A9dico%20do%20meu%20filho
```

The page also publishes what happened on `<body data-bench>` as JSON, which is how it can
be checked rather than merely eyeballed:

```bash
node preview/check-bench.mjs
```

That loads the bench in headless Chrome or Edge and asserts two known turns from the
committed golden set — one that must reach its screen, one that must be refused. **A page
that renders is not a page that works**, and browser code is only honestly checked in a
browser.

## Where its data comes from

The fixture applications in [`eval/frameworks/`](../eval/frameworks), whichever have been
generated. Adding one is adding a folder there; the bench finds it, reads the roles from
the files themselves, and offers it. Nothing here is specific to any application
([ADR-018](../.claude/decisions/ADR-018.md)).

If nothing has been generated yet, the bench says so and prints the command.
