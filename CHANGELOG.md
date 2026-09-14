# Changelog

One section per released version, newest first. The release workflow publishes the
section whose heading matches the tag as the GitHub Release notes, and
`tooling/scripts/check-release.mjs` fails if the packages' version has no section here.

Every package in a release carries the same version.

## 0.1.0 — unreleased

The first release: a drop-in AI navigation layer for a web application that already
exists. It reads the app's source, declares what each role can reach, and adds an "ask
where to go" box to the page. It never modifies the app's files.

### What you install

Eight tarballs, attached to the GitHub Release; [GETTING-STARTED.md](GETTING-STARTED.md) has
the steps. `@nextgen/kit` is the one you use; the other seven are its dependencies and the
engine underneath.

| Package | What it is |
|---|---|
| `@nextgen/kit` | the `nextgen` command: `init`, `build`, `doctor`, `preview`, `calibrate` |
| `@nextgen/embed` | the widget, as a script tag (`nextgen.js`) and as an ES module |
| `@nextgen/generator` | reads an app's routes, roles and translations; writes one registry per role |
| `@nextgen/core-intent` | the router: deterministic match, then embedding similarity, then an optional model |
| `@nextgen/core-capability` | the registry contract |
| `@nextgen/core-inference` | the interface to an optional model |
| `@nextgen/core-dispatch` | policy: read executes, write and destructive confirm |
| `@nextgen/core-trace` | the turn record that makes "why did you do that?" answerable |

### What it does

- **Reads seven routers:** React Router, Vue Router, Angular, Next.js, Remix, SvelteKit
  and Nuxt. On anything else, `init` names what it found and writes nothing.
- **Role-scoped by construction.** Each role gets a registry holding only the screens it
  can reach (Rule 17). `doctor` refuses a public bundle for a multi-role app.
- **Writes only its own folder.** Nothing in the app's source is modified (Rule 16).
  This is checked on every pull request, by hashing a copied app before and after.
- **No model and no network by default.** The script tag routes in the browser. Its
  only requests load its own files from your origin.
- **Works under a strict Content-Security-Policy.** No inline script or style.
- **`nextgen preview`** lets you try the answers on your app before wiring anything in.
  **`nextgen doctor --report`** writes every screen, its roles, and what was left out.

### Requirements

- Node 20 or newer, to run `nextgen`. The installed packages are checked on Node 20 and
  on current Node.
- ES modules only.
- Nothing runs in production except the files `build` writes into `bundle/`.

### Measured, and what the measurement cannot claim

- **Routing quality.** On a real 146-page application, against the app's own command
  palette, the script tag with no model:
  - showed the right screen among its choices (at most 3) for **69.9%** of questions,
    against the palette's 45.5%;
  - showed it first for **53.4%**, against 42.6%;
  - never sent anyone to a wrong screen.

  The questions are model-written, so treat these as upper bounds
  ([like-for-like.json](eval/fut-app/like-for-like.json)).
- **Route discovery.** On six public apps it had never seen, it found every route in a
  ground truth written beforehand, and changed none of their files
  ([RESULT.md](eval/field-apps/RESULT.md)).

### Known limits

- **It rarely decides alone.** It navigates on its own for 1.7% of questions; almost
  every other answer is a short list for the user to pick from.
- **Out-of-scope requests.** It declines 47.1% of requests for things the app cannot
  do, against a target of ~70%. It executes none of them and asks a clarifying question
  for the rest (PLAN.md §13, D-5).
- **Not yet checked by a person:** a screen-reader pass (automated accessibility checks
  pass), real Portuguese speech, and a live deployment.
- **Write and destructive capabilities** must not ship to an adopter until WP-48, the
  prompt-injection defence, lands.
