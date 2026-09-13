# @nextgen/kit

**The drop-in kit (PLAN.md WP-41).** One command reads an application, writes everything
into a folder of its own, and explains in plain words what it could and could not read.

```bash
nextgen init  <your app folder>     # finds the route table, roles, translations, language
nextgen build [kit folder]          # writes bundle/ (served) and review/ (never served)
nextgen calibrate [kit folder] --golden questions.jsonl   # Rule 14, from questions you wrote
nextgen doctor [kit folder]         # what was read, what was left out and why, how to mount it
```

**Installing it.** `pnpm pack:release` in this repository writes the tarballs to
`release/`; `npm install -D` them in your project and run `npx nextgen …`. Node 20 or
newer, ES modules only. [INSTALL.md](../../INSTALL.md) has the whole path, and
`tooling/scripts/check-install.mjs` proves it on every pull request. Inside this
repository the command is also `node packages/kit/src/cli.ts`.

The kit folder defaults to `<app>/nextgen`: beside `src/`, never inside it.

## What it writes, and where

| Folder | Holds | Served? |
|---|---|---|
| `nextgen.config.json` | what `init` found, including anything it had to guess. It is yours to correct | — |
| `bundle/` | `registry.<ROLE>.json`, `index.<ROLE>.json`, `thresholds.hashing.json`, `nextgen.js` | **yes**, each user only their own role's files |
| `review/` | `master.json` (every screen, with every role that can reach it), `SKIPPED.md`, `build.json`, `detect.json` | **never** |
| `calibration/` | `thresholds.hashing.json`, if you have calibrated. `build` prefers it | — |

**Rule 16:** the kit writes nothing outside its folder. `init` refuses a folder inside your
source before writing anything. On bulletproof-react, a public app not written for it,
`git status` after a full run shows one new folder and no modified file.

**Rule 17:** the served folder holds no file that names another role. `master.json`
stays in `review/`. `build` rebuilds `bundle/` from nothing each time, so a role your app
no longer has cannot leave a registry behind. `doctor` re-checks both.

## Serving each role only its own files

`bundle/` holds one registry and one index per role. A role's file names the screens that role can
reach, so serving every file to everyone tells each user the names of screens they cannot open
(Rule 17). Serve `nextgen.js` and `thresholds.hashing.json` to everyone, and `registry.<ROLE>.json`
and `index.<ROLE>.json` only to a user whose **session** has that role — never a role taken from
the request, which anyone can change.

**Express**, after your own session middleware:

```js
import path from 'node:path';

const BUNDLE = path.resolve('nextgen/bundle');
const SHARED = new Set(['nextgen.js', 'thresholds.hashing.json']);

app.get('/nextgen/:file', (req, res) => {
  const role = req.user?.role; // your session
  const { file } = req.params;
  const own = Boolean(role) && (file === `registry.${role}.json` || file === `index.${role}.json`);
  if (!SHARED.has(file) && !own) return res.sendStatus(404);
  res.sendFile(file, { root: BUNDLE });
});
```

**Next.js** (app router), as `app/nextgen/[file]/route.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { currentRole } from '@/lib/auth'; // yours

const BUNDLE = path.join(process.cwd(), 'nextgen', 'bundle');
const SHARED = new Set(['nextgen.js', 'thresholds.hashing.json']);

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const role = await currentRole();
  const own = role !== null && (file === `registry.${role}.json` || file === `index.${role}.json`);
  if (!SHARED.has(file) && !own) return new Response(null, { status: 404 });
  const type = file.endsWith('.js') ? 'text/javascript' : 'application/json';
  return new Response(await readFile(path.join(BUNDLE, file)), { headers: { 'content-type': type } });
}
```

Both allow only the exact file names above, so a crafted name cannot reach anything else.

**nginx** in front of the app cannot know a user's role by itself. Let the app answer `/nextgen/`
as above, or put those two role files behind `auth_request` to an endpoint of yours that checks the
session.

`doctor` refuses a multi-role bundle that sits inside `public/` or `static/`, because a web app serves
those folders to everyone as they are.

## Keeping your own checks green

The kit folder sits inside your project, and its bundle is a minified script and generated JSON. If a
script in your `package.json` runs Prettier, ESLint or Biome over the whole project, `doctor` names it
and the one line to add — `"nextgen/"` in `.prettierignore`, for example. Prettier is measured failing
on those files; ESLint and Biome depend on your config. The kit never edits your config files.

## Calibrating (Rule 14)

Thresholds belong to a registry. The profile the kit ships was tuned on a 7-screen app;
on a 145-screen one it sent **2 of 7** confident answers to the wrong screen and refused
1 real question in 105. Until you calibrate, `doctor` says so in those words.

```bash
nextgen calibrate <kit folder> --golden questions.jsonl
nextgen build <kit folder>      # picks the calibration up
```

`questions.jsonl` is **yours to write** — one JSON object per line:

```json
{"utterance": "where do I see the invoices?", "route": "/billing", "role": "ADMIN"}
{"utterance": "book me a flight", "route": null, "role": "ADMIN"}
```

`"route": null` means the assistant should refuse it. Include both kinds: a sweep with
nothing to refuse cannot find the refusal threshold, and it will tell you so. `role` may
be omitted when your app has one audience. About 20 turns is the minimum that means
anything — below that `calibrate` refuses rather than fitting noise.

It splits your questions **by destination**, 40% to calibrate on and 60% held out, and
reports the held-out numbers: a threshold validated on a rephrasing of the question it was
tuned on measures nothing. It also warns when the result is worse than it looks — when it
never refuses anything, when held-out precision falls below the 100% the sweep enforces,
and when it refuses real requests it should not.

**There is deliberately no way to calibrate from the generator's own example questions.**
That was measured on an app where both kinds of data exist
([experiment-self-calibration.mjs](../../eval/fut-app/experiment-self-calibration.mjs)):
it made the engine **wrongly refuse 7 real requests in 105**, against 1 for the untouched
default. Offering it would be offering a worse outcome than doing nothing, wrapped in
something that looks like diligence.

The sweep itself is `@nextgen/core-intent/calibrate`, shared with this repository's own
calibration script so that Rule 14 has exactly one implementation.

## Which apps it reads

**React Router, Vue Router, Angular, Next.js (app and pages routers), Remix (flat routes), SvelteKit
and Nuxt.** `init` recognises the framework from `package.json` before reading anything. TanStack
Router and Solid Router are named when found, with what the kit can read, and nothing is written.
On six public apps it was not written for, it declared every screen and nothing else
([eval/field-apps/RESULT.md](../../eval/field-apps/RESULT.md)).

## What it does not do yet

- **Read roles from an app whose routes are a folder layout** (Next.js, Remix, SvelteKit, Nuxt). A folder layout says nothing about who may open a
  screen. If yours restricts some screens by role, list them in `routeRoles` by path prefix,
  `{ "/admin": ["ADMIN"] }`; `init` warns when your app mentions roles and there is none.

- **Guess your navigation manifests.** A hand-kept list of routes with labels makes
  descriptions much better. Add it to `manifests` in the config.
- **Read role guards written inside components.** If your app checks roles in the page
  rather than in the route table, `init` warns you, and every screen goes to one audience.
  Do not ship that bundle until you have confirmed that no screen is restricted.

## Tests

`src/kit.test.ts` runs `init → build → calibrate → doctor` on two fixture apps of
different shapes. It checks that the app is byte-for-byte unchanged, that the bundle
carries no role annotations and no master list, and that `calibrate` refuses the cases it
cannot stand behind — before a build, and on a golden set too small to believe.
