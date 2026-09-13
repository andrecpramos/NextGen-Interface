# @nextgen/embed

**The script tag (Ladder C3, PLAN.md WP-29).** This is one file that routes turns on a page
with no build step, no module system, and no network call per turn.

```bash
node packages/embed/build.mjs   # → dist/nextgen.js (script tag, ~12KB gzipped)
                                #   dist/index.js   (the same code as an ES module)
```

```html
<script src="/nextgen/nextgen.js"></script>
<script>NextGen.start('/nextgen', 'COACH');</script>
```

That second line loads the role's bundle and mounts the **chat box** (WP-41). In a
single-page app, pass the router so that moving does not reload the page:
`NextGen.start('/nextgen', role, { navigate: (to) => router.navigate(to) })`.

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
- exposes `start`, `mount` and `present`.

`src/present.test.ts` covers the presenter's rules, one test per case where moving or
acting would be wrong. `src/widget.test.ts` drives the widget through a small fake DOM,
because the repository has no DOM library.

**That test found two defects in the package's browser entry**, and neither could load in a
page: a `node:*` import reached through `core-inference`, and `process.env` read at module
scope. See [lessons.md L11](../../.claude/docs/lessons.md).

## Status

Installable from the tarballs `pnpm pack:release` writes; not published to npm. Three ways in:

| Import | Is |
|---|---|
| `@nextgen/embed` | an ES module: `create`, `load`, `start`, `mount`, `present`, with types. Self-contained, so a bundler never re-resolves the workspace packages and meets a Node import |
| `@nextgen/embed/nextgen.js` | the script tag, which `nextgen build` copies into `bundle/` |
| `@nextgen/embed/package.json` | for tools that locate the package |

ES modules only. `tooling/scripts/check-install.mjs` installs it outside this repository and
routes a turn through the ES module on every pull request.

**Serve each session only its own role's files**: Rule 17 is a delivery property.
