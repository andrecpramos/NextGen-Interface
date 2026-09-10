# Installing the navigation layer into an application

**Written 2026-09-11, by performing it.** Every step below was run against a scratch
consumer outside this repository — packed tarballs, `npm install`, a real import, a real
turn — because "an ordinary dependency addition" is a claim that can only be checked from
outside the workspace that makes it.

> ⚠️ **What is proven and what is not.** The install, the build step, the runtime import
> and routing a turn with no network are all performed and reproducible below. **Mounting
> the assistant in a live application's UI is not** — that is WP-35, and it needs a real
> page. Read this as "the packages install and route", not "the product is deployed".

---

## What an adopter installs

| Package | When it runs | Why they need it |
|---|---|---|
| `@nextgen/generator` | build time | reads their source, emits one registry per role |
| `@nextgen/core-intent` | run time | the three-stage router |
| `@nextgen/core-capability` | both | the registry contract |
| `@nextgen/core-dispatch` | run time | policy: read executes, write confirms, destructive confirms |
| `@nextgen/core-trace` | run time | the turn record that makes `why` answerable |
| `@nextgen/core-inference` | run time | the stage-3 transport interface |

**Not installed:** `data`, `domain-modules`, `domain-finance`, `core-voice`. Those are the
reference application and its desktop-only extras. An adopter's app sits exactly where
`domain-modules` sits, so shipping it would be shipping our example into their bundle.

---

## 1 · Add the dependencies

```bash
npm install @nextgen/generator @nextgen/core-intent @nextgen/core-capability \
            @nextgen/core-dispatch @nextgen/core-trace @nextgen/core-inference
```

This edits the adopter's `package.json`. **That is their edit, not ours**, and it is the
distinction Rule 16 draws: *the installer never modifies the adopter's source.* Our build
step writes only into an output directory of their choosing, and refuses to write anywhere
inside their source tree — `writeOutput` throws rather than doing it, and a test
fingerprints an entire fixture application before and after a run to prove nothing moved.

## 2 · Describe the application, once

```json
{
  "appRoot": "./src",
  "routesFile": "routes.tsx",
  "permissionsFile": "lib/permissions.ts",
  "roleSetExport": "ROUTE_ROLES",
  "allRolesExport": "APP_ROLES",
  "manifests": ["lib/deepLinks.ts", "lib/navConfigs.ts"],
  "localesDir": "i18n/locales",
  "languages": ["pt-PT", "en"],
  "out": "./generated"
}
```

⚠️ **This file is the human step, and it is the honest answer to WP-26's last acceptance
item.** Everything after it is automatic; this is not. Someone who knows the application
has to name where its routes live, which export carries its role table, and which files
are its navigation manifests. On the pilot it took about ten minutes and one wrong guess
(`ROUTE_ROLES` was not where it was first looked for).

**WP-25's goal was "no human step", and this is a human step.** It is small, it is once
per application, and it is configuration rather than code — but it is not zero, and the
plan asked for that to be said rather than rounded away.

## 3 · Build

```bash
node --experimental-strip-types node_modules/@nextgen/generator/dist/cli.js app.config.json \
  --model llama3.1:8b
```

Writes into `out`:

- `registry.<ROLE>.json` — one per role. **A capability a role cannot reach is absent**,
  not hidden (Rule 17), so an ADMIN screen is not in a GUARDIAN's bundle to be found.
- `index.<ROLE>.json` — the precomputed embedding index (WP-24). 47KB gzipped for the
  largest role on the pilot, against a 500KB budget.
- `master.json` — every capability, for review.
- `SKIPPED.md` — every route it refused to declare, and why.

`--no-model` derives prose from the application's own labels instead of calling a model.
Lower quality, no dependency on a model server at build time.

## 4 · Route a turn

```js
import { registryFromIndex, makeEmbedder, route } from '@nextgen/core-intent/browser';

const registry = registryFromIndex(registryFile, index);
const embedder = makeEmbedder('hashing');
embedder.fit(registry.documents);

const trace = await route(utterance, { route: location.pathname, today }, {
  registry, embedder, thresholds, useStage3: false,
});
```

**Import from `@nextgen/core-intent/browser`, not the package root.** The root re-exports
`loadRegistry`, which opens with `import { readFileSync } from 'node:fs'` — correct for the
build step, fatal for a bundle. Tree-shaking does not save you: the import is at module
scope, so a bundler resolves `node:fs` whether or not the function is called.

With `useStage3: false` there is **no network call at all** — asserted by a test that
replaces `fetch`, `XMLHttpRequest` and `WebSocket` with throwing stubs, and verified by
swapping in a network-backed encoder and watching it fail.

## 5 · Wire stage 3, if you want it

```js
useStage3: true,
runtime: yourTransport,   // anything implementing LlmRuntime
```

**The adopter configures this endpoint and no key reaches the browser** — the transport is
injected, so the call can be proxied through their own server. Absent a transport the turn
degrades to a clarifying question and never to a guess.

---

## Uninstalling

```bash
npm uninstall @nextgen/generator @nextgen/core-intent ...
rm -rf ./generated
```

Nothing else. The layer never wrote outside `out`, so there is nothing else to find.

---

## What this cost, honestly

| | |
|---|---|
| Packages to install | 6 |
| Files the adopter writes by hand | **1** — the config in step 2 |
| Files of theirs we modify | **0** |
| Time to first routed turn, from an empty directory | under an hour, most of it discovering step 2's answers |

**And one thing that had to be fixed before any of this worked.** Every package in this
repository was `private: true` with `main: ./src/index.ts` — raw TypeScript. Node refuses
to strip types inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so
the packages could not be imported by anyone outside the workspace. It was invisible from
inside, where every import resolves through the workspace to source. `pnpm build` and
`tooling/scripts/check-packaging.mjs` exist because of it.
