# The NVDA pass — 15 minutes, item by item

**This is the half that decides whether the accessibility claim is made.** The
automated run ([RESULT.md](./RESULT.md)) checks what a machine can check and
nothing more; it makes this pass shorter, and it does not shorten it to zero. If
an item here fails, the fix or the withdrawal of the claim is the outcome —
PLAN.md WP-45's *Stop if*.

**Who runs it:** the owner. An agent cannot do this: every item below is a
judgement about what a person hears, sees or can reach.

## Before you start (3 minutes)

- NVDA, current stable, from nvaccess.org. It is free.
- Firefox or Chrome. Use one, note which.
- Turn the **speech viewer** on (NVDA menu → Tools → Speech viewer). It prints
  what NVDA says, so you can copy the words into the "heard" column instead of
  remembering them.
- Put the widget on a page: run `nextgen preview` on an app the kit has built, or drop
  the kit's `nextgen` folder into an app and add the one-line script tag.
- **Keep your hands off the mouse for the whole pass.** If you reach for it, that
  is itself a finding — write down what made you reach.

Useful keys: `Tab` / `Shift+Tab` move, `Enter` activates, `NVDA+↓` reads from
here, `Insert+F7` lists landmarks and links, `NVDA+Q` quits.

## The pass

Fill the "heard / saw" column as you go. An item is ✅ only if you can write
down what you heard and it matches the "should".

| # | Do this | It should | Heard / saw | ✅ / ❌ |
|---|---|---|---|---|
| 1 | `Tab` from the top of the page until you reach the assistant | Announce a labelled search: the words "Ask where to go" (or Portuguese "Pergunte para onde quer ir"), that it is an edit field, and that it is in a search region | | |
| 2 | Count the tab stops it took | Be the same number before and after the widget is on the page, plus two (the field and the button). The widget must not reorder the host page | | |
| 3 | Type a question and press `Enter` — do **not** click | Submit. You should never need the button | | |
| 4 | Listen while it is working | Say nothing, or say "Looking…" once. It must not chatter or repeat | | |
| 5 | Listen when the answer lands | Read the answer **without you doing anything** — this is the `aria-live` region. If you had to go looking for it, that is ❌ | | |
| 6 | Ask something ambiguous ("jogos", "calendar") | Announce a list, and say **how many** items are in it | | |
| 7 | `Tab` to a choice and press `Enter` | Go to that screen. `Shift+Tab` back — you should be able to leave the list | | |
| 8 | Ask a question, and while it is still working `Tab` into the **previous** answer's links. Let the new answer land | Put you back in the question field — not at the top of the page. *(This is the defect the automated run found. It is fixed; this item is here to confirm it with a real screen reader.)* | | |
| 9 | Press `Escape` in the question field | Clear the field and the answer, and leave you in the field | | |
| 10 | Ask for something the app cannot do ("book me a flight") | State the limit as a fact, in one sentence. It must not apologise in a loop or read like an error | | |
| 11 | `Insert+F7`, then "Landmarks" | List the host page's landmarks. The widget adds a search region and must not add a second `main` or steal the page's heading structure | | |
| 12 | Look at the screen: `Tab` through every control | Show a **visible** focus ring on each — 3px, high contrast. Nothing may be focusable with no visible ring | | |
| 13 | Windows Settings → Accessibility → Contrast themes → apply **Night sky** (or any) | The widget follows it: readable text, visible borders, visible focus. It paints in system colours, so this should work — it has never been looked at | | |
| 14 | Browser zoom to **200%**, then 400% | Stay usable, no horizontal scrolling to read, nothing clipped or overlapping | | |
| 15 | Windows Settings → Accessibility → Visual effects → **Animation effects off**. Use the widget | Behave identically. Nothing fades, slides or moves | | |
| 16 | Measure the field, button and each link (any on-screen ruler, or zoom and eyeball) | Be at least 48×48 CSS px | | |
| 17 | On a phone, or Chrome DevTools device mode with TalkBack/VoiceOver if you have it | Work. Note honestly if untested — mobile screen readers are a different pass | | |

## What this pass is for, and what it is not

Items 12–16 are the ones **no automated check in this repository can make**, and
they are here for that reason:

- **Colour contrast.** The automated run reports it as *incomplete*, not *pass*.
  jsdom computes no layout and no cascade, and the widget paints in system
  colours (`Canvas`, `CanvasText`, `LinkText`, `Highlight`) — whose values are
  the user's, not this code's. Only a real browser at real settings can judge it.
- **Announcement order and interruption.** Whether a live region interrupts, and
  in what order two changes are read, is a screen-reader behaviour. axe checks
  that the region is correctly marked, never how it sounds.
- **Visible focus, target size, reflow.** Declared in the stylesheet and checked
  there; that the browser paints them is item 12, 14 and 16.

## Recording the result

Write what you heard in the table, save this file with the date and the NVDA and
browser versions, and record the outcome in PLAN.md's WP-45 acceptance. **A blank
column is not a pass.** Until this is filled in, the honest statement is
*"automated checks pass; no screen reader has confirmed it"*, and that is what
the README and the write-up must say.

**Run on:** _(date)_ · **NVDA:** _(version)_ · **Browser:** _(version)_ · **By:** _(name)_
