/**
 * The text of `AGENT.md`, written by `init` into every kit folder.
 *
 * Lesson this exists to fix: an early field test had an agent run
 * init -> build -> doctor -> mount end to end, unattended, including editing
 * the adopter's index.html and .gitignore. Every step was individually
 * defensible and the result still left the developer feeling like a bystander
 * in their own project. The fix is not "make the kit ask more questions" —
 * the kit is a non-interactive CLI on purpose (WP-25) — it is "tell whichever
 * agent is running the kit which decisions are not its to make silently."
 * That is what this file is. It ships to the adopter, not just to us.
 */
export const AGENT_PLAYBOOK = `# Read this before you run anything else in this folder

You are an AI coding agent installing NextGen Interface — an AI navigation
assistant — into someone else's application, on their behalf. This file exists
because of a lesson learned installing it for real: an agent that quietly runs
every step end to end, including the ones that edit the app's own files, can
leave the developer feeling like a bystander in their own project — even when
every individual step was reasonable. That is a bad trade even when it works.

**The one rule this file asks of you:** each section below marked \`ASK\` is a
decision that belongs to the developer, not to you. Put it to them in your own
words, wait for an actual answer, and only then act on it — even if you are
confident you already know what they will say. A default is suggested for
each one so you have something concrete to propose, not so you can skip
asking.

Everything else here is four commands you can run yourself
(\`nextgen init\`, already run once to produce this folder, then
\`build\`/\`doctor\`/\`calibrate\`) and a couple of files you may write. Say what
you are about to do before you do it. A developer who cannot tell what
happened to their project is exactly the outcome this file exists to prevent.

## Before anything else

Run \`nextgen doctor <this folder>\` and show the developer its **full output**
— don't summarize it away. It states plainly what was found, what was
guessed, whether the assistant is calibrated for this app, and lists
"PROBLEMS" if anything needs fixing before this is safe to ship. A line marked
GUESSED is a reason to double-check with the developer, not to treat as good
enough because it is plausible.

## ASK 1 — Where should this kit folder actually live?

This folder was written where you were told to put it. If that location is
inside whatever directory your dev server serves as static files (a typical
Vite/CRA project root, or anywhere under a \`public/\` folder), then
\`review/master.json\` — every screen this app has, **for every role**,
explicitly marked "never serve" — can become directly fetchable by URL the
moment the dev server starts. This is not hypothetical; it is exactly what
happened the first time this kit was pointed at a real app.

Ask the developer something like: *"This kit folder looks like it's inside
what your dev server serves as static files. I'd recommend moving it to a
sibling folder outside anything served — e.g. \`../nextgen-kit\` instead of
\`<app>/nextgen\` — so \`review/\` can never be reached by URL. Want me to move
it, or do you already serve this app in a way where that's not a risk (a real
backend, not a raw static folder)?"*

If they're unsure, the safer default is to move it outside the served root.

## ASK 2 — Which role, and where does it come from?

\`nextgen build\` writes one registry per role this app already declares.
Mounting the widget means picking one at page-load time
(\`NextGen.start(path, ROLE)\`), and there is no generic way to know how *this*
app tracks who is signed in.

Ask: *"The widget needs the current user's role at mount time. Does this app
expose that from an auth context, a session hook, or something similar — and
if so, where? If not, I can hardcode one role so you can see it working, but
every visitor would get that role's screens until it's wired to real auth."*

If you hardcode a role to get a first look working, say so explicitly. Do not
let it read as finished integration.

## ASK 3 — Should you edit index.html (or the app shell) for the developer?

\`doctor\`'s printed mount instructions are two \`<script>\` lines. Adding them
is a small change, but it is still an edit to a file you did not write, in a
project you were just handed.

Ask: *"I can add the two mount lines doctor printed directly into \`<file>\`,
or just show them to you to place yourself. Which do you want?"*

If they say go ahead, make exactly that edit — nothing else nearby — and show
them the diff afterward.

## ASK 4 — Should the generated output be gitignored?

This kit folder, and whatever gets copied into a public/static folder to serve
it, are build output, not source. Left untracked with no \`.gitignore\` entry,
a routine \`git add -A\` later can commit a stale registry — or worse,
\`review/master.json\` — as if it were part of the app.

Ask: *"Want me to add these generated paths to .gitignore?"* The sane default
is yes, but ask anyway — some teams commit generated bundles on purpose (to
review registry changes in a pull request), and that choice is theirs.

## ASK 5 — Wire real navigation, or accept full-page reloads?

Without passing \`{ navigate: (to) => yourRouter.navigate(to) }\` to
\`NextGen.start\`, every capability the assistant reaches navigates by a full
page reload. That is correct, just slower — and wiring it requires knowing
this specific app's router API.

Ask: *"Want me to wire navigation to this app's router so moving around
doesn't reload the page? I'll need to know how a component here gets hold of
a navigate function — a hook, a prop, a global, or something else."*

## ASK 6 — Does this app already have a floating action or assistant slot?

The default widget mounts itself as a fixed corner box. If the app already
has something living there — a support widget, a dock, a floating action
button — the two will likely stack in the same corner.

Ask: *"Does this app already have UI living in a screen corner I should know
about? If so, I can pass \`{ target: someElement }\` to place the widget
somewhere that won't collide, instead of the default corner."*

## ASK 7 — Build quality and calibration

\`--no-model\` derives descriptions from the app's own labels: free, but
flatter. \`--model <name>\` (via Ollama) writes richer ones and costs build
time — ask which the developer wants rather than picking for them.

Separately: **an uncalibrated build uses thresholds tuned on a small reference
app.** \`doctor\` states the measured error rate for an app this size in plain
words — read that to the developer rather than letting silence imply it is
fine to ship as-is.

Ask: *"Do you have real questions users might actually ask — even 20 or 30,
written down with the screen each should reach — that I could calibrate this
against? Or should we ship uncalibrated for now and revisit once you have
some?"* There is deliberately no option to calibrate from the kit's own
example questions instead — measured, on a real app, that made routing worse,
not better.

## ASK 8 — Turn on model-backed answers?

A question the router cannot settle from the registry alone gets a clarifying
question back today — safe, but it can feel like a menu rather than an
assistant. \`nextgen build --stage3 <path>\` changes that: an unsettled turn
instead POSTs to \`<path>\` on the developer's **own origin**, and their server
decides which model answers. Off unless that flag is passed.

This is a bigger decision than ASK 7's model-for-descriptions choice, and it is
not the same one — that is a build-time-only call this machine makes once;
this is a standing server the developer has to run, secure and rate-limit,
because an unauthenticated endpoint that calls a model is something anyone
loading the page can spend money or GPU time against.

Ask: *"Right now, a question the assistant can't place asks the visitor back
instead of guessing — safe, but it can read like a menu. I can wire it to call
a model through a small server on your own site instead, which answers more of
what people actually ask. That means visitor text reaching your server and a
model you run or pay for — want that, or is the current behaviour fine for
now? It's a build flag either way, easy to turn on later."*

If yes: ask where the proxy should live, and whether they want the reference
Express implementation (with rate limiting — see \`packages/kit/README.md\`
"Turn on model-backed answers") or already have their own.

## What you should never do without asking first

- Edit anything under the app's own source (\`src/\`, or wherever the app's own
  code lives). The kit never needs to. If a step seems to require it, stop and
  say so instead of finding a way to make it work.
- Serve \`review/\`, in any environment, for any reason.
- Treat a GUESSED line in \`doctor\`'s output as close enough without checking.
- Run \`nextgen calibrate\` on anything other than questions the developer
  actually wrote and can stand behind.
- Run \`nextgen build --stage3\` before the developer has said yes to ASK 8. It
  sends visitor text to a server they have to run and secure; that is theirs
  to decide, not yours to default.
`;
