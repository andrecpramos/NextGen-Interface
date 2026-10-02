# Read this before you run anything else in this folder

You are an AI coding agent installing **NextGen Interface** — an AI navigation assistant —
into someone else's application, on their behalf. Someone copied this folder into their
repository and gave you its path. Everything needed is here: no package to install, no
registry to reach, no account, no network.

Tell the developer two things before anything else:

1. **No model is used unless they turn on stage 3 (ASK 8).** Without it the assistant matches
   questions against what the app declares, in the browser, and answers from fixed wording.
   Owners who expect a generative assistant are otherwise disappointed by its first answer. If
   the app already has a model-backed assistant of its own, ASK 6 merges it in.
2. **They can make it better for their own app, in six numbered steps** ("Make it smarter, or
   more careful — step by step", below). The first build is a starting point, not the ceiling;
   `doctor` shows which step is next.

**The one rule this file asks of you:** each section marked `ASK` is a decision that belongs to
the developer, not to you. Put it to them in your own words, wait for an actual answer, and only
then act on it — even if you are confident you know what they will say. Each has a suggested
default so you have something concrete to propose, not so you can skip asking. Say what you are
about to do before you do it.

This exists because, in a real field test, an agent ran every step unattended, including edits
to the app's own `index.html` and `.gitignore`. Each step was defensible, and the developer still
came out of it feeling like a bystander in their own project.

---

## What is in this folder

| | |
|---|---|
| `AGENTS.md` | this file |
| `FIELD-NOTES.md` | **what goes wrong when this tool meets a real application.** Eight sections, every one a failure that actually happened. Read it before you believe any output below |
| `scan.mjs` | the whole tool, in one file. Node 20 or newer, no dependencies |
| `runtime/nextgen.js` | the assistant itself, already compiled, ready to serve |
| `VERSION` | an id of the two files above. `doctor` prints it on its first line — quote it when you report a problem, so it is clear which build was copied |

## The commands

Run them from the application's root. `<here>` is this folder. Each one prints the next, written to
run from where you are; `doctor` ends with a numbered "Next steps" list for the build's state.

```bash
node <here>/scan.mjs init    .           # read the app, write nextgen/nextgen.config.json
node <here>/scan.mjs build   nextgen     # write nextgen/bundle/ and nextgen/review/
node <here>/scan.mjs doctor  nextgen     # what it read, what it guessed, what to fix
node <here>/scan.mjs preview nextgen     # a local page to ask questions as each role, before wiring anything
node <here>/scan.mjs calibrate nextgen --golden questions.jsonl   # see ASK 7
node <here>/scan.mjs teach nextgen --from lessons.jsonl           # later: what real visitors taught it
```

`preview` serves every role's files at once so the developer can compare them. It binds to this machine
only, and it is never how the bundle is served for real (see "Serving it").

**One step is not a command: ASK 9, an interview,** run after the first `build` and before
calibration. Only the developer knows what each screen is for and how their users talk. `build`
writes `nextgen/review/KNOWLEDGE-GAPS.md`, the questions to ask them, and `doctor` says how much
of the app is covered.

### This tool does not reach the network — the widget it builds may, if you turn that on

Keep the two apart when you talk to the developer:

- **`scan.mjs`, on this machine: never — not "by default", at all.** There is no `--model` in
  this folder and no client for one in the bundle; `build --model` is refused with a reason. This
  is checked, not claimed: the whole pipeline is run on every commit with `fetch`, `net`, `tls`,
  `http`, `https` and DNS all throwing, and it completes. Do not offer to "enable the model" for
  writing descriptions. There is nothing to enable, and it would not help: on a real application,
  model-written example phrasings routed *worse* than ones derived from the app's own labels,
  because those repeat the screen's own words (`FIELD-NOTES.md` §4).
- **`runtime/nextgen.js`, in a visitor's browser, later: only if ASK 8 says so.** Then it may POST
  a turn it cannot settle to a path on the developer's **own** origin. It is off unless
  `build --stage3 <path>` is run.

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

**Does the screen count look like the app?** Compare `doctor`'s number with the app's own route
table. If it is far lower, or **0 with dozens "left out"**, the likeliest cause is a monorepo: the
route table imports its pages and its role sets from sibling packages (`@acme/core/permissions`,
`@acme/engine/…`). The scanner follows a bare import into a package the workspace declares — but it
finds the workspace by walking *up* from the folder you gave it, so:

- point `init` at the app inside the **full repository**, never at a copy of the app folder alone;
- if `doctor` says "no permissions module" and the app has one in another package, set
  `permissionsFile`, `roleSetExport` and `allRolesExport` in `nextgen.config.json` (the path may begin
  `../../packages/…`);
- a route table that ends in a **computed** spread (`...plugins.flatMap(p => p.routes)`) cannot be read
  statically. It is listed in `review/SKIPPED.md` with the expression quoted — tell the developer those
  screens are not covered, and do not present the count as the whole app.

`FIELD-NOTES.md` §1 has the detail.

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

**Also ask, in the same breath — can this app do anything with a file a visitor attaches?** The box
can offer a paperclip, and a camera on a phone, but **only if the script tag says
`data-nextgen-attach="on"`**; without it there is no button. What a visitor attaches
**never leaves their device**: the assistant does not read it, send it, or give it to a model — this
tool is used on apps whose files are medical. It is handed to the *page*, as a cancelable
`nextgen:attach` event carrying `{ files, utterance, route }`. So:

- If the app has somewhere for a file to go (an upload form, a claims inbox, a profile photo), offer to add
  `data-nextgen-attach="on"` and wire that listener, next to the navigation one. Mention that the page must
  validate what it is given: a file's name and type are the visitor's, and the widget's checks (type, 15 MB,
  four files) are a courtesy.
