# The NVDA pass — 15 minutes, item by item

**This is the half that decides whether the accessibility claim is made.** The
automated run ([RESULT.md](./RESULT.md)) checks what a machine can check and
nothing more; it makes this pass shorter, and it does not shorten it to zero. If
an item here fails, the fix or the withdrawal of the claim is the outcome.

**Who runs it:** a person with a screen reader. An agent cannot do this: every item below is a
judgement about what a person hears, sees or can reach.

## Before you start (3 minutes)

- NVDA, current stable, from nvaccess.org. It is free.
- Firefox or Chrome. Use one, note which.
- Turn the **speech viewer** on (NVDA menu → Tools → Speech viewer). It prints
  what NVDA says, so you can copy the words into the "heard" column instead of
  remembering them.
- Put the widget on a page. In this repository: `pnpm preview`, then open
  `http://127.0.0.1:4173/dashboard?role=PARENT` — the mock app, with the real widget, in Portuguese and with
  attachments turned on. (On an adopter's app: `node <tool>/scan.mjs preview`.)
- **What you are testing** (rewritten 2026-09-22; the first version of this list described the old inline
  search box; revised 2026-09-23 for ADR-026): a round button in a corner of the page — the orb — which
  opens a chat panel in that corner, with a greeting, a conversation and a question box at the bottom. The
  panel sits beside the page and is not modal; its "Ecrã inteiro" (full screen) button makes it fill the
  screen except the app's own navigation, and then it is modal.
- **Keep your hands off the mouse for the whole pass.** If you reach for it, that
  is itself a finding — write down what made you reach.

Useful keys: `Tab` / `Shift+Tab` move, `Enter` activates, `NVDA+↓` reads from
here, `Insert+F7` lists landmarks and links, `NVDA+Q` quits.

## The pass

Fill the "heard / saw" column as you go. An item is ✅ only if you can write
down what you heard and it matches the "should".

| # | Do this | It should | Heard / saw | ✅ / ❌ |
|---|---|---|---|---|
| 1 | `Tab` from the top of the page until you reach the assistant | Announce **one button**, "Abrir o assistente" ("Open the assistant"), collapsed. It is the last stop on the page; the widget must not reorder the host page's own stops | | |
| 2 | Press `Enter` on it | Open a **dialog**, announced by its name "Pronto quando quiser." and its description ("Diga o que quer fazer, por palavras suas…"), with you in the question box, which is announced as "Pergunte para onde quer ir", an edit field | | |
| 3 | Type a question and press `Enter` — do **not** reach for the send button | Submit. You should never need the button | | |
| 4 | Listen while it is working | Say "A procurar…" ("Looking…") once, or nothing. It must not chatter or repeat | | |
| 5 | Listen when the answer lands | Read the answer **without you doing anything** — the conversation is a log that announces what is added. If you had to go looking for it, that is ❌ | | |
| 6 | Ask something ambiguous ("jogos", "calendário") | Ask **one question** — "Procura X?" or "Refere-se a X, ou a Y?" — and announce its one or two places as a list, saying **how many** items are in it, each with what it is for | | |
| 7 | `Tab` to an option and press `Enter` | Go to that screen. Before that, `Shift+Tab` back up — you should be able to leave the list | | |
| 8 | Ask a question, and while it is still working `Tab` into the **previous** answer's links. Let the new answer land | Leave you where you were: earlier answers stay in the conversation, so nothing is removed from under you, and focus is not thrown to the top of the page | | |
| 9 | Keep pressing `Tab`, then `Shift+Tab`, all the way round — first in the panel, then after pressing "Ecrã inteiro" | In the **panel**, `Tab` walks on past the send button into the page: it is beside the page, not over it. **Expanded**, the button is announced pressed ("Mais pequeno"), and `Tab` stays **inside the dialog**, wrapping from the send button to the full-screen button and back | | |
| 10 | Ask for something the app cannot do ("quero pagar a mensalidade", "book me a flight") | State the limit as a fact, in one sentence, then what it *can* do. It must not apologise in a loop or read like an error | | |
| 11 | Press `Escape` | Close the dialog and put you back on the orb button, now announced collapsed | | |
| 12 | Look at the screen: `Tab` through every control in the dialog, and the orb outside it | Show a **visible** focus ring on each — 2px, in the page's accent colour. Nothing may be focusable with no visible ring. Nothing is written beside the orb, on hover or on focus: NVDA hears the button's name | | |
| 13 | Windows Settings → Accessibility → Contrast themes → apply **Night sky** (or any) | The widget follows it: solid system colours instead of glass, readable text, visible borders and focus, the primary buttons in the highlight colour | | |
| 14 | Browser zoom to **200%**, then 400% | Stay usable, no horizontal scrolling to read, nothing clipped or overlapping | | |
| 15 | Windows Settings → Accessibility → Visual effects → **Animation effects off**. Use the widget | Behave identically, with nothing fading, sliding or pulsing. (The orb still draws, but does not animate) | | |
| 16 | Measure the question box, each button and each option (any on-screen ruler, or zoom and eyeball) | Be at least 48×48 CSS px on a desktop. On a phone-width screen the four buttons beside the box are 44×44 by design, so the box stays wide enough to type in — note it, do not fail it | | |
| 17 | On a phone, or Chrome DevTools device mode with TalkBack/VoiceOver if you have it | Work. Note honestly if untested — mobile screen readers are a different pass | | |
| 18 | *(added 2026-09-21)* `Tab` to the paperclip, and on a phone the camera. Then `Shift+Tab` | Announce "Anexar uma foto ou ficheiro" (and "Tirar uma fotografia") as buttons. The hidden file inputs must **not** be announced or take a tab stop. `Shift+Tab` goes back one control — it must not jump to the send button (a defect fixed 2026-09-22) | | |
| 19 | Press `Enter` on the paperclip and choose a photo and a PDF | The system file dialog opens. Back in the widget, hear "2 files attached" without going looking for it, and reach each chip's "Remove <name>" button with `Tab` | | |
| 20 | Attach a fifth file, or a `.exe` | Hear why it was refused, in a sentence with the real limit in it — not silence, and not a generic error | | |
| 21 | Send a message with an attachment | The visitor's own message lists the file names (a photo has no visible name, so its name must be read), and the answer says whether the app took it or it stayed on the device | | |
| 22 | Windows Settings → Accessibility → Visual effects → **Transparency effects off** | The widget's surfaces turn solid, and every word is still readable. (It also honours `prefers-reduced-transparency`; this is the real-world check.) | | |

## What this pass is for, and what it is not

Items 12–16 are the ones **no automated check in this repository can make**, and
they are here for that reason:

- **Colour contrast.** The automated run reports it as *incomplete*, not *pass*.
  jsdom computes no layout and no cascade, and the widget's glass is computed from
  the host page's own colours, blurred over whatever is behind it — so only a real
  browser can judge it. It was sampled once on the real pixels in Edge (every label
  ≥ 4.96:1 dark, ≥ 5.09:1 light, 2026-09-21); your eyes at your settings are the
  check that counts. In a contrast theme it switches to system colours (item 13).
- **Announcement order and interruption.** Whether a live region interrupts, and
  in what order two changes are read, is a screen-reader behaviour. axe checks
  that the region is correctly marked, never how it sounds.
- **Visible focus, target size, reflow.** Declared in the stylesheet and checked
  there; that the browser paints them is item 12, 14 and 16.

## Recording the result

Write what you heard in the table, save this file with the date and the NVDA and
browser versions, and commit it. **A blank
column is not a pass.** Until this is filled in, the honest statement is
*"automated checks pass; no screen reader has confirmed it"*, and that is what
the README and the write-up must say.

**Run on:** _(date)_ · **NVDA:** _(version)_ · **Browser:** _(version)_ · **By:** _(name)_
