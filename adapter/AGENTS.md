# Read this before you run anything else in this folder

You are an AI coding agent installing **NextGen Interface** — an AI navigation assistant —
into someone else's application, on their behalf. Someone copied this folder into their
repository and gave you its path. Everything needed is here: no package to install, no
registry to reach, no account, no network.

**The one rule this file asks of you:** each section below marked `ASK` is a decision that
belongs to the developer, not to you. Put it to them in your own words, wait for an actual
answer, and only then act on it — even if you are confident you already know what they
will say. A default is suggested for each so you have something concrete to propose, not
so you can skip asking.

This exists because of a real field test. An agent ran every step end to end, unattended,
including editing the app's own `index.html` and `.gitignore`. Every individual step was
defensible and the developer still came out of it feeling like a bystander in their own
project. That is a bad trade even when it works.

Say what you are about to do before you do it.

---

## What is in this folder

| | |
|---|---|
| `AGENTS.md` | this file |
| `FIELD-NOTES.md` | **what goes wrong when this tool meets a real application.** Eight sections, every one a failure that actually happened. Read it before you believe any output below |
| `scan.mjs` | the whole tool, in one file. Node 20 or newer, no dependencies |
| `runtime/nextgen.js` | the assistant itself, already compiled, ready to serve |

## The four commands

Run them from the application's root. `<here>` is this folder.

```bash
node <here>/scan.mjs init   .            # read the app, write nextgen/nextgen.config.json
node <here>/scan.mjs build  nextgen      # write nextgen/bundle/ and nextgen/review/
node <here>/scan.mjs doctor nextgen      # what it read, what it guessed, what to fix
node <here>/scan.mjs calibrate nextgen --golden questions.jsonl   # see ASK 7
```

**`doctor`'s full output goes to the developer — do not summarize it away.** It states
plainly what was found, what was guessed, whether the assistant is calibrated for this
app, and lists `PROBLEMS` if anything must be fixed before it is safe to ship.

**A line marked `GUESSED` is not a well-informed default.** It is the tool telling you it
had nothing to read. Check every one with the developer rather than accepting it because
it looks plausible.

## The one thing to verify yourself, before anything else

**Does the role list `doctor` prints match the application's real roles?**

If this app does its authorization *inside* page components —
`<Authorization allowedRoles={['ADMIN']}>` wrapping a page's body, or anything of that
shape — route discovery cannot see it. The tool then generates **one audience**, and every
screen goes to everyone. Reports will say nothing is wrong, because from the route table's
point of view nothing is.

This is not hypothetical: on a public application with three roles, the first run shipped
four admin-only screens and seven member-only screens to every user — 15 role leaks — and
every report was clean. `FIELD-NOTES.md` §1 has the detail.

If authorization lives in the components, tell the developer the generated role split is
meaningless and must be declared by hand.

---

## ASK 1 — Where should this folder and the generated one live?

Two placement questions, and both have a wrong answer that is easy to reach.

**The generated `nextgen/` folder.** `build` writes `review/master.json` — every screen
this app has, **for every role**, explicitly marked never-serve. If that folder sits
inside whatever your dev server publishes as static files (a typical Vite or CRA project
root, anywhere under `public/`), that file becomes fetchable by URL the moment the server
starts. That is not hypothetical either; it is what happened the first time this was
pointed at a real app.

**This folder.** It is about 4MB, and it is a tool rather than application code.

Ask something like: *"Two placement questions. First: where should the generated folder
go? If it sits anywhere your dev server serves as static files, the review output — which
lists every screen for every role — becomes reachable by URL. I'd suggest a sibling
outside the served root. Second: do you want this tool folder committed to the repo, so
your CI and your teammates have it, or kept out of version control?"*

Safer defaults: the generated folder **outside** anything served; the tool folder
**committed**, so a build elsewhere is reproducible.

## ASK 2 — Which role, and where does it come from?

`build` writes one registry per role this app declares. Mounting means choosing one at
page-load time, and there is no generic way to know how *this* app tracks who is signed
in.

Ask: *"The assistant needs the current user's role when the page loads. Does this app
expose that from an auth context, a session hook, or something similar — and if so, where?
If not, I can hardcode one role so you can see it working, but every visitor would get
that role's screens until it's wired to real auth."*