- If it does not, leave the attribute out. That is the default, and the honest one for most apps: a button
  that goes nowhere is a dead end. (`data-nextgen-attach="off"` says the same thing explicitly.)
- If the app has an assistant of its own that can read a file (ASK 6), the files go to it instead, and the
  paperclip turns on by itself.

Tell the developer plainly which they have. Do not wire an upload endpoint on your own initiative.

## ASK 6 — Does this app already have an assistant, a tour, or something in a screen corner?

The assistant is an orb in a bottom corner that opens a chat panel there. Three things collide with it,
and the developer knows about all three:

- **Something already in the corner** — a floating action button, a dock, the account menu at the foot of a
  sidebar. Move the orb clear of it with `data-nextgen-inset="20,144"` (x,y pixels from the corner) or
  `inset: { x, y }`, and pick the side with `data-nextgen-position`. *Look* at the running app before
  choosing: one integration chose from reading code and covered the account menu.
- **An assistant of its own** — a model-backed chat. Do not ship two assistants with two entry points. The
  orb becomes the one entry point, and theirs is merged in (`companion`): what this assistant cannot
  place — a question about the app's data, one that matches no screen — and anything attached goes to theirs,
  and its answer appears in the same conversation under its own name; a button in the panel opens theirs
  whole, with its history and everything else it has; its own launcher is hidden while this one runs.
  - **What theirs can *do*, give it first** (`companion.handOver(text, { route })`). The orb never
    acts: asked to cancel, move, pay or delete, it answers "I can't do that for you" and points at the
    screen. If their assistant can prepare that change for this user, write a rule that claims
    it (for example `/\b(cancel|move|reschedule)\b/i`, only for roles whose tools can do it), plus
    questions of fact ("how many…", "who scored…"). A claimed question goes straight to theirs, with no
    routing and no model call of ours. Keep the rule cheap and synchronous: it runs on every question. Test
    it: in the first integration, rules held, while asking the model to choose flipped from one prompt
    wording to the next.
  - **When theirs opens a panel, a confirmation card or a form**, call the handle's `stepAside()`, and
    `comeBack()` when it closes. The orb and its panel hide and return as they were. In the first
    integration the orb's panel covered their composer's microphone and send button.
  - Each question handed to theirs is announced as `nextgen:companion`
    `{ utterance, handedOverBy: 'rule' | 'unplaced', latencyMs, answered }`, for their logs and tests.
    `nextgen:turn` covers only what the orb routed.
- **A guided tour** — "tutorial" or "visita guiada" said to the assistant starts it (`companion.tour`), and its
  prompt can be hidden the same way. **Several tours** (a role tour, a "what's new" tour): list them with
  `companion.tours(route)` → `[{ id, title, note? }]`, and the panel's **Tutorials** option shows them to pick
  from; the pick comes back as `tour(route, id)`. The panel then has two tabs, **Chat** and
  **Tutorials**; call the handle's `refresh()` whenever the app changes page with its own
  router or a tour's progress changes, so the Tutorials view follows. The app's own tour menu can then go.

Ask: *"Does this app already have UI in a screen corner, its own assistant, or a guided tour? I can place the
orb clear of the corner, and merge the assistant and the tour into it so visitors have one place to ask —
nothing either one does is lost."* Wiring a companion is a code change in the app (see "A single-page app
with token auth" below); say so, and wait for a yes.

## ASK 7 — Calibration

Descriptions are not a question here: they come from the app's own labels (see "This tool does
not reach the network", above). **Calibration is.** An uncalibrated build uses thresholds tuned
on a small reference app.
`doctor` states the measured error rate for an app this size in plain words; read that to
the developer rather than letting silence imply it is fine to ship.

Ask: *"Do you have real questions users might actually ask — even 20 or 30, written down
with the screen each should reach — that I could calibrate against? Or should we ship
uncalibrated for now and revisit once you have some?"*

There is deliberately **no** option to calibrate from the tool's own example questions.
Measured on a real application, that made routing worse, not better.

**A calibration made before 2026-09-23 is out of date.** The way a question is scored changed then
(each screen is now compared with all of it *and* with its closest example), and thresholds swept
under the old score no longer fit. If `nextgen/calibration.json` exists, run `calibrate` again with
the same questions.

