# @nextgen/ui

Shared design system: sphere states, confirmation cards, trace viewer.

**Boundary:** Widgets render; they do not decide.

Nothing here imports the engine. Every component takes a view model from
[`src/types.ts`](src/types.ts) and hands events back out — which is what keeps the
package usable from a browser bundle, where `node:sqlite` cannot go, and what stops a
widget from ever acquiring an opinion about policy.

```bash
pnpm --filter @nextgen/ui typecheck
pnpm --filter @nextgen/ui test
```

No build step. Consumers compile the TypeScript source (`transpilePackages` in
`apps/web/next.config.mjs`). React is a peer dependency; there are no others.

## The visual language

"Graphite HUD" — the cyberpunk register **without neon**, built with Apple's design
principles. See [ADR-012](../../.claude/decisions/ADR-012.md) for why this supersedes the
Material 3 line in [ui-guidelines.md](../../.claude/docs/ui-guidelines.md).

Depth comes from layered translucency, hairline borders and a top-edge highlight.
**Every shadow token is neutral and dark** — a coloured shadow is a glow, and glow is
the thing being avoided.

Two accents, split by function rather than decoration:

| | |
|---|---|
| cold teal | AI-originated content, so "the app said this" and "the AI said this" never blur |
| warm amber | **waiting on the user** — half of what stops `confirming` reading as `thinking` |

| File | |
|---|---|
| [`src/tokens.css`](src/tokens.css) | the whole language: colour, type scale, 8pt grid, motion, both themes |
| [`src/ui.css`](src/ui.css) | component styles, prefix `ngx-` |

Import both once, at the app's root: `@import '@nextgen/ui/tokens.css';`

## Components

| | |
|---|---|
| `Sphere` / `SphereStatus` | the eight-state machine, plus its always-present text label |
| `Composer` | text input; the mic renders disabled until voice lands (WP-13) |
| `Answer` | headline, caption, rows with bars — answers are rendered, not narrated |
| `ConfirmationCard` | parsed parameters, editable in place, each tagged with its source |
| `NavDrawer` | the conventional structure, off-canvas — registry-driven, hidden until asked for |
| `TracePanel` | "why?", rendered from the record — candidate scores included |

## Guided-step anchors (WP-27)

[`src/anchor.ts`](src/anchor.ts) resolves a generated step's anchor against the live page.
`resolveAnchor`, `resolveSteps` and `accessibleName` work over a minimal DOM interface,
so they are tested without a browser (16 tests). **It refuses rather than guesses.**
Resolution happens in this order:
1. The accessible name, together with the role.
2. The build-time selector, which is used only if the element it finds carries the same
   name and role.

If a name matches twice, or a selector lands on an element whose name contradicts the
label, the step renders as plain text with nothing highlighted. A hint that fails to
highlight costs little; a hint that points at the wrong field sends the user to the wrong
input.

## The sphere is distinguished by form, not colour

Colour is the second channel, never the first. That is what makes the
`prefers-reduced-motion` fallback carry the same information with every animation
switched off.

| State | Form |
|---|---|
| `idle` | slow breathing |
| `listening` | amplitude rings, driven by live mic data rather than a keyframe |
| `transcribing` | a ripple settling inward |
| `thinking` | one body in orbit — nothing else in the set orbits |
| `confirming` | four corner brackets, **perfectly still** |
| `acting` | a pulse outward |
| `speaking` | four bands, synced to output |
| `error` | a broken rim and a strike through the core |

`confirming` is the one that matters. It is not a busy state — it is the system
standing still because it is waiting on a person. A user who reads it as a spinner
will wait instead of answering, which is the most expensive misread in the interface.

⚠️ `listening`, `transcribing` and `speaking` are **implemented but unreachable** until
WP-13 wires voice.

## Accessibility

Built to the WP-08 acceptance criteria: 48px minimum targets on every interactive
element; both themes' text pairs checked ≥ 4.5:1 at the point each token is defined;
type scale in `rem` with no fixed-height text boxes, so 200% does not clip;
`prefers-reduced-motion` kills every animation and transition; `SphereStatus` is an
`aria-live` region and the sphere carries `role="img"` with its state in the label.

**Not yet verified with a real screen reader or an automated axe pass.** That is the
honest gap, and it is scheduled as PLAN.md WP-45: automated checks first, then the
owner's NVDA pass. The accessibility claim is not made until that pass is done.
