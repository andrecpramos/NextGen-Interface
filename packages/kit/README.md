# @nextgen/kit

**The drop-in kit (PLAN.md WP-41).** One command reads an application, writes everything
into a folder of its own, and explains in plain words what it could and could not read.

```bash
nextgen init  <your app folder>     # finds the route table, roles, translations, language
nextgen build [kit folder]          # writes bundle/ (served) and review/ (never served)
nextgen doctor [kit folder]         # what was read, what was left out and why, how to mount it
```

In this repository, the command is `node packages/kit/src/cli.ts`. The kit folder
defaults to `<app>/nextgen`: beside `src/`, never inside it.

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

## What it does not do yet

- **Calibrate.** Without a calibration, the thresholds are defaults tuned on a 7-screen
  app. On a 145-screen app they sent 2 of 7 confident answers to the wrong screen.
  Calibrating on the kit's own example questions was measured and was worse
  ([experiment-self-calibration.mjs](../../eval/fut-app/experiment-self-calibration.mjs)).
  Calibration needs real questions, and there is no `nextgen calibrate` command yet.
- **Guess your navigation manifests.** A hand-kept list of routes with labels makes
  descriptions much better. Add it to `manifests` in the config.
- **Read role guards written inside components.** If your app checks roles in the page
  rather than in the route table, `init` warns you, and every screen goes to one audience.
  Do not ship that bundle until you have confirmed that no screen is restricted.

## Tests

`src/kit.test.ts` runs `init → build → doctor` on two fixture apps of different shapes.
It checks that the app is byte-for-byte unchanged, and that the bundle carries no role
annotations and no master list.