## ASK 8 — Turn on model-backed answers?

Today, a question the router cannot settle from the registry alone gets a clarifying
question back — never a wrong answer, but it can feel like a menu rather than an
assistant. `build --stage3 <path>` changes that: an unsettled turn instead POSTs to
`<path>` on the developer's **own origin**, and their server decides which model answers.

This is opt-in, off unless that flag is passed, and it is not a decision to make for them:

- **It sends visitor text to their own server.** Not to us, not to a third party they did
  not choose — but it is still a new data flow on their site, and their privacy notice may
  need to say so.
- **It needs a server they run, secure and rate-limit.** An unauthenticated endpoint that
  calls a model is something anyone loading the page can spend money or GPU time against.
  A reference proxy with basic rate limiting is in "Turn on model-backed answers" below —
  offer to wire it, do not silently assume they want it running unlimited.
- **It cannot leave their origin — by construction, not by promise.** The transport resolves
  the path against the page it runs on and refuses to POST anywhere else; this tool's own
  repository checks that on every commit. What the developer can verify here: build with
  `--stage3`, open the browser's network panel, and see the only POST go to their own origin.

**Recommend it when the developer can run a model**: one on their own GPU or a hosted one,
behind their own server. Measured on the reference
fixture with qwen3:14b: the right screen for 92.7% of questions with it against 81.8%
without, at about 0.9 s for a turn that needs it. Most turns never need it: they settle in
the browser first. Without a model to run, the default is fine. Say so, and don't press.

What it does not do, whatever the model says: it never moves the visitor for a request to
change something. "Cancel tomorrow's session" is answered with where that is done,
not by opening the screen as if it were done.

Ask: *"Right now, a question the assistant can't place gets a quick question back instead of
a guess. That's safe, but a bit more like a menu than an assistant. If you can run a model
(on your own machine or a hosted one), I recommend wiring it through a small server on your
own site: it answers more of what people actually ask, in about a second. That means visitor
text reaching your server and a model you run or pay for. Want that now? It's a
`build --stage3` flag either way, so it's easy to turn on later."*

If they say yes, ASK where the proxy should live and whether they want the reference
implementation (Express, with rate limiting) or already have their own preference.

## ASK 9 — What does this app know that the scanner cannot? (the interview)

