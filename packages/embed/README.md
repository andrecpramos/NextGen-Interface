# @nextgen/embed

**The script tag (Ladder C3, PLAN.md WP-29).** This is one file that routes turns on a page
with no build step, no module system, and no network call per turn.

```bash
node packages/embed/build.mjs   # → dist/nextgen.js, ~34KB raw, ~13KB gzipped
```

```html
<script src="/nextgen/nextgen.js"></script>
<script>NextGen.start('/nextgen', 'COACH');</script>
```

That second line loads the role's bundle and mounts **the blob** (`blob.ts`), which opens
the chat box beside itself when tapped. In a single-page app, pass the router so that
moving does not reload the page:
`NextGen.start('/nextgen', role, { navigate: (to) => router.navigate(to) })`.

## See it before an adopter does

There is no adopter app required to look at this. `pnpm embed:preview` (or
`pnpm --filter @nextgen/embed preview`) builds the bundle and serves three
host pages against a real generated `fut-app` registry:

- **plain** — no host CSS at all, the widget's own default theme.
- **themed, left nav** — the host declares its own `--nextgen-accent` and a
  fixed left sidebar; the blob should dock right, in the host's colour.
- **themed, right nav** — the mirror image; the blob should dock left.

## The blob

- **`blob.ts`** is the thing an adopter's visitor actually meets first —
  centred on the page when it mounts, then docked to whichever edge
  `chooseDockSide` (`packages/ui/src/dock.ts`) finds emptier, once, on the
  first `navigate()` call or a short timeout, whichever comes first. Tapping
  it mounts the chat box beside it; tapping again closes it. Shadow DOM, like
  the chat box, for the same two reasons — the host's stylesheet cannot
  reach in, and this cannot leak out.
- **Colour** reads the host's own `--nextgen-accent` custom property when one
  is declared on `:root` (custom properties inherit through a shadow
  boundary like any other inherited property, so no cascade dependency is
  needed either way) and falls back to this package's own default otherwise
  — "adapt to what is there, or fall back," the same isolation guarantee the
  chat box already relies on, extended from a rule to a value.
- `chooseDockSide` itself lives in `packages/ui` and is imported by path
  (`../../ui/src/dock.ts`), the same way the guided-step resolver already is
  — a script tag must not drag React in to decide which edge is emptier.

## The chat box

- **`present.ts`** is pure. It turns a turn into what to say, and whether to move:
  - It moves only for an executed `navigate` turn. It does not move for "what is X?"
    (WP-36), or to where the user already is.
  - It never performs a `read`, `write` or `destructive` capability, because a script
    tag has no dispatcher.
  - It fills a route's `:param` only from the page the user is on. Otherwise it explains
    and stays put.
  - A declared limit is shown in the registry's own refusal text. The words follow the
    page's language, Portuguese or English.
- **`widget.ts`** draws that inside a shadow root, so the host's stylesheet cannot reach
  it. It uses system colours, 48px targets, a visible focus ring, `role="search"`, a
  labelled input, and an `aria-live` result. Choices are real links, so every
  destination stays reachable without the assistant (Rule 7). Audited by
  `tooling/scripts/check-accessibility.mjs`, which runs the built bundle in a real DOM
  and found one real defect ([eval/a11y/RESULT.md](../../eval/a11y/RESULT.md)): focus
  fell to the document body when an answer replaced the link the user was standing on.
  **Automated checks pass; no screen reader has been used on it yet
  ([the NVDA pass](../../eval/a11y/NVDA-CHECKLIST.md), PLAN.md WP-45).**

## The router underneath

- **`create(bundle)`** takes a registry, its shipped index and its thresholds. It returns
  `route(utterance, context)`, `steps(capabilityId, root)` and the capability count. It
  fits **one** query encoder for that one registry, never a shared one
  ([L10](../../.claude/docs/lessons.md)).
- **`load(basePath, role)`** fetches `registry.<role>.json`, `index.<role>.json` and
  `thresholds.hashing.json` from the page's own origin, then calls `create`.

It is stages 1 and 2 of the router only. A script tag has no stage-3 transport, so a turn
that would need a model degrades to a clarifying question and never to a guess. `steps()`
uses the guided-step resolver from `packages/ui` (WP-27). That resolver would rather not
highlight anything than point at the wrong field.

## How it is tested

`src/embed.test.ts` builds the bundle, then runs it in a fresh V8 context holding only
`window`, `self`, `console` and `performance`. There is no `require`, no `process` and no
`fetch`. In that context it:
- routes real `fut-app` turns from the generator's own output;
- makes the same decision as the direct `route()` call;
- stays under 60KB gzipped;
- exposes `start`, `mount`, `mountBlob` and `present`.

`src/present.test.ts` covers the presenter's rules, one test per case where moving or
acting would be wrong. `src/widget.test.ts` and `src/blob.test.ts` drive the chat box and
the blob through a small fake DOM each, because the repository has no DOM library.
`tooling/scripts/check-accessibility.mjs` audits both the chat box's and the blob's states
and stylesheets, since `start()` mounts the blob first.

**That test found two defects in the package's browser entry**, and neither could load in a
page: a `node:*` import reached through `core-inference`, and `process.env` read at module
scope. See [lessons.md L11](../../.claude/docs/lessons.md).

## Status

Private, and not published. How the drop-in kit ships this file is PLAN.md WP-41.
**Serve each session only its own role's files**: Rule 17 is a delivery property.
