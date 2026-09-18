# Installing the navigation layer into an application

**Written 2026-09-11, by performing it.** Every step below was run against a scratch
consumer outside this repository — packed tarballs, `npm install`, a real import, a real
turn — because "an ordinary dependency addition" is a claim that can only be checked from
outside the workspace that makes it.

> ⚠️ **What is proven and what is not.** The install, the build step, the runtime import
> and routing a turn with no network are all performed and reproducible below. **Mounting
> the assistant in a live application's UI is not** — that is WP-35, and it needs a real
> page. Read this as "the packages install and route", not "the product is deployed".
>
> **Start with section 0.** Since WP-41, steps 2 and 3 below are one command. The rest
> of this page is what that command does underneath, kept because it was performed and
> is still true.

---

## 0 · With the kit — start here (WP-41)

> **Just want the steps?** [GETTING-STARTED.md](GETTING-STARTED.md) is the one-page version.
> This page is the full reference.

### Get the tarballs

**From a GitHub Release — the normal way.** Every release attaches six `.tgz` files and
`SHA256SUMS.txt`, and its notes are that version's section of [CHANGELOG.md](CHANGELOG.md).
The repository is private, so you need access to it. In your project:

```bash
gh release download v0.1.0 --repo andrecpramos/AI-Interface --dir vendor/nextgen
(cd vendor/nextgen && sha256sum -c SHA256SUMS.txt)     # optional: verify the download
```

Or download the files from the release page in a browser into `vendor/nextgen/`. On Windows,
`Get-FileHash vendor/nextgen/*.tgz` prints the hashes to compare.

**From a checkout of this repository**, for a build that has not been released:

```bash
pnpm install --ignore-scripts
pnpm pack:release              # writes release/*.tgz and SHA256SUMS.txt
```

Then copy `release/*.tgz` into your project's `vendor/nextgen/`.

### Install and run

```bash
# In YOUR project, on Node 20 or newer. A dev dependency: nothing from these packages
# runs in production except the files `build` writes.
npm install -D vendor/nextgen/*.tgz
# Windows PowerShell passes * unexpanded, so there: npm install -D (Get-ChildItem vendor/nextgen/*.tgz | Resolve-Path -Relative)
npx nextgen init   .           # the folder that contains src/
npx nextgen build  nextgen
npx nextgen doctor nextgen
npx nextgen preview nextgen          # try the answers on your app before wiring anything in
```

**Commit `vendor/nextgen/`.** npm records each package in `package.json` and the lockfile as
`file:vendor/nextgen/…`, so your CI's `npm ci` needs the tarballs in your repository.

**Upgrading:** empty `vendor/nextgen/`, download the new release into it, and run
`npm install -D vendor/nextgen/*.tgz` again. All six carry the same version; never mix
tarballs from two releases.

**License.** Proprietary. You may use it only under a written agreement with the copyright
holder ([LICENSE](../LICENSE)); every tarball carries the same file.

