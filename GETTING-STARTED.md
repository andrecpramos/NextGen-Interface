# Getting started

This adds an "ask where to go" box to your web app. People type what they want in their own
words, and it takes them to the right screen, or offers up to three to choose from.

- It reads your app's routes, roles and translations to learn its screens.
- It **never changes your files**; everything it writes goes into one folder of its own.
- In the browser it needs **no model and no server**.

**You need:**
- Node 20 or newer.
- An app built with React Router, Vue Router, Angular, Next.js, Remix, SvelteKit or Nuxt.
- Access to this repository's releases.

Use is governed by the [LICENSE](LICENSE).

---

## 1 · Install

In your app's root folder:

```bash
gh release download v0.1.0 --repo andrecpramos/AI-Interface --dir vendor/nextgen
npm install -D vendor/nextgen/*.tgz
```

On **Windows PowerShell**, which passes `*` to npm unexpanded, use this line for the install:

```powershell
npm install -D (Get-ChildItem vendor/nextgen/*.tgz | Resolve-Path -Relative)
```

No `gh`? Download the `.tgz` files from the release page into `vendor/nextgen/` instead.

**Commit `vendor/nextgen/`.** Your `package.json` now points at those files, so your CI
needs them.

## 2 · Generate

```bash
npx nextgen init .
npx nextgen build nextgen
npx nextgen doctor nextgen
```

- **`init`** finds your routes, roles and languages, and writes `nextgen/nextgen.config.json`.
  It marks each answer **found** or **GUESSED**. Check every guess, fix it in that file,
  then run `build` again.
- **`build`** writes `nextgen/bundle/`, which you will serve, and `nextgen/review/`, which
  you never serve.
- **`doctor`** tells you what it read, what it left out and why, and the exact line to add
  to your page. **Read all of it.**

**Next.js, Remix, SvelteKit or Nuxt with role-restricted screens?** The kit cannot see roles
in a folder layout, so add them to the config by path prefix, then build again:

```json
"routeRoles": { "/admin": ["ADMIN"] }
```

## 3 · Try it before wiring anything in

```bash
npx nextgen preview nextgen --app-url http://localhost:3000
```

This opens a local page. Pick a role, ask questions the way your users would, and see where
each answer would take them. Nothing in your app changes.

## 4 · Put it in your app

**a. Serve `nextgen/bundle/` at `/nextgen/`, each user only their own role's files.**
- `nextgen.js` and `thresholds.hashing.json` go to everyone.
- `registry.<ROLE>.json` and `index.<ROLE>.json` go only to a signed-in user whose session
  has that role.
- Never serve `nextgen/review/`: it lists every screen with every role that can open it.

Ready-made handlers for Express and Next.js are in the
[kit's README](packages/kit/README.md#serving-each-role-only-its-own-files).

**b. Add one line to your page.** Your server writes in the signed-in user's role:

```html
<script src="/nextgen/nextgen.js" data-nextgen-role="COACH" defer></script>
```

It uses no inline script or style, so it works under a strict Content-Security-Policy.

Optional attributes:

| Attribute | What it does |
|---|---|
| `data-nextgen-target` | a CSS selector to place the box inside, instead of a corner |
| `data-nextgen-position` | `bottom-right` (the default), `bottom-left`, `top-right` or `top-left` |
| `data-nextgen-lang` | the box's language; by default, your page's `<html lang>` |

**c. In a single-page app, keep navigation inside your router:**

```js
window.addEventListener('nextgen:navigate', (event) => {
  event.preventDefault();
  router.navigate(event.detail.route);
});
```

## 5 · Tune it to your app (recommended)

Out of the box it uses general thresholds, and `doctor` says so. To tune them:

1. Write at least 20 real questions into `questions.jsonl`, one per line. Include some your
   app cannot answer, marked with `"route": null`:

   ```json
   {"utterance": "where do I see the invoices?", "route": "/billing", "role": "ADMIN"}
   {"utterance": "book me a flight", "route": null, "role": "ADMIN"}
   ```

2. Calibrate, then build again:

   ```bash
   npx nextgen calibrate nextgen --golden questions.jsonl
   npx nextgen build nextgen
   ```

## Keeping it current

- **Your routes change:** run `npx nextgen build nextgen`, then `doctor`, again.
- **A new release:** empty `vendor/nextgen/`, download the new release into it, and run
  `npm install -D vendor/nextgen/*.tgz` again (on PowerShell, the line from step 1).
- **Removing it:**
  1. Delete the script line.
  2. Run `npm uninstall` on the `@nextgen/*` packages.
  3. Delete `nextgen/` and `vendor/nextgen/`.

## What to expect

- **It usually offers choices.** It shows up to three likely screens, and moves straight to
  one only when it is sure.
- **It never offers a screen the user's role cannot open.** Each role's files contain only
  its own screens.
- **It never performs actions.** It moves between screens and shows links; it does not
  save, send or delete anything.

## When something looks wrong

Run this and send `field-report.md`:

```bash
npx nextgen doctor nextgen --report field-report.md
```

The report lists every screen with the roles that can open it, so share it only with
people allowed to know that.

The full reference is [.MDFiles/INSTALL.md](.MDFiles/INSTALL.md).
