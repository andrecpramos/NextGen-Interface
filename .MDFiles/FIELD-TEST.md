# Field test — the kit on a project nobody here has seen

**For the owner.** You play the adopter on a real, running, complex project that this repository
was never tuned to. The point is an honest assessment of three things the lab cannot measure:
**how well it adapts to an unknown project**, **how good its answers are for that project's
users**, and **what it costs to wire in**. Every number in `eval/` came from apps an agent chose;
this one did not.

Write things down **as they happen**, including what went wrong and how long it took. A step
that needed a workaround is a finding, not a detour.

---

## Stop conditions

Decided before the test, so a bad result is a decision and not a disappointment:

| If | Then |
|---|---|
| **Any file of your project was modified** by `init`, `build`, `calibrate`, `doctor` or `preview` (check `git status`) | Stop. Rule 16 is the product. |
| **A screen appears in the registry of a role that cannot open it** | Stop. Rule 17 is a security property, with a zero-tolerance kill criterion. |
| `init` cannot find the routes and `doctor` does not say why in words you could act on | The kit is not drop-in for that stack yet. Record the stack, the message, and stop. |

---

## 0 · Before you start

1. In this repository: `pnpm install --ignore-scripts && pnpm pack:release`. Note the Node version on
   both machines.
2. In your project, commit or stash everything, so `git status` is clean. It is the Rule 16 check.
3. **Write your own list of the screens a user can reach** — 15 to 30 is plenty — with the roles that
   can reach each one. Do this **before** running the kit. It is the ground truth the kit's output is
   scored against, and it only counts if it was written first.

## 1 · Install

```bash
npm install -D <the .tgz paths pack:release printed>
```

Record: time taken, any error, any peer-dependency warning that mattered.

## 2 · `init`

```bash
npx nextgen init .
```

Record, for **every line** it prints: was it **found** or **GUESSED**, and was it **right**?
Especially the framework, the routes, the role table and the app's language.

## 3 · `build` and `doctor`

```bash
npx nextgen build nextgen
npx nextgen doctor nextgen --report field-report.md
git status   # expect only nextgen/ as new
```

Score against the list from step 0:

| | Count | Which |
|---|---|---|
| Screens on your list that it declared | | |
| Screens on your list it **missed** | | |
| Screens it declared that are **not** real destinations | | |
| Screens in a role that **cannot** open them (stop condition) | | |
| Things it left out, and was right to | | |
| Titles you would not recognise as that screen | | |

## 4 · `preview` — the answers, before any wiring

```bash
npx nextgen preview nextgen --app-url http://localhost:<your app's port>
```

Pick your most important role. Ask **20 questions in the words your users actually use** — not the
screen titles:

- 10 that ask to go somewhere ("where do I change my password")
- 5 that ask what something is or how to do something ("what is the billing page for")
- 5 that ask for something the app **cannot** do ("book me a flight")

For each, record one of:

| Result | Meaning |
|---|---|
| **First** | the right screen was the first thing it offered, or it went straight there |
| **In the choices** | the right screen was among the choices |
| **Wrong** | it went, or pointed first, somewhere wrong |
| **Refused — right** | it declined something the app cannot do |
| **Refused — wrong** | it declined something the app can do |

A table to fill in:

| # | Question | Expected screen | Result | Notes |
|---|---|---|---|---|
| 1 | | | | |

## 5 · `calibrate`, then ask again

Turn the 20 questions into `questions.jsonl` (one per line:
`{"utterance": "...", "route": "/where" or null, "role": "..."}`), then:

```bash
npx nextgen calibrate nextgen --golden questions.jsonl
npx nextgen build nextgen
```

Ask **10 new questions** of the same kinds — not the 20 you calibrated on — and record them the same
way. The difference between step 4 and this step is what calibration is worth on your app.

## 6 · Wire it in

Follow what `doctor` prints. Record, for each:

- **The script tag** (or `import { start } from '@nextgen/embed'`): did it appear? Did it overlap
  anything on your page?
- **Your Content-Security-Policy**, if you have one: any violation in the console?
- **Navigation**: in a single-page app, did following a choice reload the page before you added the
  `nextgen:navigate` listener, and not after?
- **Per-role serving**: which recipe did you use, and does a user of one role get a 404 for another
  role's `registry.<ROLE>.json`? (Check it in the browser's network tab.)
- **Your CI**: does it stay green with `nextgen/` committed? Did `doctor` warn you about the tool
  that would have failed?
- **Time spent**, start to finish.

## 7 · Send back

- `field-report.md` from step 3 (it lists screens against roles: share it only with people who may
  know that)
- the tables from steps 3, 4 and 5
- every workaround, error message and surprise, verbatim

## What a good result looks like, and what does not

Not a pass mark — a way to read the numbers.

- **Adapts:** it found the routes without you editing config, and `git status` shows only `nextgen/`.
  Anything marked GUESSED that was wrong is the first thing to fix in the kit.
- **Answers:** in the lab, on `fut-app`, the shipped widget put the right screen first for about half
  of real questions and among its choices for about seven in ten, where that app's own command palette
  managed about four in ten. Much lower on your app is a finding about the kit, not about your app.
- **Wires in:** under an hour, with no change to your CSP and no red CI.
