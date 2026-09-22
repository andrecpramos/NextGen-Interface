// WP-45 — the accessibility claim, checked before it is made.
//
// The pitch says the assistant is accessible. Until this script, nothing had
// verified that, and no screen reader had ever been pointed at it.
//
// What this runs against is the SHIPPED artefact: packages/embed/dist/nextgen.js,
// loaded into a real DOM the way a script tag loads it, driven with a generated fixture
// registries, and inspected with axe-core in each state a user can actually reach.
// Not a mock of the widget — the file an adopter serves.
//
//   node tooling/scripts/check-accessibility.mjs [--json]
//
// Exit 1 on any serious or critical violation (PLAN.md WP-45's acceptance bar).
//
// ⚠️ WHAT THIS CANNOT CHECK, stated before the results rather than after:
//
//   · Colour contrast. jsdom has no layout and computes no cascade, so axe
//     returns contrast as "incomplete", not "pass". The widget also paints in
//     system colours (Canvas, CanvasText, LinkText), which are whatever the
//     user's OS says they are — a contrast ratio is not a property this code
//     owns. A real browser at real settings is the only place to judge it.
//   · Anything about how a screen reader SOUNDS: announcement order, whether a
//     live region interrupts, how a link's name reads aloud.
//   · Visible focus, reflow, and target size as rendered. The CSS declares 48px
//     targets and a 3px focus ring; that the browser paints them is a claim this
//     script checks in the stylesheet, not on screen.
//
// Those are exactly the items in eval/a11y/NVDA-CHECKLIST.md, which is the
// owner's 15-minute pass. Automated checks make that pass shorter. They do not
// replace it, and this script must never be cited as if they had.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = `${ROOT}/packages/embed/dist/nextgen.js`;
const GEN = `${ROOT}/eval/frameworks/family/generated`;
const OUT = `${ROOT}/eval/a11y`;

const asJson = process.argv.includes('--json');
const say = (line) => { if (!asJson) console.log(line); };

// The artefact under test has to exist and be current.
execFileSync(process.execPath, [`${ROOT}/packages/embed/build.mjs`], { stdio: 'pipe' });
const code = readFileSync(DIST, 'utf8');
const axeSource = readFileSync(`${ROOT}/node_modules/axe-core/axe.min.js`, 'utf8');

const bundle = (role) => ({
  registry: JSON.parse(readFileSync(`${GEN}/registry.${role}.json`, 'utf8')),
  index: JSON.parse(readFileSync(`${GEN}/index.${role}.json`, 'utf8')),
  thresholds: JSON.parse(readFileSync(`${GEN}/thresholds.hashing.json`, 'utf8')).thresholds,
});

/**
 * A host page that is itself accessible, so what axe reports is the widget's.
 *
 * This matters: run axe over a bare `<body>` and it reports a missing title and
 * a missing main landmark, which are the harness's faults. The widget is judged
 * scoped to its own host element; the page is judged too, separately, because an
 * adopter's page is where a duplicate id or a stolen landmark would show up.
 */
function page(lang) {
  return new JSDOM(
    `<!doctype html><html lang="${lang}"><head><title>Clube — área do encarregado</title></head>` +
    '<body><header><nav aria-label="Principal"><a href="/">Início</a></nav></header>' +
    '<main><h1>Área do encarregado</h1><p>Uma página do clube.</p><div id="corner"></div></main></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://clube.test/my/children/7/development' },
  );
}

async function surface(lang, role) {
  const dom = page(lang);
  const { window } = dom;
  window.eval(`${code}\nwindow.NextGen = NextGen;`);
  window.eval(axeSource);
  const assistant = window.NextGen.create(bundle(role));
  const mounted = window.NextGen.mount(window.document.getElementById('corner'), assistant, {
    // A single-page app supplies its router, which is the configuration that
    // adds click handlers to the links — the more complicated of the two.
    navigate: () => {},
  });
  return { window, mounted, root: mounted.host.shadowRoot };
}

/** axe, scoped to one element, reporting only what it is sure about. */
async function audit(window, element) {
  const results = await window.axe.run(element, {
    resultTypes: ['violations'],
    // Rules that ask a question about the whole document cannot be answered
    // about a fragment of it, and are checked in the page-level run instead.
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  });
  return {
    violations: results.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      target: v.nodes[0]?.target?.join(' ') ?? null,
    })),
    incomplete: results.incomplete.map((i) => i.id),
  };
}

