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

## What it does not do yet

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