This is the single biggest lever on whether the assistant feels intelligent, and the only
one that costs the developer a conversation instead of a flag. Read from source alone, every
screen is a title and a template sentence ("*Estado Médico is a screen in the guardian area of
this application*"), and the matcher only recognises words that appear in the registry, so "my
son got hurt in training" never reaches the medical screen. On the reference app, writing down
what a developer knows lifted the right screen to first place in 9 of 10 everyday questions
(from 6), with no screen opened wrongly. That knowledge was written by this tool's author, on a
fixture; a real developer's answers are the real test.

**Run this after the first `build` and before calibration (ASK 7).** Open
`nextgen/review/KNOWLEDGE-GAPS.md`: `build` wrote it, and it lists what the tool does not
know as questions, screen by screen. It is your script. Then have an actual conversation,
in **open questions** — ones a developer has to answer in their own words. A yes/no ("is
this the medical screen?") teaches you nothing you could not read from the route, and it
puts your guess in their mouth:

- **The app.** *"In two sentences, what is this app for and who uses it?"*
- **Each screen, starting with the five that matter most.** Name the route and the title so
  they know which one you mean, then: *"What is this screen for? What is on it? What would a
  user say to get here?"* You may offer a draft made from reading the page's source, but
  the developer confirms or corrects every word.
- **Their words.** *"Which words do your users say that never appear on a screen?"* — the
  child a guardian calls "o meu filho", the report they call "a ficha". Each goes in
  `glossary` with what people say instead.
- **What it cannot do.** *"What do users ask for that this app cannot do — and what should
  the assistant say when they do?"* — payments, contacting a person, changing a record. At
  least three ways people ask, for each; a limit it cannot recognise protects nobody.
  - Then, for each: *"Is there a screen where they can do it themselves, or get help with it?"*
    The assistant never performs the task, but it can end its "I can't do that for you" with a link
    there instead of a dead end. Up to two routes go in that limit's `instead`, exactly as the route
    table writes them (`"/billing"`). Each role is only ever offered the ones it can open; a route
    that is no screen of the app is listed in `KNOWLEDGE-GAPS.md`. If there is none, leave it out.
- **How the app works.** *"How does this app work that a newcomer would not guess? What does
  someone need to know, or have done, before they can find or do things — and where do users
  usually go wrong?"* Each answer becomes one short statement in `rules`: *"Medical status is
  per child, so if a guardian has more than one it matters which."* Write statements **about
  the app**, never instructions to the assistant.
  - These are what the model stage reads to reason and to explain. **Without stage 3 (ASK 8)
    they change nothing a visitor sees**, so say that before spending the developer's time on
    many. They are worth having anyway: they are the app's reasoning written down, and stage 3
    can be turned on later.
  - **A rule is told to every role unless you give it `roles`.** Ask of each one: *"is this
    something every kind of user may be told?"* A rule about a feature only administrators have,
    written without `roles`, is put in a guardian's registry, and a role must not learn another
    role's features. `"roles": ["ADMIN"]` keeps it out of everyone else's file entirely.
- **What only they know.** *"Which three screens do your users most often fail to find? Is
  there something about how they talk, or what they get wrong, I should know?"*
- **What starts a task on each screen.** *"On this screen, which buttons only open a form, a dialog
  or a panel — and do nothing else until the user saves?"* ("Novo evento", "New event", "Filtros").
  Each goes in that screen's `opens`, **as the button reads, in every language the app shows**. A
  visitor who says *"quero marcar um evento"* is then taken there **with that form already open**.
  **Never list a button that saves, sends, pays, or creates a record the moment it is pressed**: ask
  about each one. When unsure, leave it out. The assistant then points at the button and lets the
  visitor press it, which is still a help.

Write what they say into `nextgen/knowledge.json`, beside `nextgen.config.json`. The shape
is at the end of `KNOWLEDGE-GAPS.md`. Run `build` again, then `doctor` and read the coverage
line to them. The file is theirs: it belongs in their repository, and adding a real user's
question to it later is how the assistant improves.

**How to write the phrases** (`askedAs`), from a field measurement that went the other way
(`FIELD-NOTES.md` §4: model-written examples routed *worse* until this was corrected):

- **Requests, not statements.** "*quero ver o estado médico*", not "*o estado médico é importante*".
- **In the language most of their users write**, not split evenly across two. Some in a
  second language is fine; half is not.
- **Only what the screen actually does.** A phrase for something the screen does not do
  sends people to the wrong place with confidence. Do not stretch a screen to cover a
  neighbour.
- **Aim for five or more per screen.** Real questions beat elegant ones: if you can, ask
  the developer to paste a few from a support inbox instead of composing them.

**Then try to break your limits.** A declared limit refuses anything it beats, so a word it
shares with a screen the app *can* do will refuse a real question. It happened in the first
honest test of this: a "payments" limit whose phrases included *mensalidade* refused "*tenho
alguma mensagem nova?*", because the offline matcher works on fragments of words and *mensagem*
and *mensalidade* share "mens". Refusing a real request is the expensive error. So after the
second `build`, for each limit, write three ordinary questions about things the app can
already do that have words in common with it (whole words, or a stem), ask them (the preview
bench, or the widget), and check none is refused. If one is, change the limit's phrases to
words only that limit uses. Do not raise a threshold: that is not what is wrong.

**Never invent an answer.** A screen's `purpose` is served to visitors as fact, in the
app's own voice, and a wrong one is worse than none. If the developer does not know, leave
it out: it stays a gap, and `doctor` keeps saying so.

**Never reuse the same phrases in the calibration set (ASK 7).** Calibrating on the
sentences you put in the registry measures memory, not understanding, and will look
wonderful. Ask for a separate 20 or 30 questions.

## ASK 10 — Is there anything you want to ask me?

Before you call it done, hand the conversation back. The developer has been answering your
questions for a while; they almost certainly have some of their own, and the ones they do
not think to ask are the ones that surprise them later.

Ask: *"Is there anything you'd like to ask about how this works — what it can and can't do,
what happens to your users' questions, what it sends where, what it will look like on your
pages, or what to do when it gets one wrong?"*

Answer from what is written in this folder (`AGENTS.md`, `FIELD-NOTES.md`, what `doctor`
printed) and from what you have watched happen in this run. **If you do not know, say so** —
do not guess, and do not reassure. "I don't know; that is worth asking the owner of this
tool" is a good answer; a confident wrong one about privacy, cost or accuracy is not. Write
anything left open into a short note in the developer's own repository, so it is not lost
when this conversation ends.

---

## Serving it

Two rules, and the first one is a security property rather than a preference.

1. **Each signed-in user gets only their own role's `registry.<ROLE>.json` and
   `index.<ROLE>.json`.** A role's registry *is* its entitlement — a screen that role
   cannot reach is absent from what it receives, not hidden in it. **The role comes from
   their session, never from the request**: a role in a query string or a header is a role
   the visitor chooses. A user who holds several roles is served each of their roles' files,
   and the script tag names them all: `data-nextgen-role="COACH PARENT"`.
2. **Never serve `review/`,** in any environment, for any reason.

`nextgen.js` and `thresholds.hashing.json` go to everyone. The script tag uses no inline script or style, so a strict Content-Security-Policy is fine.

**What it refuses, whatever it is given** (so a mistake in a file or an option cannot become a hole in
the app):

- **It moves only to paths on this site.** A route must start with one `/`: `javascript:…`, `//host`,
  `/\host` and full URLs are never followed or linked. A hash-router app (`#/players`) is not supported
  yet. Say so to the developer, rather than rewriting routes to get round it.
- **It loads its files only from this site.** `data-nextgen-base` on another origin, such as a CDN, is
  refused and nothing is fetched. To serve from another host, the developer calls `NextGen.load()` with
  their own `fetch`, and with it takes that decision knowingly.
- **`companion.hide` takes plain selectors.** No `{ } ; @ <`, no comments, no backslash escapes, at most
  200 characters. A refused selector hides nothing; use an id, class or attribute instead.
- **A question is at most 500 characters.**

It is also light at rest. The orb is drawn at the size it is shown and goes still after 12 s idle.
Nothing animates while the panel is closed, and the start-up work waits until the browser is idle.

**Express**, after the app's own session middleware:

```js
import path from 'node:path';

const BUNDLE = path.resolve('nextgen/bundle');
const SHARED = new Set(['nextgen.js', 'thresholds.hashing.json']);

app.get('/nextgen/:file', (req, res) => {
  const roles = req.user?.roles ?? (req.user?.role ? [req.user.role] : []); // from their session
  const { file } = req.params;
  const own = roles.some((role) => file === `registry.${role}.json` || file === `index.${role}.json`);
  if (!SHARED.has(file) && !own) return res.sendStatus(404);
  res.sendFile(file, { root: BUNDLE });
});
```

**Next.js** (app router), as `app/nextgen/[file]/route.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { currentRole } from '@/lib/auth'; // theirs

const BUNDLE = path.join(process.cwd(), 'nextgen', 'bundle');
const SHARED = new Set(['nextgen.js', 'thresholds.hashing.json']);

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const role = await currentRole();
  const own = role !== null && (file === `registry.${role}.json` || file === `index.${role}.json`);
  if (!SHARED.has(file) && !own) return new Response(null, { status: 404 });
  const type = file.endsWith('.js') ? 'text/javascript' : 'application/json';
  return new Response(await readFile(path.join(BUNDLE, file)), { headers: { 'content-type': type } });
}
```

Note what both do with a file that is not the caller's: **404, not 403.** A 403 confirms
the screen exists.

**Restart the server after adding the endpoint, and tell the developer to.** A server started
before the route existed answers 404, and the assistant does not start. It will not be
silent about it — the console says `[NextGen] the assistant did not start: … (404)` and the
window receives a `nextgen:error` event — but the developer has to know to look.

### A single-page app with token auth

The script tag assumes the server writes the role into the page. A static single-page app
with a Bearer token in memory cannot: there is no server-rendered HTML, and the widget's own
`fetch` carries no `Authorization` header. **This path needs a small code change in the app —
say so before you start.** Load `runtime/nextgen.js` without `data-nextgen-role` (so it does
not start itself), then start it from the app's code once the user is signed in:

```js
const assistant = await window.NextGen.start('/api/assistant/navigation-bundle', role, {
  fetch: (url) => fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } }),
  navigate: (route) => router.navigate(route),   // the app's own router: no page reloads
  home: ['/dashboard'],                           // where the panel opens by itself; never a public '/'
  decide: 'balanced',                             // or 'confirm' / 'eager' — "Make it smarter, or more careful"
  act: 'open',                                    // or 'point' / 'off' — opening the form a visitor asked for
  search: '/search?q={query}',                    // only if the app has a search page
  onLearn: (lesson) => lessonsLog.push(lesson),   // what visitors taught it, for `scan.mjs teach`
  inset: { x: 20, y: 144 },                       // clear of the app's own corner UI (ASK 6)
  // lang: 'pt-PT',   // leave it out: <html lang> is followed, live. Set it only if the app's <html lang> is wrong
  // Only when the developer said yes in ASK 6:
  companion: {
    name: 'Club assistant',
    ask: ({ text, files, route }) => theirAssistant.answer(text, files, route), // plain text, or null
    open: () => theirAssistant.open(),
    tour: (route, id) => theirTour.start(route, id),              // id: the one picked from tours
    tours: (route) => theirTour.listFor(route),                    // [{ id, title, note? }] — the Tutorials option
    hide: ['#their-chat-launcher'],
  },
});
```

The handle it resolves to is the whole API:

| | |
|---|---|
| `open()` / `open({ expanded: true })` | open the corner panel, or the full screen. Bind it to the app's own launcher, its command palette, or a keyboard shortcut |
| `close()` | close it |
| `ask(text)` | ask programmatically; resolves to what was shown |
| `setLanguage(tag)` | the app switched language without changing `<html lang>`: follow it (`'en'`, `'pt-PT'`) |
| `refresh()` | the app changed page with its own router, or its tours changed: the Tutorials view reads them again |
| `destroy()` | remove it — **call this on sign-out** |
| `host` | the element it lives in |

`start()` rejects with a `StartError` (`reason`: `bundle-unavailable`, `bundle-invalid` or
`mount-failed`) and also announces it as `nextgen:error` on the window. **Never swallow it**
with an empty `catch`: log it in development at least. One integration's `.catch(() => {})`
turned a 404 into an hour of "there is no orb".

**A user with several roles** (a coach who is also a parent): pass them all —
`start(base, ['COACH', 'PARENT'])`, or `data-nextgen-role="COACH PARENT"` — and serve each of
their roles' `registry.<ROLE>.json`. The widget merges them and computes the index for the merged
registry itself. Do **not** merge them on the server by concatenating registries and indexes:
each role's index is its own vector space, and a concatenated one routes confidently to the wrong
screens. A phrase two roles' screens both claim ("nutrição") names neither; the assistant asks.

**Types.** `runtime/nextgen.d.ts` types `window.NextGen`, the options above, the handle, and the
`nextgen:error`, `nextgen:learn`, `nextgen:turn`, `nextgen:navigate` and `nextgen:attach` events. Copy it beside the
app's code if it uses TypeScript.

## What it does on the page

This holds however it is started, script tag or `start()`.

**One language on screen.** The visitor reads the page's language only — the assistant's words and the
app's screen names and descriptions alike. For that, list **every** language the app ships in
`nextgen.config.json` (`"languages": ["pt-PT", "en"]`, the main one first): the registry is written in the
first and carries the others. A page in a language not listed gets English if it is listed, otherwise
the first.

**It uses the app as a user would.** Asked to *start* something — *"I want to schedule an
event"*, *"quero adicionar um jogador"* — it goes to the right screen, finds the control that starts
it by what the page shows (its accessible name, like a screen reader does), and:

- **opens it** when the control can only open something: a link on this site, a tab, a control
  that says it opens something (`aria-haspopup`, `aria-expanded`, `aria-controls`), or one listed in
  the screen's `opens`. The scan reads these from the page's source: React
  `onClick={() => setOpen(true)}` or a `DialogTrigger`; Vue `@click="open = true"`; Svelte
  `on:click={() => (open = true)}`; Angular `(click)="openDialog()"`. You can also list them in
  `knowledge.json`, for anything the scan cannot read;
- **points at it** otherwise, with a ring and *"Tap «New event» to start"*. A plain button might
  create a record the moment it is pressed, so that press stays the visitor's;
- **never** presses anything that saves, sends, pays, deletes or signs out, never touches a control
  inside a form, never types, and does nothing when two controls are equally likely.

It finds the control from the visitor's words, the screen's name in each of the app's languages
(so English words find a Portuguese "Novo anúncio"), and the glossary's everyday words. Each opener's
label also teaches the router the task: "Novo anúncio" makes "quero criar um anúncio" land on that
screen. Run `calibrate` again after a build that found new openers.

It works on any app, whatever it is built with, because it reads the rendered page. It works best
when the app's buttons have real names (visible text or `aria-label`) and its dialog buttons say
they open something, which accessible UI libraries (Radix, shadcn, Headless UI, MUI's menus) already
do. `act: 'point'` makes it only point; `act: 'off'` turns it off.

**Why it did that — for you, not the visitor.** Answers show no mechanics. Each routed turn's record goes
to the page as `nextgen:turn` (`{ trace }`: how it decided, what it weighed, the scores). Log it while you
tune — `window.addEventListener('nextgen:turn', (e) => console.debug(e.detail.trace))` — or build your
own "why" for staff from it. It holds the visitor's own question: do not forward it to analytics or any
third party without the app's privacy terms allowing it.

## Make it smarter, or more careful — step by step

**Tell the developer this plainly: they can make the assistant better for their own app, and each
step below does.** No two apps are alike, so how clever and how careful it is belongs to them, not to
this tool. The steps are in the order that gives the most for the least effort; every one is optional
and can be undone. `doctor` prints them with where the app stands on each (✓ done, → next), and
`build` writes them to `review/IMPROVE.md`.

1. **Tell it what your screens are for.** The biggest single improvement: a screen described in the
   developer's words is found by the words users say, not only by its title. Answer
   `review/KNOWLEDGE-GAPS.md` into `knowledge.json` (ASK 9) — the ten screens that matter most are
   listed first. A screen the scanner could not read (a route decided on the server, a micro-frontend, a
   framework it does not know) goes there too, with a `"title"` and the `"roles"` that can open it, and
   becomes a screen like any other. Then `build`.
2. **Calibrate it on real questions** (ASK 7). Fits how sure it must be before it opens a screen by
   itself: fewer wrong moves, fewer needless questions.
3. **Put it in the app properly.** Navigation wired to the router (ASK 5), `data-nextgen-home` set to where
   signed-in users land, the orb clear of the app's own buttons (`data-nextgen-inset`, ASK 6).
4. **Let real use teach it.** Keep the `nextgen:learn` events (or `onLearn`) as one JSON object per line;
   `scan.mjs teach nextgen --from lessons.jsonl`, read `review/TAUGHT.md`, then `--write`, then `build`.
   Every question it could not settle, and the screen the visitor then picked, becomes a phrase it knows.
5. **Choose how bold it is, and where the rest goes.** `data-nextgen-decide`: `confirm` never moves
   without a yes, `balanced` (default) moves when sure and asks one question when not, `eager` also moves
   when one screen is plainly ahead. `data-nextgen-search="/search?q={query}"` sends what no screen matches
   to the app's own search. An assistant or a tour the app already has is merged in as a `companion` (ASK 6).
6. **Add a model, if it is worth it** (ASK 8, "Turn on model-backed answers" below). Optional: it settles
   what the steps above cannot, at the cost of a server the developer runs and pays for.

What to tell the developer honestly: **steps 1 and 4 do more than a model does**, and cost nothing per
question. A model helps most on an app whose questions are open-ended; it cannot make up for screens
nobody described.

## Where it fits, and where it does not

It is a guide to an app's **screens**: "where do I…", "take me to…", "what is this page for".
Measure a candidate app against what it needs:

- **Fits well:** a line-of-business app — a club, a clinic, a school, an ERP, an admin panel, a SaaS
  dashboard — with roles, routes declared in code, and users who do not know where things are. Size is
  not the limit: measured, a 2,000-screen registry indexes in under half a second, ships a 7 MB index
  (before compression) and answers in about 3 ms. Screens about one item (`/players/:id`) are reached
  through the list they are chosen from, and two screens with one name are told apart by their area.
- **Fits with help:** an app whose navigation is not a `<nav>` (`navigation` selector); a single-page
  app with token auth ("A single-page app with token auth"); screens the scanner cannot read — routes
  decided on the server, micro-frontends, frameworks it does not know — declared in `knowledge.json`
  (step 1 above). The assistant speaks English (the default) and Portuguese only: an app in another
  language gets an English interface around its own screen names.
- **Does not fit on its own:** an app whose content *is* the product — a social network, a marketplace,
  a news site. There, most questions are about people, posts and products ("Ana's photos from Porto"),
  which no screen answers: route them to the app's search (`search`) and its own assistant
  (`companion`), and keep this for the settings, help and account screens. Apps where the same screen
  shows different things to each user are also beyond what the scanner reads.

Say which of the three this app is before the developer invests in it.

## Turn on model-backed answers

Only if the developer said yes to ASK 8. Two steps: run a proxy, then rebuild pointing at
it. The order matters — `build` records the path as it starts to serve `bundle/`, but the
proxy itself can go live anytime before real traffic reaches it.

**1. Run a proxy.** It receives `{ system, prompt, schema, model, think }` as JSON and must answer
with JSON matching `schema` — nothing more. `think: false` means "don't reason first": pass it to
the model (Ollama's `think`). A reasoning model (qwen3, deepseek-r1) that ignores it spends its
token budget reasoning, and its answer is cut off before the JSON closes. Pass `schema` as it
is: it asks only for the fields this turn reads, and the proxy should not add any. It decides which model to call and how; this
tool never assumes a provider. The reference below is Express, with rate limiting, because
an unauthenticated endpoint that calls a model is something anyone loading the page can
spend money or GPU time against:

```js
import path from 'node:path';

// A token bucket per IP, refilling over a minute. Replace with whatever this app already
// uses for rate limiting if it has one — the point is that SOME limit exists before this
// goes live, not that it is this exact one.
const buckets = new Map();
const LIMIT = 20;
const WINDOW_MS = 60_000;

function allowed(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { count: 0, resetAt: now + WINDOW_MS };
  if (now > bucket.resetAt) Object.assign(bucket, { count: 0, resetAt: now + WINDOW_MS });
  bucket.count += 1;
  buckets.set(ip, bucket);
  return bucket.count <= LIMIT;
}

app.post('/nextgen/stage3', express.json({ limit: '32kb' }), async (req, res) => {
  if (!allowed(req.ip)) return res.status(429).json({ error: 'rate limited' });

  const { system, prompt, schema, model, think } = req.body ?? {};
  if (typeof system !== 'string' || typeof prompt !== 'string' || !schema) {
    return res.status(400).json({ error: 'malformed request' });
  }

  // Call whatever model this app's developer chose. This is the one line that is theirs
  // to fill in — the shape of the call depends entirely on the provider.
  const answer = await callTheirModel({ system, prompt, schema, model, think });

  res.json(answer); // must match `schema` — nothing wrapping it, no envelope
});
```

**2. Rebuild pointing at it:**

```bash
node <adapter folder>/scan.mjs build nextgen --stage3 /nextgen/stage3
```

`doctor` will then say plainly that stage 3 is ON and name the path — read that line to the
developer before they ship, every time this flag is used.

**The app signs in with a token, not a cookie?** The widget sends this POST with the page's
`fetch`, which carries cookies and nothing else. A single-page app that keeps a bearer token in
memory passes its own client as `stage3Fetch` to `start()`, and the proxy then requires a
signed-in user, as the rest of the app's API does. A signed-in app should do this rather than rely
on the per-IP limit above. `stage3Fetch` gets the URL and a full `RequestInit`, and must pass on
all of it:
`stage3Fetch: (url, init) => api.fetch(url, { ...init, headers: { ...init.headers, Authorization: \`Bearer ${token}\` } })`.
The widget checks that the URL is on this site before it calls this. Don't reuse `fetch` for
this: that option is handed only a URL, so it would turn this POST into a GET.

**The model runs on the developer's own machine?** The widget waits 8 s, then asks the
visitor instead. A busy local GPU can answer correctly in 8–11 s, and that answer is thrown
away. Add `--stage3-timeout 12000` to the build, and have the proxy give up about a second
sooner, so the widget can still ask its own question.

## Turn on voice in every browser

Out of the box the microphone works only where the browser recognises speech **on the device**.
For most languages that is almost nowhere: Brave has the API with nothing behind it, Firefox has
none, and Chrome and Edge send audio to Google or Microsoft unless an on-device pack is installed.
The orb never uses a cloud recogniser: a visitor's voice must not reach a vendor the app has no
agreement with.

`transcribe` changes that. What a visitor says is recorded, sent to **a path on the developer's own
site**, and turned into text by a speech-to-text server they run. A path on another site is
refused. Nothing is sent until the visitor has actually said something.

```js
start('/nextgen', role, { transcribe: { path: '/api/transcribe', fetch: signedFetch } })
// or, on the script tag: data-nextgen-transcribe="/api/transcribe"
```

The endpoint takes an OpenAI-style `/v1/audio/transcriptions` form (`file`, `language`,
`response_format=json`) and answers `{ text }`. So speaches, faster-whisper servers and hosted APIs
all fit behind a few lines of the app's own server. Require a signed-in user and rate-limit it, as
for stage 3: it runs a model on uploaded audio. **Keep no audio.** Say so in the privacy notice.

Settings measured in the first integration (self-hosted Whisper on CPU, a chat model on the GPU):

| Setting | Why |
|---|---|
| `large-v3-turbo`, int8, one thread per physical core: ~3.5 s | 10/10 word-perfect, names included; `small` int8 is ~1.2 s at 9/10 |
| Keep the model loaded and warm it at start | a cold load took 170 s |
| `language` set, `temperature 0`, `vad_filter` on | deterministic, and silence trimmed |
| A prompt with the app's own words, ≤ ~600 characters | names and domain words spelled right; longer prompts can repeat on silence |
| Drop segments with `no_speech_prob > 0.6` and `avg_logprob < −1` | Whisper invents text on noise |
| CPU, not GPU, when a chat model shares the card | otherwise every chat reply slows down |

Ask: *"Voice works today only in browsers that recognise speech on the device, and for
<language> that's almost none. If you run a speech-to-text server on your own site (Whisper, for
instance), I can send what visitors say there, and only there, and voice then works everywhere,
phones included. Want that?"*

## What you should never do without asking first

- **Edit anything under the application's own source.** The tool never needs to (it proves
  this about itself: the target tree is fingerprinted before and after a run). Putting the
  assistant *into* the app does — a script tag (ASK 3), router wiring (ASK 5), and in a
  single-page app with token auth, a few lines of start-up code. Each is a change the
  developer agreed to, shown as a diff; anything beyond that, stop and say so.
- Serve `review/`, in any environment, for any reason.
- Treat a `GUESSED` line in `doctor`'s output as close enough without checking.
- Run `calibrate` on anything other than questions the developer actually wrote and can
  stand behind.
- Present an uncalibrated build, or one with unresolved `GUESSED` lines, as finished.
- Write `knowledge.json` from your own guesses. Every purpose in it is served to visitors as
  fact; it comes from the developer's answers (ASK 9) or it stays a gap.
- Put the same sentences in `knowledge.json` and in the calibration set.
- Run `build --stage3` before the developer has said yes to ASK 8. It sends visitor text
  to a server they have to run and secure; that is theirs to decide, not yours to default.

## What to tell them to expect

- **When it is not sure, it asks one question — never a menu.** "Are you looking for Plantel?"
  when one screen is plainly ahead, "Do you mean Plantel, or Convocatória?" when two are close;
  "yes" or "the second one" answers it. That is one reply more than a perfect guess, and a
  question moves nobody to a wrong place. It does move on its own when it is sure, and sure is
  not always right: on the reference app it now opens no wrong screen, but those questions were
  written by this tool's author, so expect a few on a real app. `decide: 'confirm'` removes even that; `'eager'` trades more of it
  for fewer questions. With stage 3 on (ASK 8), or the app's own assistant merged in (ASK 6), fewer
  turns end in a question back. The better the answers to ASK 9, the fewer questions it has to ask.
- **It moves at once, and is silent unless asked.** A clear request opens the screen straight
  away, with the chat panel still open beside it. Answers are read aloud only once the visitor
  turns the speaker on, or talks to it hands-free.
- **It does not decline everything it should.** On an app whose limits nobody described, about
  half of out-of-scope requests are declined; with limits written down in ASK 9, the reference app
  declines 10 of 14. The rest become clarifying questions, and none are carried out.
  `FIELD-NOTES.md` §5 explains why, and what to do about it.
- **It changes nothing.** It moves between screens, shows links, and may open a form the visitor
  asked to start. It never saves, sends, pays or deletes anything.
- **Every screen it can reach stays reachable without it.** That one is not negotiable.
