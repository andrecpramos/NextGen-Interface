# Getting started

This adds an "ask where to go" box to your web app. People type what they want in their own
words, and it takes them to the right screen, or offers the two likeliest to choose from.

- It reads your app's routes, roles and translations to learn its screens.
- It **never changes your files**; everything it writes goes into one folder of its own.
- In the browser it needs **no model and no server**.
- Nothing is installed: you copy one folder. No package manager, no registry, no network.

**You need:**
- Node 20 or newer.
- An app built with React Router, Vue Router, Angular, Next.js, Remix, SvelteKit or Nuxt.
- Access to this repository, to copy one folder out of it.

Use is governed by the [LICENSE](../LICENSE).

**Using a coding agent?** Copy the folder (step 1), then give the agent its path and nothing
else. [adapter/AGENTS.md](../adapter/AGENTS.md) is the first thing it reads, and it puts the
decisions that are yours to you before acting on them. The steps below are what it does.

---

## 1 · Copy the folder

Copy [`adapter/`](../adapter/) from this repository into your project. Any place works; this
page calls it `nextgen-tool/`.

```bash
cp -r path/to/NextGen-Interface/adapter  your-app/nextgen-tool
```

It is about 4 MB and it is a tool, not application code. **Commit it**, so your CI and your
teammates have exactly the version you used. `VERSION` inside it identifies the build (it is not a
release number), and `doctor` prints it on its first line: quote it when you report a problem.

## 2 · Generate

From your app's root folder:

```bash
node nextgen-tool/scan.mjs init .
node nextgen-tool/scan.mjs build nextgen
node nextgen-tool/scan.mjs doctor nextgen
```

- **`init`** finds your routes, roles and languages, and writes `nextgen/nextgen.config.json`.
  It marks each answer **found** or **GUESSED**. Check every guess, fix it in that file,
  then run `build` again.
- **`build`** writes `nextgen/bundle/`, which you will serve, and `nextgen/review/`, which
  you never serve.
- **`doctor`** tells you what it read, what it left out and why, and the exact line to add
  to your page. **Read all of it.** It ends with a numbered "Next steps" list for the state your
  build is in.

Every command prints the next one, written to run from where you are.

**Next.js, Remix, SvelteKit or Nuxt with role-restricted screens?** The tool cannot see roles
in a folder layout, so add them to the config by path prefix, then build again:

```json
"routeRoles": { "/admin": ["ADMIN"] }
```

## 3 · Try it before wiring anything in

```bash
node nextgen-tool/scan.mjs preview nextgen --app-url http://localhost:3000
```

This opens a local page. Pick a role, ask questions the way your users would, and see where
each answer would take them. Nothing in your app changes.

## 4 · Put it in your app

**a. Serve `nextgen/bundle/` at `/nextgen/`, each user only their own role's files.**
- `nextgen.js` and `thresholds.hashing.json` go to everyone.
- `registry.<ROLE>.json` and `index.<ROLE>.json` go only to a signed-in user whose session
  has that role.
- Never serve `nextgen/review/`: it lists every screen with every role that can open it.

