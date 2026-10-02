# @nextgen/kit

**The drop-in kit (PLAN.md WP-41).** One command reads an application, writes everything
into a folder of its own, and explains in plain words what it could and could not read.

This package is **source, not something an adopter installs** ([ADR-021](../../.claude/decisions/ADR-021.md)).
It is bundled into `adapter/scan.mjs`, the one file an adopter runs; this page is for
working on it. An adopter's path in is [GETTING-STARTED.md](../../.MDFiles/GETTING-STARTED.md),
and the document their coding agent reads first is [adapter/AGENTS.md](../../adapter/AGENTS.md).

```bash
node <here>/scan.mjs init  <your app folder>    # finds the route table, roles, translations, language
node <here>/scan.mjs build [kit folder]         # writes bundle/ (served) and review/ (never served)
node <here>/scan.mjs calibrate [kit folder] --golden questions.jsonl   # Rule 14, from questions you wrote
node <here>/scan.mjs doctor [kit folder]        # what was read, what was left out and why, how to mount it
node <here>/scan.mjs doctor [kit folder] --report field-report.md      # the same, plus every screen and skip, as a file
node <here>/scan.mjs preview [kit folder]       # try it on your app before wiring anything in
```

`<here>` is the copied `adapter/` folder. In this repository, run the same thing from source
with `node --experimental-strip-types packages/kit/src/cli-copied.ts <command> …` (Node 23.6 or
newer), or rebuild the bundle with `pnpm adapter:build`. Node 20 or newer runs the bundle.

The kit folder defaults to `<app>/nextgen`: beside `src/`, never inside it.

## What it writes, and where

| Folder | Holds | Served? |
|---|---|---|
| `nextgen.config.json` | what `init` found, including anything it had to guess. It is yours to correct | — |
| `bundle/` | `registry.<ROLE>.json`, `index.<ROLE>.json`, `thresholds.hashing.json`, `nextgen.js` | **yes**, each user only their own role's files |
| `review/` | `master.json` (every screen, with every role that can reach it), `SKIPPED.md`, `INFERRED.md`, `build.json`, `detect.json` | **never** |
| `calibration/` | `thresholds.hashing.json`, if you have calibrated. `build` prefers it | — |

## If an AI agent is running this for you

Realistically, it is. The decisions in `build`, `doctor` and mounting that are genuinely the
developer's to make — where this folder lives relative to whatever a dev server serves, which
role and auth source to wire, whether to edit `index.html`, whether to gitignore the output,
whether to wire real navigation, whether to calibrate now or later — are not the kit's to
decide silently, and are not the agent's either. They are written down in
[adapter/AGENTS.md](../../adapter/AGENTS.md), which ships beside `scan.mjs`. If you are that
agent: read it before running `build`. If you are the developer and your agent didn't mention
it: ask it to.

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

Ready-made handlers for **Express** and **Next.js** (app router) are under "Serving it" in
[adapter/AGENTS.md](../../adapter/AGENTS.md); they allow only the exact file names, so a crafted
name cannot reach anything else.

**nginx** in front of the app cannot know a user's role by itself. Let the app answer `/nextgen/`
as those handlers do, or put the two role files behind `auth_request` to an endpoint of yours that
checks the session.

`doctor` refuses a multi-role bundle that sits inside `public/` or `static/`, because a web app serves
those folders to everyone as they are.

## Trying it before wiring it in

```bash
node <here>/scan.mjs preview nextgen --app-url http://localhost:3000
```

A local page (127.0.0.1) that loads the built bundle exactly as a production page would — the one-line
script tag, under a strict Content-Security-Policy — for any role, with one example question per
screen a click away. When the assistant would move the browser, the page says where, and links into
your running app if you pass `--app-url`. So you can judge the answers before touching your app, and
the integration separately. It serves every role's files so you can switch between them, which
production must never do; the page says so.

`doctor --report field-report.md` writes doctor's text plus every screen it declared, with its
roles, and everything it left out. It lists screens against roles, so share it only with people who
may know that.

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
node <here>/scan.mjs calibrate <kit folder> --golden questions.jsonl
node <here>/scan.mjs build <kit folder>      # picks the calibration up
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
That was measured on an app where both kinds of data exist: it made the engine **wrongly
refuse 7 real requests in 105**, against 1 for the untouched default. Offering it would be
offering a worse outcome than doing nothing, wrapped in something that looks like diligence.

The sweep itself is `@nextgen/core-intent/calibrate`, shared with this repository's own
calibration script so that Rule 14 has exactly one implementation.

## Turn on model-backed answers (stage 3, WP-52, ADR-017)

Out of the box, a question the router cannot settle from the registry gets a clarifying
question back — never wrong, but it can read like a menu. `--stage3 <path>` changes that:
an unsettled turn POSTs to `<path>` on **your own origin**, and your server decides which
model answers. Off unless you pass it.

```bash
node <here>/scan.mjs build <kit folder> --stage3 /nextgen/stage3 [--stage3-model <name>]
```

`doctor` then says plainly that stage 3 is ON and names the path — read it before you ship.
What the proxy receives, what it must answer, and a rate-limited Express reference are in
[adapter/AGENTS.md](../../adapter/AGENTS.md), "Turn on model-backed answers". **An
unauthenticated endpoint that calls a model is something anyone loading your page can spend
money or GPU time against** — rate limit it before it is live, not after.

**What stays true whether or not you turn this on:**

- The visitor's words never leave your own origin from their browser — the transport
  resolves the configured path against the page it runs on and refuses to POST anywhere
  else, checked on every commit against a mocked network boundary
  (`tooling/scripts/check-stage3.mjs`).
- A timeout, an unreachable path or a malformed response degrades to today's clarifying
  question. It never crashes the assistant and never guesses.
- **This tool cannot use a model to write descriptions at all.** `build --model` is refused:
  there is no client for one in the bundle and the tool reaches no network, so descriptions
  come from the app's own labels (ADR-018 D-6, ADR-021). Stage 3 is about what happens to a
  visitor's *question*, at *their* browsing time, on *your* server.

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
`src/agents-md.test.ts` holds the invariants of `adapter/AGENTS.md` that would harm an
adopter if a hurried edit lost them. What runs the *built* bundle in a bare directory is
`tooling/scripts/check-adapter.mjs`.
