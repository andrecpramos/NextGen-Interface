// The bench's own surface: ask, and see the whole trace.
//
// Deliberately NOT the shipped widget. The widget is what a visitor sees and is judged on
// the app pages, where it mounts over a real page; this is the instrument next to it. Two
// surfaces, because a bench that only shows what a user sees cannot answer "why did it do
// that", and a widget that shows margins and stage latencies is not a product.
//
// It routes through `NextGen.create` — the same entry point the script tag uses — so a
// decision seen here is the decision an adopter gets.

const role = document.body.dataset.role;
const $ = (id) => document.getElementById(id);

const fmt = (n, digits = 3) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—');
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Outcomes worth flagging in amber: nothing happened the user asked for. */
const AMBER = new Set(['out_of_scope', 'clarify', 'error']);

const turns = [];
let assistant = null;

/** `byId` is a Map in the loaded registry; fall back to a scan if that ever changes. */
const byId = (id) => {
  if (!id || !assistant) return null;
  const index = assistant.registry?.byId;
  if (index && typeof index.get === 'function') return index.get(id) ?? null;
  return (assistant.registry?.capabilities ?? []).find((c) => c.id === id) ?? null;
};

function pill(text, amber = false) {
  return `<span class="pill${amber ? ' warn' : ''}">${escape(text)}</span>`;
}

function renderTurns(selected) {
  $('turns').innerHTML = turns
    .map((t, i) => {
      const amber = AMBER.has(t.trace.outcome ?? '');
      return `<li class="turn" role="option" data-i="${i}" tabindex="0" aria-selected="${i === selected}">
        <q>${escape(t.utterance)}</q>
        <div class="meta">
          ${pill(t.trace.outcome ?? 'none', amber)}${pill(t.trace.decidedAt ?? '—')}
          ${escape(t.trace.route ?? t.trace.capabilityId ?? 'nowhere')}
        </div>
      </li>`;
    })
    .reverse()
    .join('');
}

function renderWhy(turn) {
  if (!turn) {
    $('why').innerHTML = '<p class="empty">Ask something to see how it decided.</p>';
    return;
  }
  const t = turn.trace;
  const latency = t.latency ?? {};
  const stages = Object.entries(latency)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${v.toFixed(1)}ms`)
    .join(' · ');

  // Candidates are what stage 2 scored. They carry only `capabilityId` and `score`, so
  // the title and description are resolved here — and the description is shown because it
  // is the largest part of what stage 2 embedded, which makes it the usual cause when two
  // screens score within a hair of each other.
  const candidates = (t.candidates ?? []).slice(0, 8);
  const table = candidates.length
    ? `<table>
         <thead><tr><th>Screen</th><th>What it says it is</th><th class="num">Score</th></tr></thead>
         <tbody>${candidates
           .map((c) => {
             const cap = byId(c.capabilityId);
             return `<tr${c.capabilityId === t.capabilityId ? ' class="picked"' : ''}>
               <td>${escape(cap?.title ?? c.capabilityId ?? '—')}<br><code>${escape(c.capabilityId ?? '')}</code></td>
               <td>${escape(cap?.description ?? '')}</td>
               <td class="num">${fmt(c.score)}</td>
             </tr>`;
           })
           .join('')}</tbody>
       </table>`
    : '<p class="empty">No candidate was scored — stage 1 matched a phrase outright, so stage 2 never ran.</p>';

  const notes = (t.notes ?? []).length
    ? `<p class="sub" style="margin:14px 0 0">${t.notes.map(escape).join('<br>')}</p>`
    : '';

  $('why').innerHTML = `
    <dl>
      <dt>Outcome</dt><dd>${escape(t.outcome ?? 'none')}</dd>
      <dt>Decided at</dt><dd>${escape(t.decidedAt ?? '—')}</dd>
      <dt>Capability</dt><dd>${escape(t.capabilityId ?? '—')}</dd>
      <dt>Route</dt><dd>${escape(t.route ?? '—')}</dd>
      <dt>Top score</dt><dd>${fmt(t.topScore)}</dd>
      <dt>Margin</dt><dd>${fmt(t.margin)}</dd>
      <dt>Latency</dt><dd>${escape(stages || '—')}</dd>
      ${t.explanation ? `<dt>Explanation</dt><dd style="font-family:inherit">${escape(t.explanation)}</dd>` : ''}
    </dl>
    ${table}
    ${notes}`;
}

function select(i) {
  renderTurns(i);
  renderWhy(turns[i]);
}

async function ask(utterance) {
  const text = utterance.trim();
  if (!text || !assistant) return;
  const trace = await assistant.route(text, { route: '/', today: new Date().toISOString().slice(0, 10) });
  turns.push({ utterance: text, trace });
  select(turns.length - 1);
  $('q').value = '';
  $('q').focus();
}

$('ask').addEventListener('submit', (event) => {
  event.preventDefault();
  void ask($('q').value);
});

$('turns').addEventListener('click', (event) => {
  const li = event.target.closest('[data-i]');
  if (li) select(Number(li.dataset.i));
});
$('turns').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const li = event.target.closest('[data-i]');
  if (!li) return;
  event.preventDefault();
  select(Number(li.dataset.i));
});

// The registry's own example phrasings, which is what the deterministic stages match
// against. Clicking one should always settle — if it does not, that is a real finding.
function showExamples() {
  const caps = assistant.registry?.capabilities ?? [];
  const picked = [];
  for (const c of caps) {
    const first = (c.examples ?? [])[0];
    if (typeof first === 'string') picked.push(first);
    if (picked.length >= 6) break;
  }
  $('examples').innerHTML = picked
    .map((e) => `<li><button type="button" class="ghost">${escape(e)}</button></li>`)
    .join('');
  $('examples').addEventListener('click', (event) => {
    if (event.target.tagName === 'BUTTON') void ask(event.target.textContent);
  });
}

/**
 * `?ask=…` routes on load, so a turn worth discussing can be linked to or screenshotted.
 *
 * `data-bench` on <body> then carries what happened, as JSON. That is what lets a headless
 * browser check this page really routes rather than merely renders — the same trick
 * `check-csp.mjs` uses, and the reason the bench is verifiable at all.
 */
function publish(state) {
  document.body.dataset.bench = JSON.stringify(state);
}

NextGen.load('/nextgen', role)
  .then(async (a) => {
    assistant = a;
    showExamples();
    const asked = new URLSearchParams(location.search).get('ask');
    if (asked) await ask(asked);
    else $('q').focus();
    const last = turns[turns.length - 1];
    publish({
      ready: true,
      role,
      capabilities: a.capabilities,
      asked: asked ?? null,
      outcome: last?.trace.outcome ?? null,
      decidedAt: last?.trace.decidedAt ?? null,
      capabilityId: last?.trace.capabilityId ?? null,
      route: last?.trace.route ?? null,
      candidates: (last?.trace.candidates ?? []).length,
    });
  })
  .catch((error) => {
    $('why').innerHTML = `<p class="empty">Could not load the bundle for ${escape(role)}: ${escape(error.message)}</p>`;
    publish({ ready: false, role, error: error.message });
  });
