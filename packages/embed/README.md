# @nextgen/embed

**The script tag (Ladder C3, PLAN.md WP-29).** This is one file that routes turns on a page
with no build step, no module system, and no network call per turn.

```bash
node packages/embed/build.mjs   # → dist/nextgen.js, ~23KB raw, ~9.3KB gzipped
```

```html
<script src="/nextgen.js"></script>
<script>
  NextGen.load('/generated', 'COACH').then(async (assistant) => {
    const trace = await assistant.route('where do I see the training calendar');
  });
</script>
```

## What it is

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
- stays under 60KB gzipped.

**That test found two defects in the package's browser entry**, and neither could load in a
page: a `node:*` import reached through `core-inference`, and `process.env` read at module
scope. See [lessons.md L11](../../.claude/docs/lessons.md).

## Status

Private, and not published. How the drop-in kit ships this file is PLAN.md WP-41.
**Serve each session only its own role's files**: Rule 17 is a delivery property.
