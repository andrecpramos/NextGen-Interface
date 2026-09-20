# The owner's acceptance run — on any real application

This is **WP-35**, and it is the one thing left that an agent cannot do for you. The tool has
never been run on a production application by anyone but its author; that run is the
acceptance test. **Which application is your choice**: a procedure written against one named
app proves nothing about a product whose whole claim is that it works on any of them.

It takes an afternoon. Before it, [`pnpm preview`](../preview/README.md) is where to judge the
answers, the UI and the voice on a bench, so this one real trial isn't spent on defects a
local page would have caught. The steps below assume you have copied [`adapter/`](../adapter/)
into the application as `nextgen-tool/` ([GETTING-STARTED.md](GETTING-STARTED.md) step 1), or
handed its path to a coding agent, whose first read is
[adapter/AGENTS.md](../adapter/AGENTS.md).

1. **`init` on the application's front end.**

   ```bash
   node nextgen-tool/scan.mjs init .
   ```

   Read every line of the config it writes. A value marked GUESSED is the tool saying it had
   nothing to read, not a well-informed default. Two things `init` does not infer, and which
   you may have to add by hand:
   - `"manifests"`, if the app keeps hand-maintained navigation or deep-link tables — they are
     a far richer signal than JSX, and the single biggest lever on title quality;
   - the order of `"languages"`, which must start with the app's primary one.
2. **`build`.** Descriptions are derived from the app's own labels. There is no model to run
   and the tool makes no network request, so this needs nothing installed beyond Node.
3. **`doctor`, and read all of it.** Every GUESSED line and every warning is a finding.
   Check in particular that the role list matches the application's real roles: if the app
   gates authorization *inside* its page components, route discovery cannot see it, one
   audience is generated, and every screen reaches everyone. That failure is silent — see
   [FIELD-NOTES.md §1](../adapter/FIELD-NOTES.md).
4. **`git status` in the application.** Expect one new untracked folder for the generated
   output, one for the tool if you have not committed it, and **no modified file**. Anything
   else breaks Rule 16, and is the most important thing you could find.
5. **Calibrate before trusting any accuracy figure.** Write at least twenty questions the way
   the app's own users would ask them, including some the app cannot answer, then
   `calibrate` and `build` again. Out of the box the thresholds are general defaults and
   `doctor` says so. Note what calibration reports on its held-out split, not what it reports
   on the turns it optimised against.
6. **Mount it.** This is your edit, like adding a dependency:
   - serve `bundle/` as `/nextgen` — each signed-in user only their own role's registry and
     index (recipes: "Serving it" in [adapter/AGENTS.md](../adapter/AGENTS.md));
   - add the one script line `doctor` prints. It uses no inline script or style, so a strict
     Content-Security-Policy is fine (`tooling/scripts/check-csp.mjs`);
   - pass the signed-in user's role.

   For a local test, copying `bundle/` into `public/nextgen` serves every role's files. That
   is fine on your own machine and wrong in production (Rule 17).

   The two lines put an accessible "ask where to go" box in the page's corner, and it speaks
   the page's own language — `<html lang="pt">` gets Portuguese. In a single-page app, keep
   navigation inside your router with the `nextgen:navigate` event
   ([GETTING-STARTED.md](GETTING-STARTED.md) step 4c). Without that, moving reloads the page.
   That is slower, but still correct.
7. **Send back:**
   - `doctor`'s output and `git status`;
   - how long it took;
   - what you corrected in the config;
   - any question that went somewhere wrong.

The measurements this run adds are the ones nothing built so far has: whether the questions
real users ask settle in stages 1 and 2, and what a session costs. Until then the claims stay
where they were measured (README, "Status").
