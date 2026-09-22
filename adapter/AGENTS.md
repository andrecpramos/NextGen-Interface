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
```

`preview` serves every role's files at once so the developer can compare them. It binds to this machine
only, and it is never how the bundle is served for real (see "Serving it").

**There is a fifth step, and it is not a command: ASK 9, an interview.** Run it after the
first `build` and before calibration. Read from the source alone, a screen is a title and a
template sentence, so an ordinary question ("my son got hurt in training") does not find
the medical screen. Only the developer knows what each screen is for and how their users
talk. `build` writes `nextgen/review/KNOWLEDGE-GAPS.md` — the questions to ask them — and
`doctor` says how much of the app is covered.

### This tool does not reach the network — the widget it builds may, if you turn that on

Two different things, and it matters which one you mean when you talk to the developer:

**`scan.mjs` — what runs on your machine, right now.** Not "by default" — **at all**.
There is no `--model` in this folder and no client for one in the bundle; `build --model`
is refused with a reason. This is checked rather than claimed: the whole
pipeline is run on every commit with `fetch`, `net`, `tls`, `http`, `https` and DNS all
throwing, and it completes. Do not offer to "enable the model" for *description writing* —
there is nothing to enable.

**`runtime/nextgen.js` — what runs in a visitor's browser, later.** This is a separate
question, ASK 8 below: whether *that* file, once served, may POST a turn it cannot settle
to a path on the developer's **own** origin. Off unless `build --stage3 <path>` is run.
Nothing about `scan.mjs`'s own no-network property changes either way.

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

Tell the developer plainly which they have. Do not wire an upload endpoint on your own initiative.

## ASK 6 — Does this app already have something in a screen corner?

The assistant mounts itself as a fixed corner element. If the app already has a support
widget, a dock, or a floating action button there, the two will stack.

Ask: *"Does this app already have UI living in a screen corner I should know about? If so,
I can place the assistant somewhere that won't collide, instead of the default corner."*

## ASK 7 — Calibration

**Descriptions are not a question here.** This folder derives them from the application's
own labels — `scan.mjs` has no way to call a model at all, see "This tool does not reach
the network" above. That is not a downgrade: measured on a real application, model-written
example phrasings routed *worse* than derived ones, because the derived ones repeat the
screen's own words and that is what the shipped encoder rewards (`FIELD-NOTES.md` §4).

**Calibration is.** An uncalibrated build uses thresholds tuned on a small reference app.
`doctor` states the measured error rate for an app this size in plain words; read that to
the developer rather than letting silence imply it is fine to ship.

Ask: *"Do you have real questions users might actually ask — even 20 or 30, written down
with the screen each should reach — that I could calibrate against? Or should we ship
uncalibrated for now and revisit once you have some?"*

There is deliberately **no** option to calibrate from the tool's own example questions.
Measured on a real application, that made routing worse, not better.

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
- **It never leaves their origin, structurally, not by promise.** The transport resolves
  the configured path against the page it is running on and refuses to POST anywhere else
  — checked on every commit by fetching nothing when the two disagree
  (`tooling/scripts/check-stage3.mjs`). You do not need to trust this claim; you can point
  the developer at the gate that holds it.

Ask: *"Right now, a question the assistant can't place sends the visitor a clarifying
question instead of guessing — which is safe, but can feel more like a menu than an
assistant. I can wire it to call a model through a small server on your own site instead,
which answers more of what people actually ask. That means visitor text reaching your
server and a model you run or pay for — want that, or is the current behaviour fine for
now? It's a `build --stage3` flag either way, so it's easy to turn on later."*

If they say yes, ASK where the proxy should live and whether they want the reference
implementation (Express, with rate limiting) or already have their own preference.

## ASK 9 — What does this app know that the scanner cannot? (the interview)

This is the single biggest lever on whether the assistant feels intelligent, and the only
one that costs the developer a conversation instead of a flag. Read from source alone,
every screen is a title and a template sentence ("*Estado Médico is a screen in the
guardian area of this application*"). The matcher can only recognise words that appear in
the registry, so a question in ordinary words never reaches the screen it means. Measured
on the reference app, writing down what a developer knows lifted the right screen from
ranked-first in 6 of 10 everyday questions to 9 of 10, and the share of the golden set it
acts on directly from 26% to 62%, with no screen executed wrongly. That was
knowledge written by the author of the tool, not by a developer, on a fixture — the owner's
run on a real application is the real test.

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
   cannot reach is absent from what it receives, not hidden in it. The role comes from
   their session, never from the request.
2. **Never serve `review/`,** in any environment, for any reason.

`nextgen.js` and `thresholds.hashing.json` go to everyone. The script tag uses no inline
script or style, so a strict Content-Security-Policy is fine.

**The role must come from the session, never from the request** — a role in a query string
or a header is a role the visitor chooses.

**Express**, after the app's own session middleware:

```js
import path from 'node:path';

const BUNDLE = path.resolve('nextgen/bundle');
const SHARED = new Set(['nextgen.js', 'thresholds.hashing.json']);

app.get('/nextgen/:file', (req, res) => {
  const role = req.user?.role; // from their session
  const { file } = req.params;
  const own = Boolean(role) && (file === `registry.${role}.json` || file === `index.${role}.json`);
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

## Turn on model-backed answers

Only if the developer said yes to ASK 8. Two steps: run a proxy, then rebuild pointing at
it. The order matters — `build` records the path as it starts to serve `bundle/`, but the
proxy itself can go live anytime before real traffic reaches it.

**1. Run a proxy.** It receives `{ system, prompt, schema, model }` as JSON and must answer
with JSON matching `schema` — nothing more. It decides which model to call and how; this
tool never assumes a provider. The reference below is Express, with rate limiting, because
an unauthenticated endpoint that calls a model is something anyone loading the page can
spend money or GPU time against — ADR-017's own warning, not a hypothetical:

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

  const { system, prompt, schema, model } = req.body ?? {};
  if (typeof system !== 'string' || typeof prompt !== 'string' || !schema) {
    return res.status(400).json({ error: 'malformed request' });
  }

  // Call whatever model this app's developer chose. This is the one line that is theirs
  // to fill in — the shape of the call depends entirely on the provider.
  const answer = await callTheirModel({ system, prompt, schema, model });

  res.json(answer); // must match `schema` — nothing wrapping it, no envelope
});
```

**2. Rebuild pointing at it:**

```bash
node <adapter folder>/scan.mjs build nextgen --stage3 /nextgen/stage3
```

`doctor` will then say plainly that stage 3 is ON and name the path — read that line to the
developer before they ship, every time this flag is used.

## What you should never do without asking first

- **Edit anything under the application's own source.** This tool never needs to. If a
  step seems to require it, stop and say so rather than finding a way to make it work.
  (It proves this about itself: the target tree is fingerprinted before and after a run.)
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

- **It offers; it rarely decides.** Most of the time it shows the two likeliest screens, each
  with what it is for, and the person picks. That is a click more than a perfect guess, and it has sent nobody to a
  wrong place. With stage 3 on (ASK 8), fewer of those turns end in a question back — the
  ones the registry alone could not settle now get an answer instead.
- **It does not decline everything it should.** Roughly half of out-of-scope requests are
  declined; the rest become clarifying questions. None are executed. `FIELD-NOTES.md` §5
  explains why, and what to do about it.
- **It performs no actions.** It moves between screens and shows links. It does not save,
  send or delete anything.
- **Every screen it can reach stays reachable without it.** That one is not negotiable.