const findings = [];
const note = (ok, label, detail) => {
  findings.push({ ok, label, detail });
  say(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// ---------------------------------------------------------------- axe, per state --

say('\n  axe-core, in every state a user can reach\n');

const states = [];
{
  const { window, mounted, root } = await surface('pt', 'PARENT');
  const input = root.querySelector('input');
  const result = root.querySelector('.result');

  // 1. As mounted: an empty form, before anything is asked.
  states.push(['idle', await audit(window, mounted.host)]);

  // 2. Mid-question. The widget sets aria-busy and shows its "thinking" word;
  //    this is a state a slow device really sits in, so it is audited too.
  result.setAttribute('aria-busy', 'true');
  result.replaceChildren(Object.assign(window.document.createElement('p'), { textContent: 'A procurar…' }));
  states.push(['thinking', await audit(window, mounted.host)]);
  result.removeAttribute('aria-busy');

  // 3. A clarifying answer: a list of links, the richest thing it draws.
  const choose = await mounted.ask('onde vejo as lesões do meu filho');
  states.push([`choose (${choose.choices.length} links)`, await audit(window, mounted.host)]);

  // 4. A declared limit: the refusal path, which reads differently and must not
  //    read as an error. Driven by one of the registry's own boundary examples,
  //    because free-form out-of-scope lands in `choose` as often as not — that is
  //    D-5's measured ceiling, and auditing the wrong state to avoid saying so
  //    would make this run a lie. The tone is asserted for the same reason.
  const limit = await mounted.ask('book a physio appointment for my son');
  states.push([`limit (${limit.choices.length} links)`, await audit(window, mounted.host)]);
  const reachedLimit = limit.tone === 'limit';

  // 5. The whole page with the widget on it, which is where an adopter would
  //    discover a duplicate id or a second main landmark.
  states.push(['host page + widget', await audit(window, window.document)]);

  for (const [label, r] of states) {
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const minor = r.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
    note(
      bad.length === 0,
      `${label}: ${bad.length} serious/critical`,
      [
        minor.length ? `${minor.length} minor/moderate` : null,
        r.incomplete.length ? `incomplete (jsdom cannot judge): ${r.incomplete.join(', ')}` : null,
        ...bad.map((v) => `${v.impact} ${v.id} on ${v.target}`),
        ...minor.map((v) => `${v.impact} ${v.id} on ${v.target}`),
      ].filter(Boolean).join('; '),
    );
  }

  note(reachedLimit, 'the refusal state above really is a refusal',
    reachedLimit ? 'a declared boundary, presented as a limit' : 'it came back as something else — that state was not audited');
}

// ---------------------------------------------------- the assistant layer --
//
// `start()` mounts this, so it is what an adopter's visitor meets first: an orb
// at the edge, and a full-screen dialog behind it. jsdom has no layout and no
// canvas, so the orb draws nothing here and where it sits is not judged —
// `chooseDockSide` and the orb's state have their own tests. What is judged is
// everything a keyboard or screen-reader user reaches.

say('\n  the assistant layer — orb, screen, answer\n');

{
  const dom = page('pt');
  const { window } = dom;
  window.eval(`${code}\nwindow.NextGen = NextGen;`);
  window.eval(axeSource);
  const assistant = window.NextGen.create(bundle('PARENT'));
  const mounted = window.NextGen.mountAssistant(window.document.body, assistant, {
    navigate: () => {},
    dockSide: 'right',
    home: [],
    storage: null,
    preferences: null,
    voice: false,
    // Off by default; audited on, since that is when there are more controls to get wrong.
    attach: true,
  });
  const root = mounted.host.shadowRoot;
  const orb = root.querySelector('.orb');
  const screen = root.querySelector('.screen');
  const input = root.querySelector('input');
  const tick = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const layerStates = [['orb, screen shut', await audit(window, mounted.host)]];

  orb.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  const opened = screen.getAttribute('data-open') === 'true' && !screen.hasAttribute('inert');
  const focusMovedIn = root.activeElement === input;
  layerStates.push(['screen open', await audit(window, mounted.host)]);

  const noSuggestions = root.querySelectorAll('.places, .place, .more').length === 0;

  // A photo and a document waiting to be sent (ADR-024): the paperclip, the tray, a chip and a remove button
  // for each. This state did not exist until 2026-09-21, and a gate that never saw it could not have failed on it.
  const picker = root.querySelector('.file-picker');
  Object.defineProperty(picker, 'files', {
    configurable: true,
    value: [new window.File(['x'], 'certificate.pdf', { type: 'application/pdf' }), new window.File(['y'], 'photo.png', { type: 'image/png' })],
  });
  picker.dispatchEvent(new window.Event('change'));
  await tick(60);
  const chips = root.querySelectorAll('.attach-item').length;
  layerStates.push([`screen, ${chips} files attached`, await audit(window, mounted.host)]);
  const removers = [...root.querySelectorAll('.attach-x')].map((b) => b.textContent.trim());
  note(chips === 2 && removers.length === 2 && removers.every(Boolean), 'each attached file has a remove button that names it', removers.join(' | '));
  note(Boolean(root.querySelector('.attach')?.textContent.trim()), 'the paperclip has an accessible name', `"${root.querySelector('.attach')?.textContent.trim()}"`);
  note(picker.getAttribute('aria-hidden') === 'true' && picker.tabIndex === -1 && picker.hidden,
    'the hidden file input is out of the accessibility tree and the tab order',
    `aria-hidden=${picker.getAttribute('aria-hidden')} tabindex=${picker.tabIndex} hidden=${picker.hidden}`);
  for (const remove of root.querySelectorAll('.attach-x')) remove.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // The menu: the adopter's navigation, or the registry's places where the page has none.
  const menuButton = root.querySelector('.menu');
  const drawer = root.querySelector('.drawer');
  menuButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const menuOpened = drawer.getAttribute('data-open') === 'true' && !drawer.hasAttribute('inert')
    && menuButton.getAttribute('aria-expanded') === 'true';
  const focusInMenu = drawer.contains(root.activeElement);
  const expandedWhileOpen = menuButton.getAttribute('aria-expanded');
  const menuLinks = root.querySelectorAll('.drawer-link').length;
  layerStates.push([`screen, menu open (${menuLinks} links)`, await audit(window, mounted.host)]);
  screen.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const menuClosedFirst = drawer.getAttribute('data-open') === 'false' && screen.getAttribute('data-open') === 'true'
    && root.activeElement === menuButton;

  // The same clarifying question the chat box is audited with above.
  const answered = await mounted.ask('onde vejo as lesões do meu filho');
  layerStates.push([`screen answered (${answered.choices.length} links)`, await audit(window, mounted.host)]);

  for (const [label, r] of layerStates) {
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const minor = r.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
    note(
      bad.length === 0,
      `${label}: ${bad.length} serious/critical`,
      [
        minor.length ? `${minor.length} minor/moderate` : null,
        r.incomplete.length ? `incomplete (jsdom cannot judge): ${r.incomplete.join(', ')}` : null,
        ...bad.map((v) => `${v.impact} ${v.id} on ${v.target}`),
        ...minor.map((v) => `${v.impact} ${v.id} on ${v.target}`),
      ].filter(Boolean).join('; '),
    );
  }

  const greeting = root.getElementById(screen.getAttribute('aria-labelledby'));
  note(
    screen.getAttribute('role') === 'dialog' && screen.getAttribute('aria-modal') === 'true' && Boolean(greeting?.textContent.trim()),
    'the screen is a named modal dialog', `aria-labelledby → "${greeting?.textContent}"`,
  );
  note(Boolean(orb.getAttribute('aria-label')?.trim()), 'the orb has an accessible name',
    `aria-label="${orb.getAttribute('aria-label')}"`);
  note(opened && focusMovedIn, 'opening moves focus into the screen',
    focusMovedIn ? 'focus is on the composer' : `focus is on ${root.activeElement?.tagName ?? 'nothing inside the screen'}`);
  const composerLabel = root.querySelector(`label[for="${input.id}"]`);
  note(Boolean(input.id && composerLabel?.textContent.trim()), 'the composer has a real <label for>',
    `for="${composerLabel?.getAttribute('for')}" id="${input.id}"`);

  note(noSuggestions, 'the screen offers no pre-written questions or places',
    noSuggestions ? 'greeting and composer only' : 'a suggestion list is rendered');
  note(menuOpened && focusInMenu && menuLinks > 0, 'the menu is a real disclosure, and focus moves into it',
    `aria-expanded=${expandedWhileOpen} while open · ${menuLinks} link(s)`);
  note(menuClosedFirst, 'Escape closes the menu first, and focus returns to its button');
  const why = root.querySelector('.why summary');
  const weighed = root.querySelectorAll('.why-list li').length;
  note(Boolean(why?.textContent.trim()) && weighed > 0,
    'an answer explains itself from its own record — a native "Why?" disclosure',
    `"${why?.textContent}" · ${weighed} candidate(s)`);

  screen.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  note(
    screen.getAttribute('data-open') === 'false' && root.activeElement === orb && orb.getAttribute('aria-expanded') === 'false',
    'Escape closes the screen and returns focus to the orb',
  );
  mounted.destroy();
}

// ------------------------------------------------- what axe cannot answer --

say('\n  keyboard, focus, live region, motion\n');

{
  const { window, mounted, root } = await surface('pt', 'PARENT');
  const input = root.querySelector('input');
  const button = root.querySelector('button');
  const label = root.querySelector('label');

  // Keyboard: everything interactive is in the natural tab order. A positive
  // tabindex would reorder the HOST page's tab sequence, which is the widget
  // reaching outside itself.
  const positive = [...root.querySelectorAll('[tabindex]')]
    .filter((e) => Number(e.getAttribute('tabindex')) > 0);
  note(positive.length === 0, 'no positive tabindex (the host page keeps its own tab order)',
    positive.length ? `${positive.length} element(s)` : 'input and button are natural stops');

  // The label is really attached: `for` matches an id INSIDE this shadow root.
  const labelled = label.getAttribute('for') === input.id && Boolean(input.id);
  note(labelled, 'the input has a real <label for>', `for="${label.getAttribute('for')}" id="${input.id}"`);

  // Submitting from the keyboard is what Enter does in a form; the widget must
  // not require a click on the button.
  let submitted = false;
  const form = root.querySelector('form');
  form.addEventListener('submit', () => { submitted = true; });
  input.value = 'onde vejo o calendário';
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  note(submitted, 'Enter submits the form (no pointer required)');

  // Escape clears the box and the result, without moving focus somewhere else.
  const answered = await mounted.ask('onde vejo as lesões do meu filho');
  input.focus();
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  note(input.value === '' && root.querySelector('.result').childNodes.length === 0,
    'Escape clears the question and the result');
  note(root.activeElement === input, 'focus is still in the input after Escape');

  // Focus management: the answer replaces the result's children. If the user is
  // standing on one of the links from the previous answer when the next answer
  // lands, that link is removed — and focus goes to nowhere.
  await mounted.ask('onde vejo as lesões do meu filho');
  const link = root.querySelector('.result a');
  if (link) {
    link.focus();
    const focusedALink = root.activeElement === link;
    await mounted.ask('onde vejo os treinos');
    const landed = root.activeElement;
    const lost = landed === null || landed === window.document.body || !root.contains(landed);
    note(!lost || !focusedALink, 'focus survives the answer being replaced',
      lost ? `focus fell to ${landed === null ? 'null' : landed.tagName ?? 'body'} when the link it was on was removed` : `stayed on ${landed?.tagName}`);
  } else {
    note(false, 'focus survives the answer being replaced', 'no link rendered — check the fixture');
  }

  // The live region exists from mount, which is the part that decides whether a
  // screen reader announces later changes at all.
  const result = root.querySelector('.result');
  note(result.getAttribute('aria-live') === 'polite' && result.getAttribute('role') === 'status',
    'the result is a polite live region, present from mount',
    `role=${result.getAttribute('role')} aria-live=${result.getAttribute('aria-live')}`);

  // Language: a screen reader pronounces the widget's own words using the page's
  // language. The widget takes its words from <html lang>, so this is testable.
  const pt = root.querySelector('label').textContent;
  const { root: enRoot } = await surface('en', 'PARENT');
  const en = enRoot.querySelector('label').textContent;
  note(pt !== en && pt.startsWith('Pergunte'), 'the widget speaks the page\'s language',
    `lang=pt → "${pt}" · lang=en → "${en}"`);
}

// The stylesheet claims 48px targets, a visible focus ring and reduced motion.
// jsdom paints nothing, so these are read from the CSS each file ships.
// assistant.ts is checked alongside widget.ts because `start()` mounts the
// assistant layer — the same claims have to hold for both, not just the original.
for (const file of ['widget.ts', 'assistant.ts']) {
  const css = readFileSync(`${ROOT}/packages/embed/src/${file}`, 'utf8');
  const sheet = css.slice(css.indexOf('const CSS = `') + 13, css.indexOf('`;', css.indexOf('const CSS = `')));

  note(/@media \(prefers-reduced-motion: reduce\)/.test(sheet), `${file}: honours prefers-reduced-motion`);

  // Every rule that animates outside the reduced-motion block must be one the
  // block actually cancels — not "no motion at all" (widget.ts has none; the
  // blob genuinely animates by default), but "nothing is left unguarded".
  // Matched by the element each rule targets (a compound selector's last
  // token — `.core` out of `button.blob[data-state="thinking"] .core` — since
  // `!important` inside the block beats a non-important rule regardless of
  // the outside rule's specificity).
  // Just the selector list the reduce block targets — e.g. "button.blob, .core"
  // out of "@media (...) { button.blob, .core { transition: none !important; ... } }".
  const reduceSelectorMatch = /@media \(prefers-reduced-motion: reduce\)[^{]*\{\s*([^{}]+)\{/.exec(sheet);
  const guarded = reduceSelectorMatch?.[1] ?? '';
  const lastToken = (selector) => selector.trim().split(/\s+/).pop();
  const guardedTokens = new Set(guarded.split(',').map(lastToken));
  // A bare `*` in the list is a blanket kill-switch; `.stage > *` is not.
  const guardsEverything = guarded.split(',').some((part) => part.trim() === '*');

  const outsideSheet = sheet.replace(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*\}[^}]*\}/g, '');
  const motionRules = outsideSheet.match(/[^{}]+\{[^{}]*\b(?:transition|animation)\s*:[^{}]*\}/g) ?? [];
  const unguarded = guardsEverything ? [] : motionRules.filter(
    (rule) => !rule.slice(0, rule.indexOf('{')).trim().split(',').some((part) => guardedTokens.has(lastToken(part))),
  );
  note(unguarded.length === 0, `${file}: every declared motion is cancelled under reduced motion`,
    unguarded.length ? unguarded.join(' | ') : motionRules.length ? `${motionRules.length} animated rule(s), all guarded` : 'nothing to suppress');

  const targets = (sheet.match(/min-(?:height|width):\s*48px/g) ?? []).length;
  note(targets >= (file === 'widget.ts' ? 3 : 2), `${file}: declares 48px targets`, `${targets} rule(s) at 48px`);
  note(/:focus-visible\s*\{[^}]*outline:/.test(sheet), `${file}: a visible focus ring is declared`, 'outline on :focus-visible');
}

// ------------------------------------------------------------------ verdict --

const failed = findings.filter((f) => !f.ok);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/axe.json`, `${JSON.stringify({
  checkedAt: new Date().toISOString(),
  artefact: 'packages/embed/dist/nextgen.js',
  data: 'eval/frameworks/family/generated (PARENT)',
  tool: `axe-core ${JSON.parse(readFileSync(`${ROOT}/node_modules/axe-core/package.json`, 'utf8')).version} in jsdom`,
  cannotCheck: ['colour contrast (no layout, and system colours)', 'announcement order', 'rendered focus and target size'],
  states: Object.fromEntries(states),
  findings,
}, null, 2)}\n`);

if (asJson) console.log(JSON.stringify(findings, null, 2));

if (failed.length > 0) {
  console.error(`\n  Accessibility FAILED — ${failed.length} of ${findings.length} check(s):\n`);
  for (const f of failed) console.error(`    ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
  console.error('\n  eval/a11y/axe.json has the full output.\n');
  process.exit(1);
}

say(`\n  Accessibility OK — ${findings.length} checks, 0 serious or critical violations.`);
say('  This is the automated half. eval/a11y/NVDA-CHECKLIST.md is the other half,');
say('  and the claim is not made until the owner has run it.\n');
