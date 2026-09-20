// The opt-in section of /alive: the React originals, running as published.
//
// None of this is in the script tag. These are React components and four of the five inject a
// <style> element, which a strict Content-Security-Policy blocks; a React runtime is also not
// something a page with no build step carries. They are here so the difference is visible:
// what the default gives an adopter, and what more the family could give one who has React.
//
// Loaded on demand (alive.js), because three.js alone is most of the weight.

import React, { Component, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BorderBeam } from 'border-beam';
import { VoiceBeam } from 'voice-glow';
import { Liquid } from 'liquid-gooey';
import { MetalFx, isMetalFxSupported } from 'metal-fx';
import { ImageGeneration } from 'img-fx';

const html = document.documentElement;

/** The page's theme and accent, live — the look book changes them under us. */
function usePage() {
  const read = () => ({ theme: html.dataset.theme === 'light' ? 'light' : 'dark', accent: html.style.getPropertyValue('--accent') || '#79c0ce' });
  const [page, setPage] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setPage(read()));
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);
  return page;
}

/** One misbehaving library (no WebGL, a headless browser) must not take the others down. */
class Guard extends Component {
  state = { failed: null };
  static getDerivedStateFromError(error) {
    return { failed: String(error?.message ?? error) };
  }
  render() {
    return this.state.failed ? <p className="why">Could not run here: {this.state.failed}</p> : this.props.children;
  }
}

/** A heavy demo waits for a click. A full-card shader can stall a machine with no GPU, and a look book must not. */
function OnRequest({ children }) {
  const [running, setRunning] = useState(new URLSearchParams(location.search).get('run') === '1');
  if (running) return children;
  return (
    <div style={{ textAlign: 'center' }}>
      <button type="button" className="run" onClick={() => setRunning(true)}>Run the demo</button>
      <p className="why" style={{ margin: '.75rem 0 0' }}>A full-card WebGL shader. It can stall a machine without a GPU, so it waits to be asked.</p>
    </div>
  );
}

const Field = ({ children }) => (
  <div className="composer" style={{ width: '100%' }}>
    <input type="text" placeholder="Ask for anything…" aria-label="Ask" />
    {children}
  </div>
);

function BorderBeamDemo() {
  const { theme } = usePage();
  return (
    <BorderBeam size="line" theme={theme}>
      <Field />
    </BorderBeam>
  );
}

function VoiceGlowDemo() {
  const { theme } = usePage();
  const level = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = (now) => {
      const t = now / 1000;
      level.current = Math.max(0, Math.sin(t * 1.15)) * (0.55 + 0.45 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <VoiceBeam level={() => level.current} theme={theme}>
      <Field />
    </VoiceBeam>
  );
}

const round = { width: 56, height: 56, borderRadius: '50%', border: 0, cursor: 'pointer', color: '#07171b', font: '600 18px system-ui', display: 'grid', placeItems: 'center' };

function GooeyDemo() {
  const { accent, theme } = usePage();
  const [open, setOpen] = useState(false);
  const fill = accent;
  const spot = { position: 'absolute', left: 82, top: 84 };
  const button = (label, glyph) => (
    <button type="button" aria-label={label} style={{ ...round, background: 'transparent', color: theme === 'dark' ? '#07171b' : '#fff' }} onClick={() => setOpen(false)}>
      {glyph}
    </button>
  );
  return (
    <>
      {/* The group is its own positioned box: give it a size, and place the items inside it. */}
      <Liquid blur={6} contrast={18} fill={fill} style={{ width: 220, height: 170 }}>
        <Liquid.Item x={open ? -64 : 0} y={open ? -44 : 0} transition="bouncy" style={spot}>{button('Guide me', '?')}</Liquid.Item>
        <Liquid.Item x={0} y={open ? -78 : 0} transition="bouncy" delay={40} style={spot}>{button('Ask', '✦')}</Liquid.Item>
        <Liquid.Item x={open ? 64 : 0} y={open ? -44 : 0} transition="bouncy" delay={80} style={spot}>{button('Speak', '●')}</Liquid.Item>
        <Liquid.Item transition="bouncy" style={spot}>
          <button type="button" aria-label={open ? 'Close' : 'Open'} aria-expanded={open} style={{ ...round, background: 'transparent', color: theme === 'dark' ? '#07171b' : '#fff' }} onClick={() => setOpen(!open)}>
            {open ? '×' : '+'}
          </button>
        </Liquid.Item>
      </Liquid>
    </>
  );
}

function MetalDemo() {
  const supported = isMetalFxSupported();
  const button = (
    <button type="button" style={{ padding: '.7rem 1.6rem', borderRadius: 999, border: 0, background: '#0d0f13', color: '#fff', font: '600 .95rem system-ui', cursor: 'pointer' }}>
      Ask the assistant
    </button>
  );
  return (
    <>
      <MetalFx variant="button">{button}</MetalFx>
      {supported ? null : <p className="why" style={{ marginTop: '.75rem' }}>This browser has no WebGL2, so it renders the plain button — which is what an adopter's visitor without it would get.</p>}
    </>
  );
}

const picture = (a, b) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="320" height="320" fill="url(#g)"/><circle cx="220" cy="100" r="56" fill="rgba(255,255,255,.35)"/></svg>`);

function ImageDemo() {
  const { theme } = usePage();
  return (
    <ImageGeneration preset="pixels-organic" theme={theme} images={[picture('#3b82f6', '#a855f7'), picture('#f59e0b', '#ef4444')]} autoReveal>
      <div style={{ width: 220, height: 220, borderRadius: 20 }} />
    </ImageGeneration>
  );
}

const DEMOS = [
  {
    title: 'border-beam',
    says: 'The original of the light our composer wears while it thinks. Ours is a rebuild in CSS, because the original injects a <style> element and needs React.',
    demo: BorderBeamDemo,
  },
  {
    title: 'voice-glow',
    says: 'The original of the glow that rises with the voice. Same reason for the rebuild; the level here is simulated.',
    demo: VoiceGlowDemo,
  },
  {
    title: 'liquid-gooey',
    says: 'Buttons that split like droplets. A fan of quick actions from the orb would be the natural home. Needs React.',
    demo: GooeyDemo,
  },
  {
    title: 'metal-fx',
    says: 'A WebGL liquid-metal ring for one primary action. It needs WebGL2 and React, and it is loud: a brand decision, not a default.',
    demo: MetalDemo,
  },
  {
    title: 'img-fx',
    says: 'A generating shimmer that reveals an image. A navigation assistant makes no images, so it has nowhere to live yet.',
    demo: ImageDemo,
    onRequest: true,
  },
];

// /alive?extras=border-beam,voice-glow shows only those — the WebGL ones are heavy on a machine without a GPU.
const only = new URLSearchParams(location.search).get('extras')?.split(',');

function Extras() {
  return DEMOS.filter((d) => !only || only.includes(d.title)).map(({ title, says, demo: Demo, onRequest }) => (
    <article className="extra" key={title}>
      <h3>{title}</h3>
      <p className="why">{says}</p>
      <div className="demo">
        <Guard>{onRequest ? <OnRequest><Demo /></OnRequest> : <Demo />}</Guard>
      </div>
    </article>
  ));
}

const host = document.getElementById('extras');
host.replaceChildren();
createRoot(host).render(<Extras />);