If you hardcode a role to get a first look working, **say so explicitly**. Do not let it
read as finished integration.

## ASK 3 — Should you edit the page for the developer?

`doctor` prints one `<script>` line to add. Adding it is a small change, and it is still
an edit to a file you did not write, in a project you were just handed.

Ask: *"I can add the line doctor printed directly into `<file>`, or just show it to you to
place yourself. Which do you want?"*

If they say go ahead, make exactly that edit — nothing else nearby — and show them the
diff afterwards.

## ASK 4 — Should the generated output be gitignored?

The generated folder is build output, not source. Left untracked with no `.gitignore`
entry, a routine `git add -A` later can commit a stale registry — or worse,
`review/master.json` — as if it were part of the app.

Ask: *"Want me to add these generated paths to .gitignore?"* The sane default is yes, but
ask anyway: some teams commit generated bundles on purpose, to review registry changes in
a pull request, and that choice is theirs.

## ASK 5 — Wire real navigation, or accept full-page reloads?

Without a `navigate` callback, every move the assistant makes is a full page reload. That
is correct, just slower — and wiring it requires knowing this app's router API.

Ask: *"Want me to wire navigation to this app's router so moving around doesn't reload the
page? I'll need to know how a component here gets hold of a navigate function — a hook, a
prop, a global, or something else."*

## ASK 6 — Does this app already have something in a screen corner?

The assistant mounts itself as a fixed corner element. If the app already has a support
widget, a dock, or a floating action button there, the two will stack.

Ask: *"Does this app already have UI living in a screen corner I should know about? If so,
I can place the assistant somewhere that won't collide, instead of the default corner."*

## ASK 7 — Description quality, and calibration

Two separate questions that both affect how well it works.

**Descriptions.** `--no-model` derives them from the app's own labels: free, and always
available. `--model <name>`, through a local Ollama, writes richer ones and costs build
time. Ask which they want rather than choosing for them — and note that richer is not
automatically better: measured on a real application, model-written example phrasings
routed *worse* than derived ones (`FIELD-NOTES.md` §4).

**Calibration.** An uncalibrated build uses thresholds tuned on a small reference app.
`doctor` states the measured error rate for an app this size in plain words; read that to
the developer rather than letting silence imply it is fine to ship.

Ask: *"Do you have real questions users might actually ask — even 20 or 30, written down
with the screen each should reach — that I could calibrate against? Or should we ship
uncalibrated for now and revisit once you have some?"*

There is deliberately **no** option to calibrate from the tool's own example questions.
Measured on a real application, that made routing worse, not better.

---

## Serving it

Two rules, and the first one is a security property rather than a preference.

1. **Each signed-in user gets only their own role's `registry.<ROLE>.json` and
   `index.<ROLE>.json`.** A role's registry *is* its entitlement — a screen that role
   cannot reach is absent from what it receives, not hidden in it. The role comes from
   their session, never from the request.
2. **Never serve `review/`,** in any environment, for any reason.

`nextgen.js` and `thresholds.hashing.json` go to everyone. The script tag uses no inline
script or style, so a strict Content-Security-Policy is fine.

## What you should never do without asking first

- **Edit anything under the application's own source.** This tool never needs to. If a
  step seems to require it, stop and say so rather than finding a way to make it work.
  (It proves this about itself: the target tree is fingerprinted before and after a run.)
- Serve `review/`, in any environment, for any reason.
- Treat a `GUESSED` line in `doctor`'s output as close enough without checking.
- Run `calibrate` on anything other than questions the developer actually wrote and can
  stand behind.
- Present an uncalibrated build, or one with unresolved `GUESSED` lines, as finished.

## What to tell them to expect

- **It offers; it rarely decides.** Most of the time it shows up to three screens and the
  person picks. That is a click more than a perfect guess, and it has sent nobody to a
  wrong place.
- **It does not decline everything it should.** Roughly half of out-of-scope requests are
  declined; the rest become clarifying questions. None are executed. `FIELD-NOTES.md` §5
  explains why, and what to do about it.
- **It performs no actions.** It moves between screens and shows links. It does not save,
  send or delete anything.
- **Every screen it can reach stays reachable without it.** That one is not negotiable.
