// The look book at /alive. Bundled by preview/build.mjs — the widget's own modules, not a copy.
//
// Every card is the real thing: `createLiquid` draws the orb (with the dotted mind from
// thinking-orbs' engine), `createBeam` lays the composer's light over a form, and the orb
// tells the composer its state and level through the same two callbacks the widget uses.

import { createLiquid } from '../packages/embed/src/liquid.ts';
import { BEAM_CSS, beamVariables, createBeam } from '../packages/embed/src/beam.ts';

const STATES = [
  { id: 'idle', title: 'Idle', caption: '', says: 'Breathing: a ring that slowly changes shape, and a halo around the composer.' },
  { id: 'listening', title: 'Listening', caption: 'Listening…', says: 'Your voice moves it: a waveform through the rings, and a glow along the edge that rises with it.' },
  { id: 'thinking', title: 'Thinking', caption: 'Looking for the right screen…', says: 'A scan sweeps the globe, one droplet orbits, and a light travels the composer’s edge.' },
  { id: 'speaking', title: 'Speaking', caption: 'Speaking…', says: 'An undulating sash while it composes the answer; the glow follows the voice.' },
  { id: 'error', title: 'Something went wrong', caption: 'Something went wrong', says: 'It rests instead of performing: contracted, tinted, still.' },
];

const ACCENTS = [
  ['Graphite default', '#79c0ce'],
  ['Violet', '#8b7cf6'],
  ['Amber', '#e0a04a'],
  ['Green', '#4fbf86'],
  ['Rose', '#e0607e'],
];

const SEND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';

const view = { theme: 'dark', accent: '#79c0ce', mind: true, simulate: true, level: 0.6 };

// A look worth discussing can be linked: /alive?theme=light&accent=8b7cf6&mind=off
const query = new URLSearchParams(location.search);
if (query.get('theme') === 'light') view.theme = 'light';
if (query.get('mind') === 'off') view.mind = false;
const asked = (query.get('accent') ?? '').replace(/^#/, '');
if (/^[0-9a-f]{6}$/i.test(asked)) view.accent = '#' + asked;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const style = document.createElement('style');
style.textContent = BEAM_CSS;
document.head.append(style);

const root = document.documentElement;
const states = document.getElementById('states');
const dock = document.getElementById('dock');
let liquids = [];

const palette = () => ({ accent: view.accent, scheme: view.theme, bead: view.theme === 'dark' ? '#171b21' : '#ffffff' });

function applyPage() {
  root.dataset.theme = view.theme;
  root.style.setProperty('--accent', view.accent);
  for (const [name, value] of Object.entries(beamVariables(view.accent, view.theme))) root.style.setProperty(name, value);
}

function card(spec) {
  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `<h3></h3><div class="stage"><canvas aria-hidden="true"></canvas></div><p class="caption" role="status"></p>` +
    `<form class="composer" onsubmit="return false"><input type="text" placeholder="Ask for anything…" aria-label="Ask"><button class="send" type="submit" aria-label="Send">${SEND}</button></form>` +
    `<p class="says"></p>`;
  el.querySelector('h3').textContent = spec.title;
  el.querySelector('.caption').textContent = spec.caption;
  el.querySelector('.says').textContent = spec.says;
  const beam = createBeam(el.querySelector('.composer'), document);
  const liquid = createLiquid(el.querySelector('canvas'), {
    size: 320,
    palette,
    reducedMotion: reduced,
    view: window,
    mind: view.mind,
    onState: (state) => beam.setState(state),
    onLevel: (level) => beam.setLevel(level),
  });
  liquid.setState(spec.id);
  return { el, liquid, spec };
}

function docked(spec) {
  const figure = document.createElement('figure');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const label = document.createElement('figcaption');
  label.textContent = spec.title;
  figure.append(canvas, label);
  const liquid = createLiquid(canvas, { size: 160, palette, reducedMotion: reduced, view: window, mind: view.mind });
  liquid.setState(spec.id);
  liquid.setBacking(1);
  return { el: figure, liquid, spec };
}

function render() {
  for (const { liquid } of liquids) liquid.destroy();
  states.replaceChildren();
  dock.replaceChildren();
  applyPage();
  liquids = [...STATES.map(card), ...STATES.map(docked)];
  liquids.forEach(({ el }, i) => (i < STATES.length ? states : dock).append(el));
}

// A stand-in for a voice: bursts and pauses, so the level has somewhere to go.
function voice(t) {
  const burst = Math.max(0, Math.sin(t * 1.15));
  const syllable = 0.55 + 0.45 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1));
  return view.level * burst * syllable;
}

let started = 0;
function frame(now) {
  started ||= now;
  const t = (now - started) / 1000;
  for (const { liquid, spec } of liquids) {
    if (spec.id === 'listening' || spec.id === 'speaking') liquid.setLevel(view.simulate ? voice(t + (spec.id === 'speaking' ? 1.7 : 0)) : view.level);
  }
  requestAnimationFrame(frame);
}

// -------------------------------------------------------------- controls --

function segmented(id, attribute, current, apply) {
  const buttons = [...document.querySelectorAll(`#${id} button`)];
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset[attribute] === current));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      apply(button.dataset[attribute]);
    });
  }
}
segmented('theme', 'page', view.theme, (value) => {
  view.theme = value;
  render();
});
segmented('mind', 'mind', view.mind ? 'on' : 'off', (value) => {
  view.mind = value === 'on';
  render();
});

const accents = document.getElementById('accents');
const swatches = [];
for (const [name, value] of ACCENTS) {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'swatch';
  swatch.style.background = value;
  swatch.title = name;
  swatch.setAttribute('aria-label', name);
  swatch.setAttribute('aria-pressed', String(value === view.accent));
  swatch.addEventListener('click', () => {
    view.accent = value;
    swatches.forEach((s) => s.setAttribute('aria-pressed', String(s === swatch)));
    render();
  });
  swatches.push(swatch);
  accents.append(swatch);
}
const custom = document.createElement('input');
custom.type = 'color';
custom.value = view.accent;
custom.setAttribute('aria-label', 'Any accent colour');
custom.addEventListener('input', () => {
  view.accent = custom.value;
  swatches.forEach((s) => s.setAttribute('aria-pressed', 'false'));
  render();
});
accents.append(custom);

document.getElementById('simulate').addEventListener('change', (e) => (view.simulate = e.target.checked));
document.getElementById('level').addEventListener('input', (e) => (view.level = Number(e.target.value)));

// The mock application's link is a route the fixture really has; ask the server for it.
fetch('/hosts')
  .then((r) => r.text())
  .then((html) => {
    const href = /<a href="([^"]+)">The mock application<\/a>/.exec(html)?.[1];
    if (href) document.getElementById('app-link').href = href;
  })
  .catch(() => {});

render();
requestAnimationFrame(frame);

// The React originals weigh 2MB (React and three.js), so they load when the section is near.
const extras = document.getElementById('extras');
const load = () => {
  const script = document.createElement('script');
  script.src = '/extras.js';
  script.onerror = () => (extras.textContent = 'Could not load the opt-in demos — run: node preview/build.mjs');
  document.body.append(script);
};
if ('IntersectionObserver' in window) {
  const watcher = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      watcher.disconnect();
      load();
    }
  }, { rootMargin: '600px' });
  watcher.observe(extras);
} else {
  load();
}
