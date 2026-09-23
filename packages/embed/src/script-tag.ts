// The script tag's entry point: everything @nextgen/embed exports, plus starting
// itself from the attributes of the <script> element that loaded it.
//
//   <script src="/nextgen/nextgen.js" data-nextgen-role="PARENT" defer></script>
//
// Why attributes and not `<script>NextGen.start(...)</script>`: an inline script is
// blocked by any Content-Security-Policy without 'unsafe-inline'. Measured in Edge
// 153 on 2026-09-13 (`script-src-elem`), so the snippet `doctor` used to print never
// started the widget on exactly the sites most careful about security. The role
// arrives as data in an attribute; nothing from the page is evaluated.
//
//   data-nextgen-role      required: the signed-in user's role — or roles, space- or comma-separated, for a
//                          user who holds several. Without it nothing starts
//   data-nextgen-base      where the role's files are served. Default: this script's folder
//   data-nextgen-target    a CSS selector to mount inside, instead of a corner
//   data-nextgen-position  bottom-right (default), bottom-left, top-right or top-left
//   data-nextgen-lang      the widget's language. Default: <html lang>
//   data-nextgen-attach    "on" offers the photo and file buttons. Default: off, because most apps have
//                          nowhere to send a file. What a visitor attaches never leaves their device: it
//                          reaches the page as a `nextgen:attach` event, which the page must handle
//   data-nextgen-inset     "x,y": how far the orb and panel keep from the corner, in pixels. Default "20,20".
//                          Raise y to clear the app's own floating button
//   data-nextgen-hide      CSS selectors, comma-separated, for the app's own launchers — its chat button, its
//                          tour prompt — hidden while this assistant runs, so there is one entry point (ADR-026)
//   data-nextgen-home      the page(s) where the panel opens by itself. Default "/". In an app whose "/" is a
//                          public page, the one a signed-in user lands on: "/dashboard"
//   data-nextgen-decide    confirm | balanced (default) | eager — how readily it moves the browser (ADR-027)
//   data-nextgen-search    the app's own search, a path with {query}: "/search?q={query}" (ADR-027)
//   data-nextgen-navigation  a CSS selector for the app's main navigation, when it is not a <nav>
//
// What visitors teach it arrives as `nextgen:learn` events on the window (ADR-027); a page that wants to
// keep them listens.
//
// A failure is reported with console.warn and as a `nextgen:error` event on the window, and never
// thrown. A script tag has no caller to catch a rejection, and an unhandled one is noise in the
// adopter's error monitoring about an optional feature, not a fault in their page.
//
// The ES module entry (index.ts) does none of this: importing it has no effects.

import { announceFailure } from './errors.ts';
import { CORNERS, DECIDE, searchChoice, start, WORDS, type Corner, type StartOptions } from './index.ts';

export * from './index.ts';

function autostart(): void {
  if (typeof document === 'undefined') return;
  // Only set while this script is being evaluated, so it is read before anything else.
  const script = document.currentScript as HTMLScriptElement | null;
  const data = script?.dataset;
  // One role, or several for a user who holds more than one ("COACH PARENT" or "COACH,PARENT").
  const roles = (data?.nextgenRole ?? '').split(/[\s,]+/).filter(Boolean);
  const role = roles.length === 1 ? roles[0]! : roles;
  if (!script || !data || roles.length === 0) return;

  const warn = (message: string): void => console.warn(`[NextGen] ${message}`);
  const base = (data.nextgenBase ?? new URL('.', script.src || document.baseURI).pathname).replace(/\/+$/, '');
  const position = CORNERS.find((corner) => corner === data.nextgenPosition) as Corner | undefined;
  if (data.nextgenPosition && !position) {
    warn(`ignoring data-nextgen-position="${data.nextgenPosition}"; use one of ${CORNERS.join(', ')}`);
  }
  // Two whole numbers of pixels, or nothing: an attribute never becomes CSS.
  const insetMatch = /^\s*(\d{1,4})\s*,\s*(\d{1,4})\s*$/.exec(data.nextgenInset ?? '');
  if (data.nextgenInset && !insetMatch) warn(`ignoring data-nextgen-inset="${data.nextgenInset}"; use "x,y" in pixels, e.g. "20,144"`);
  // Paths only, space- or comma-separated: where the panel opens by itself.
  const home = (data.nextgenHome ?? '').split(/[\s,]+/).filter((p) => p.startsWith('/') && !p.startsWith('//'));
  const decide = DECIDE.find((d) => d === data.nextgenDecide?.trim());
  if (data.nextgenDecide && !decide) warn(`ignoring data-nextgen-decide="${data.nextgenDecide}"; use one of ${DECIDE.join(', ')}`);
  if (data.nextgenSearch && !searchChoice(data.nextgenSearch.trim(), 'x', WORDS.en)) {
    warn(`ignoring data-nextgen-search="${data.nextgenSearch}"; use a path on this app with {query} in it, e.g. "/search?q={query}"`);
  }
  const hide = (data.nextgenHide ?? '')
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean);

  const run = (): void => {
    const selector = data.nextgenTarget;
    const target = selector ? document.querySelector(selector) : null;
    if (selector && !target) {
      const message = `data-nextgen-target="${selector}" matches nothing on this page, so the assistant did not start`;
      warn(message);
      announceFailure(new Error(message));
      return;
    }
    const options: StartOptions = {
      ...(target ? { target } : {}),
      ...(position ? { position } : {}),
      ...(data.nextgenLang ? { lang: data.nextgenLang } : {}),
      // Attachments are off unless the adopter says the page takes a file (ADR-024 addendum).
      ...(/^(?:on|true|yes|1)$/i.test(data.nextgenAttach?.trim() ?? '') ? { attach: true } : {}),
      ...(insetMatch ? { inset: { x: Number(insetMatch[1]), y: Number(insetMatch[2]) } } : {}),
      ...(hide.length > 0 ? { companion: { hide } } : {}),
      ...(home.length > 0 ? { home } : {}),
      ...(decide ? { decide } : {}),
      ...(data.nextgenSearch ? { search: data.nextgenSearch.trim() } : {}),
      ...(data.nextgenNavigation ? { navigation: data.nextgenNavigation.trim() } : {}),
    };
    start(base, role, options).catch((error: unknown) => {
      warn(`the assistant did not start: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

autostart();
