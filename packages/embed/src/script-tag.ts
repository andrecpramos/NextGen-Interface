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
//   data-nextgen-role      required: the signed-in user's role. Without it nothing starts
//   data-nextgen-base      where the role's files are served. Default: this script's folder
//   data-nextgen-target    a CSS selector to mount inside, instead of a corner
//   data-nextgen-position  bottom-right (default), bottom-left, top-right or top-left
//   data-nextgen-lang      the widget's language. Default: <html lang>
//
// A failure is reported with console.warn and never thrown. A script tag has no
// caller to catch a rejection, and an unhandled one is noise in the adopter's error
// monitoring about an optional feature, not a fault in their page.
//
// The ES module entry (index.ts) does none of this: importing it has no effects.

import { CORNERS, start, type Corner, type StartOptions } from './index.ts';

export * from './index.ts';

function autostart(): void {
  if (typeof document === 'undefined') return;
  // Only set while this script is being evaluated, so it is read before anything else.
  const script = document.currentScript as HTMLScriptElement | null;
  const data = script?.dataset;
  const role = data?.nextgenRole?.trim();
  if (!script || !data || !role) return;

  const warn = (message: string): void => console.warn(`[NextGen] ${message}`);
  const base = (data.nextgenBase ?? new URL('.', script.src || document.baseURI).pathname).replace(/\/+$/, '');
  const position = CORNERS.find((corner) => corner === data.nextgenPosition) as Corner | undefined;
  if (data.nextgenPosition && !position) {
    warn(`ignoring data-nextgen-position="${data.nextgenPosition}"; use one of ${CORNERS.join(', ')}`);
  }

  const run = (): void => {
    const selector = data.nextgenTarget;
    const target = selector ? document.querySelector(selector) : null;
    if (selector && !target) {
      warn(`data-nextgen-target="${selector}" matches nothing on this page, so the assistant did not start`);
      return;
    }
    const options: StartOptions = {
      ...(target ? { target } : {}),
      ...(position ? { position } : {}),
      ...(data.nextgenLang ? { lang: data.nextgenLang } : {}),
    };
    start(base, role, options).catch((error: unknown) => {
      warn(`the assistant did not start: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

autostart();