Ready-made handlers for Express and Next.js are under "Serving it" in
[adapter/AGENTS.md](../adapter/AGENTS.md#serving-it).

**b. Add one line to your page.** Your server writes in the signed-in user's role:

```html
<script src="/nextgen/nextgen.js" data-nextgen-role="MANAGER" defer></script>
```

It uses no inline script or style, so it works under a strict Content-Security-Policy.

Optional attributes:

| Attribute | What it does |
|---|---|
| `data-nextgen-base` | where you serve the files, if not the folder `nextgen.js` came from |
| `data-nextgen-target` | a CSS selector to place the box inside, instead of a corner |
| `data-nextgen-position` | which side the button rests on: `bottom-right`, `bottom-left`, `top-right` or `top-left`. By default, the emptier side of your page |
| `data-nextgen-lang` | the box's language; by default, your page's `<html lang>` |
| `data-nextgen-attach` | `on` offers a paperclip (and a camera, on a phone). **Off by default** — see d. |

**c. In a single-page app, keep navigation inside your router:**

```js
window.addEventListener('nextgen:navigate', (event) => {
  event.preventDefault();
  router.navigate(event.detail.route);
});
```

**d. Only if your app can use a file a visitor attaches** (an upload form, a claims inbox), add
`data-nextgen-attach="on"` and take the files in your own code. Nothing attached ever leaves the
visitor's device: the assistant does not read it or send it anywhere, it only hands it to your page.

```js
window.addEventListener('nextgen:attach', (event) => {
  const { files, utterance, route } = event.detail; // File objects, what they typed, where they were
  event.preventDefault();                           // tells the visitor your app took it
});
```

Check what you are given: a file's name and type come from the visitor.

## 5 · Tune it to your app (recommended)

Out of the box it knows each screen only by its title and the text on it, and it uses general
thresholds. `doctor` says both. Two things fix that, in this order.

**a. Tell it what your app is for.** `build` writes `nextgen/review/KNOWLEDGE-GAPS.md`: the
questions only you can answer — what each screen is for, the words your users say that never appear
on a screen, and what the app cannot do (and, for each, where a visitor can do it themselves: the
assistant never does it for them, but it points there instead of stopping at "no"). Write the answers into `nextgen/knowledge.json` (the shape is
at the end of that file) and run `build` again. On the reference app this took the right screen from
first place in 6 of 10 everyday questions to 9 of 10 — measured on a fixture, with answers written by
the tool's author, so an upper bound until a real app confirms it. Write only what is true: every purpose you
give is shown to visitors as fact. A coding agent will run this as an interview with you
([adapter/AGENTS.md](../adapter/AGENTS.md), ASK 9).

**b. Calibrate.**

1. Write at least 20 real questions into `questions.jsonl`, one per line — not the phrases you
   put in `knowledge.json`, or you measure memory, not understanding. Include some your app
   cannot answer, marked with `"route": null`:

   ```json
   {"utterance": "where do I see the invoices?", "route": "/billing", "role": "ADMIN"}
   {"utterance": "book me a flight", "route": null, "role": "ADMIN"}
   ```

2. Calibrate, then build again:

   ```bash
   node nextgen-tool/scan.mjs calibrate nextgen --golden questions.jsonl
   node nextgen-tool/scan.mjs build nextgen
   ```

## Keeping it current

- **Your routes change:** run `node nextgen-tool/scan.mjs build nextgen`, then `doctor`, again.
- **A newer version of the tool:** delete `nextgen-tool/`, copy `adapter/` from the commit you
  want in its place, and run `build` again. `VERSION` changes exactly when the tool does, so
  comparing it tells you whether there is anything new.
- **Removing it:**
  1. Delete the script line.
  2. Delete `nextgen/` and `nextgen-tool/`.

## What to expect

- **It usually offers choices.** It shows the two likeliest screens, each with what it is for
  (from your `knowledge.json`, or the screen's own description), and moves straight to one
  only when it is sure. Someone who says "hi", or "I have no idea what to do", is greeted and
  shown a few places to begin; they are never told it cannot do that.
- **It never offers a screen the user's role cannot open.** Each role's files contain only
  its own screens.
- **It never performs actions.** It moves between screens and shows links; it does not
  save, send or delete anything.
- **It does not use a model to write descriptions**, and the tool makes no network request.
  A model at run time is a separate, off-by-default choice that goes to *your own* server
  ([adapter/AGENTS.md](../adapter/AGENTS.md), "Turn on model-backed answers").

## When something looks wrong

Run this and send `field-report.md`:

```bash
node nextgen-tool/scan.mjs doctor nextgen --report field-report.md
```

The report lists every screen with the roles that can open it, so share it only with
people allowed to know that.

What goes wrong when this tool meets a real application, from the times it actually did, is
in [adapter/FIELD-NOTES.md](../adapter/FIELD-NOTES.md).