Nothing is published to a package registry; the tarballs are the package. The kit reads **React Router,
Vue Router, Angular, Next.js, Remix, SvelteKit and Nuxt** applications; on anything else, `init` names
what it found and writes nothing. **This path is checked on
every pull request** by `tooling/scripts/check-install.mjs`: the tarballs are vendored and
installed with npm into a project outside this repository, reinstalled with a clean
`npm ci` from the lockfile, the three commands run through the
installed `nextgen` on Node 20 and on the current Node, the app's own files are hashed
before and after, and a TypeScript file importing the packages type-checks under
`bundler` and `nodenext` resolution. The packages are **ES modules only**; a CommonJS
file cannot `import` them statically. (A single-page app's bundler handles that for you.)

In a single-page app you can also use the widget as a module instead of a script tag:

```js
import { start } from '@nextgen/embed';
start('/nextgen', currentUser.role, { navigate: (to) => router.navigate(to) });
```

- **`init`** finds the route table, the role table, translations and the app's language.
  It writes `<your app>/nextgen/nextgen.config.json` and marks every answer as **found** or
  **GUESSED**. It also writes `<your app>/nextgen/AGENT.md` — if an AI agent is running the
  rest of these steps for you (it usually is), that file is what tells it which decisions
  from here on (where this folder should live, which role to wire, whether to edit your
  `index.html`, whether to gitignore the output, and more) are yours to make, not its to
  assume.
- **`build`** writes `bundle/`, which you serve, and `review/`, which you never serve.
  Without `--model`, it needs no model server.
- **`doctor`** says what was read, what was left out and why, whether the thresholds are
  calibrated, and the exact lines to add to your page.

**Measured on bulletproof-react**, a public app the kit was not written for:
- `init` took 0s, `build` 1s and `doctor` 0s;
- it found 8 of 8 screens, and reported the one it left out (a redirect);
- `git status` afterwards showed **one new folder and no modified file**.

`doctor` also warned, correctly, that the app defines roles but has no route-to-role
table, so every user would receive every screen.

### The owner's acceptance run — on any real application

The kit has never been run on a production application by anyone but its author. That run
is the acceptance test, and **which application is the owner's choice**: a procedure
written against one named app proves nothing about a product whose whole claim is that it
works on any of them.

1. **`init` on the application's front end.** Read every line of the config it writes. A
   value marked GUESSED is the tool saying it had nothing to read, not a well-informed
   default. Two things `init` does not infer, and which you may have to add by hand:
   - `"manifests"`, if the app keeps hand-maintained navigation or deep-link tables —
     they are a far richer signal than JSX, and the single biggest lever on title quality;
   - the order of `"languages"`, which must start with the app's primary one.
2. **`build`.** With Ollama running and `--model`, prose is model-written and cached per
   screen, so a rebuild does not re-call the model for unchanged pages. With `--no-model`
   it is derived from the app's own labels. Both are reproducible, and neither writes
   anything into the application.
3. **`doctor`, and read all of it.** Every GUESSED line and every warning is a finding.
   Check in particular that the role list matches the application's real roles: if the app
   gates authorization *inside* its page components, route discovery cannot see it, one
   audience is generated, and every screen reaches everyone. That failure is silent — see
   [FIELD-NOTES.md §1](../adapter/FIELD-NOTES.md).
4. **`git status` in the application.** Expect one new untracked folder and no modified
   file. Anything else breaks Rule 16, and is the most important thing you could find.
5. **Calibrate before trusting any accuracy figure.** Write at least twenty questions the
   way the app's own users would ask them, including some the app cannot answer, then
   `calibrate` and `build` again. Out of the box the thresholds are general defaults and
   `doctor` says so. Note what calibration reports on its held-out split, not what it
   reports on the turns it optimised against.
6. **Mount it.** This is your edit, like adding a dependency:
   - serve `bundle/` as `/nextgen` — each signed-in user only their own role's registry and index
     (recipes: "Serving each role only its own files" in `packages/kit/README.md`);
   - add the one script line `doctor` prints. It uses no inline script or style, so a
     strict Content-Security-Policy is fine (`tooling/scripts/check-csp.mjs`);
   - pass the signed-in user's role.

   For a local test, copying `bundle/` into `public/nextgen` serves every role's files.
   That is fine on your own machine and wrong in production (Rule 17).

   The two lines put an accessible "ask where to go" box in the page's corner, and it
   speaks the page's own language — `<html lang="pt">` gets Portuguese. In a single-page
   app, pass the router to avoid a full reload:
   `NextGen.start('/nextgen', role, { navigate: (to) => router.navigate(to) })`.
   Without that, moving reloads the page. That is slower, but still correct.
7. **Send back:**
   - `doctor`'s output and `git status`;
   - how long it took;
   - what you corrected in the config;
   - any question that went somewhere wrong.

---

## What an adopter installs

| Package | When it runs | Why they need it |
|---|---|---|
| `@nextgen/kit` | build time | the `nextgen` command: `init`, `build`, `doctor`, `preview`, `calibrate` |
| `@nextgen/embed` | run time | the widget — `bundle/nextgen.js`, or `import { start }` |
| `@nextgen/generator` | build time | reads their source, emits one registry per role |
| `@nextgen/core-intent` | run time | the three-stage router, policy dispatch and the turn record that makes `why` answerable |
| `@nextgen/core-capability` | both | the registry contract |
| `@nextgen/core-inference` | run time | the stage-3 transport interface |

**Not installed:** anything outside these six packages. There is no reference application
shipped alongside an adopter's own — see [ADR-018](../.claude/decisions/ADR-018.md).

---

## 1 · Add the dependencies

```bash
npm install @nextgen/generator @nextgen/core-intent @nextgen/core-capability \
            @nextgen/core-inference
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
- `INFERRED.md` — every candidate rule found but not confident enough to ship (ADR-020, WP-55).

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

*Until 2026-09-11 that was not enough either.* The `/browser` entry still reached
`node:crypto`, `fs` and `path` through `core-inference`, and it read `process.env` at
module scope. Both threw on first load in a real page. Both are fixed, and WP-29's test
now runs the bundle with only a browser's globals, so a regression fails the suite.

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

## 6 · Or: one script tag, with no build step (WP-29)

This is for an app without a bundler. `packages/embed` builds a single file:

```bash
node packages/embed/build.mjs     # → packages/embed/dist/nextgen.js, ~9.3KB gzipped
```

```html
<script src="/nextgen/nextgen.js"></script>
<!-- Fetches registry.COACH.json, index.COACH.json and thresholds.hashing.json from
     the same origin, then mounts the chat box. No other network call is ever made. -->
<script>NextGen.start('/nextgen', 'COACH');</script>

<!-- Or, to draw your own interface, take the router alone: -->
<script>
  NextGen.load('/nextgen', 'COACH').then(async (assistant) => {
    const trace = await assistant.route('where do I see the training calendar');
    // trace.outcome, trace.capabilityId, trace.route
  });
</script>
```

**Serve each session only its own role's files.** Rule 17 is a delivery property: if every
role's registry sits in a public folder, the role split protects nothing. `@nextgen/embed`
ships in every release, and `nextgen build` copies its `nextgen.js` into `bundle/`.

---

## Uninstalling

```bash
npm uninstall @nextgen/kit @nextgen/embed @nextgen/generator @nextgen/core-intent \
              @nextgen/core-capability @nextgen/core-inference
rm -rf ./nextgen ./vendor/nextgen     # or ./generated, on the manual path below
```

Nothing else. The layer never wrote outside `out`, so there is nothing else to find.

---

## What this cost, honestly

| | |
|---|---|
| Packages to install | 6 tarballs, one `npm install` |
| Files the adopter writes by hand | **1** — the config in step 2 |
| Files of theirs we modify | **0** |
| Time to first routed turn, from an empty directory | under an hour, most of it discovering step 2's answers |

**And one thing that had to be fixed before any of this worked.** Every package in this
repository was `private: true` with `main: ./src/index.ts` — raw TypeScript. Node refuses
to strip types inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so
the packages could not be imported by anyone outside the workspace. It was invisible from
inside, where every import resolves through the workspace to source. `pnpm build` and
`tooling/scripts/check-packaging.mjs` exist because of it.
