/**
 * Using the app as its user would (ADR-031): on the page a question led to, find the control that starts
 * what was asked — "New event", the "Injuries" tab — and press it, or point at it.
 *
 * It reads the live page, the way a person does: what is on screen, and what each control is called.
 * No framework, no source, no setup — so it works on any web app, whatever it was built with. What the
 * app's source or its owner declared (`Capability.opens`) only adds confidence.
 *
 * ## What it may press, and what it only points at
 *
 * Pressing is a user's act on someone else's app, so it is held to evidence that the control **opens**
 * something rather than **does** something:
 *
 * - a **link** to a path on this site — it only navigates;
 * - a **tab** — it only shows another part of the page;
 * - a control that says it opens something: `aria-haspopup`, `aria-expanded`, `aria-controls`, `<summary>`;
 * - a control the registry declares as an opener (`opens`: read from the page's source, or written by
 *   the adopter in knowledge.json).
 *
 * Anything else — a plain "New invoice" button that might create a draft the moment it is pressed — is
 * **pointed at**, never pressed: the visitor presses it, one tap. A control whose name commits, removes or
 * pays (`BLOCKED`) is neither. Nothing is ever typed, and nothing inside a form is touched, so nothing is
 * ever submitted.
 *
 * Like `anchor.ts`, it would rather do nothing than the wrong thing: two equally good controls are
 * ambiguous, and ambiguous is nothing.
 */
import { safeRoute } from './present.ts';

/** The slice of an element this reads. `Element` satisfies it. */
export interface ActNode {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  closest(selector: string): ActNode | null;
}

/** The slice of a document this reads. `Document` satisfies it. */
export interface ActRoot {
  querySelectorAll(selector: string): ArrayLike<ActNode>;
}

/** What the visitor asked, reduced to what matters for finding a control: never the whole question. */
export interface Task {
  /** Content words of the question — and the app's words for them (its glossary) — normalised (`words`). At most 12. */
  readonly words: readonly string[];
  /**
   * The screen it led to, by its name in every language the app ships (`words`). At most 12. Weaker than
   * the question's own words: "schedule an event" on Calendar is about the event, not the calendar.
   */
  readonly place?: readonly string[];
  /** The question asked to start something: schedule, add, create, book… */
  readonly start: boolean;
}

/** The app's own term for what people say instead (knowledge.json `glossary`): `{ term, aliases }`. */
export interface Synonym {
  readonly term: string;
  readonly aliases?: readonly string[];
}

export type Evidence = 'link' | 'tab' | 'opens' | 'declared' | 'none';

export interface Control {
  readonly element: ActNode;
  readonly name: string;
  readonly evidence: Evidence;
}

export type Plan =
  | { readonly act: 'press'; readonly control: Control }
  | { readonly act: 'point'; readonly control: Control }
  | { readonly act: 'none'; readonly reason: 'nothing' | 'ambiguous' | 'not-a-task' };

/** Starting something, in English and Portuguese: in a question, and at the head of a control's name. */
const START = new Set([
  'new', 'add', 'create', 'schedule', 'book', 'request', 'invite', 'register', 'upload', 'start', 'make', 'compose',
  'write', 'plan', 'log', 'record', 'report', 'arrange', 'reserve', 'set',
  'novo', 'nova', 'novos', 'novas', 'adicionar', 'adiciona', 'criar', 'cria', 'agendar', 'agenda', 'marcar', 'marca',
  'pedir', 'pede', 'solicitar', 'solicita', 'convidar', 'convida', 'registar', 'regista', 'registrar', 'carregar',
  'iniciar', 'escrever', 'planear', 'reportar', 'reservar', 'reserva', 'lancar', 'inserir', 'insere',
]);

/**
 * A control whose name says it commits, removes, pays or leaves: never pressed and never pointed at, whatever
 * the question. The assistant helps someone start; the last step is always theirs.
 */
const BLOCKED = new Set([
  'delete', 'remove', 'cancel', 'pay', 'send', 'submit', 'save', 'confirm', 'approve', 'reject', 'decline', 'publish',
  'archive', 'logout', 'signout', 'discard', 'reset', 'clear', 'transfer', 'refund', 'purchase', 'buy', 'checkout',
  'order', 'accept', 'sign', 'leave', 'close', 'exit', 'revoke', 'block', 'ban', 'disable', 'deactivate', 'unsubscribe',
  'apagar', 'apaga', 'eliminar', 'elimina', 'remover', 'cancelar', 'cancela', 'pagar', 'paga', 'enviar', 'envia',
  'submeter', 'guardar', 'gravar', 'confirmar', 'aprovar', 'rejeitar', 'recusar', 'publicar', 'arquivar', 'sair',
  'terminar', 'limpar', 'repor', 'transferir', 'reembolsar', 'comprar', 'encomendar', 'aceitar', 'fechar', 'revogar',
  'bloquear', 'desativar',
]);

/** Leaving, whatever the verbs around it: "Log out", "Sign out", "Check out", "Terminar sessão". */
const BLOCKED_PHRASE = /\b(log ?out|sign ?out|check ?out|terminar sessao)\b/;

/** Words that say nothing about *what*: they never match a control to a question. */
const STOP = new Set([
  'a', 'an', 'the', 'to', 'i', 'want', 'would', 'like', 'need', 'please', 'my', 'me', 'for', 'of', 'in', 'on', 'at',
  'how', 'do', 'does', 'can', 'could', 'where', 'is', 'are', 'this', 'that', 'and', 'or', 'with', 'your', 'our', 'it',
  'some', 'one', 'go', 'take', 'show', 'see', 'page', 'screen', 'here', 'there', 'let', 'lets', 'get', 'help', 'find',
  'um', 'uma', 'uns', 'umas', 'o', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'para', 'pra', 'quero', 'queria',
  'preciso', 'por', 'favor', 'meu', 'minha', 'meus', 'minhas', 'como', 'onde', 'faco', 'fazer', 'posso', 'pode',
  'no', 'na', 'nos', 'nas', 'em', 'e', 'ou', 'com', 'que', 'se', 'eu', 'ver', 'ir', 'leva', 'levar', 'mostra',
  'mostrar', 'pagina', 'ecra', 'aqui', 'ai', 'ajuda', 'encontrar', 'gostaria', 'tenho',
]);

/** Lower case, no accents, no punctuation, a trailing plural dropped: "Eventos" and "events" meet. */
export function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/** Two words for one thing: equal, or one a short extension of the other ("event" and "evento"). */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short) && long.length - short.length <= 2;
}

const content = (list: readonly string[]): string[] => list.filter((w) => !STOP.has(w) && !BLOCKED.has(w));

/**
 * The task in a question: its content words, and whether it starts something. `places`: the screen it led to,
 * by every name the app gives it. `glossary`: the app's terms and what people say instead — "o meu filho" for
 * "educando" — so a control named in the app's word is found from the visitor's.
 */
export function taskOf(question: string, places: string | readonly (string | null | undefined)[] | null = [], glossary: readonly Synonym[] = []): Task {
  const asked = words(question.slice(0, 500));
  const start = asked.some((w) => START.has(w));
  // Start words stay: some are also names ("Agenda", "Reserva"), and a tab may be called by one.
  const said = content(asked);
  const flat = ` ${asked.join(' ')} `;
  for (const entry of glossary.slice(0, 200)) {
    const says = (entry.aliases ?? []).some((alias) => {
      const w = words(alias).join(' ');
      return w !== '' && flat.includes(` ${w} `);
    });
    if (says) said.push(...content(words(entry.term)));
  }
  const place = content((typeof places === 'string' ? [places] : (places ?? [])).flatMap((p) => words(p ?? '')));
  const unique = (list: string[]) => [...new Set(list)].slice(0, 12);
  return { words: unique(said), place: unique(place.filter((w) => !said.includes(w))), start };
}

/** The name a person reads on a control. Deliberately short: the label, else its text, else its title. */
function nameOf(el: ActNode): string {
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 80);
  return (el.getAttribute('title') ?? '').trim();
}

const CANDIDATES = ['button', 'a', 'summary', '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="link"]'];

/** On screen, usable, and the app's own: not ours, not hidden, not disabled, not in a form, not navigation. */
function usable(el: ActNode): boolean {
  if (el.closest('[data-nextgen]')) return false;
  if (el.closest('[hidden]') || el.closest('[aria-hidden="true"]') || el.closest('[inert]')) return false;
  if (el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true') return false;
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'submit' || type === 'reset') return false;
  // Inside a form, a button belongs to what is being filled in: never ours to press.
  if (el.closest('form')) return false;
  // The app's own navigation goes to other pages: the router already chose this one.
  if (el.closest('nav') || el.closest('[role="navigation"]')) return false;
  return true;
}

function evidenceOf(el: ActNode, declared: ReadonlySet<string>, name: string): Evidence {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'tab') return 'tab';
  if (tag === 'a' || role === 'link') {
    const href = el.getAttribute('href') ?? '';
    if (href.startsWith('/') && safeRoute(href) !== null) return 'link';
  }
  const popup = el.getAttribute('aria-haspopup');
  if ((popup !== null && popup !== 'false') || el.getAttribute('aria-controls') || el.getAttribute('aria-expanded') !== null || tag === 'summary') return 'opens';
  if (declared.has(words(name).join(' '))) return 'declared';
  return 'none';
}

/**
 * What to do on this page for this task. `declared`: the names the registry says open something here
 * (`Capability.opens`). `visible`: whether an element is on screen — the page decides; everything is, by default.
 */
export function planAct(task: Task, root: ActRoot, declared: readonly string[] = [], visible: (el: ActNode) => boolean = () => true): Plan {
  if (task.words.length === 0 && !(task.start && (task.place?.length ?? 0) > 0)) return { act: 'none', reason: 'not-a-task' };
  const known = new Set(declared.map((d) => words(d).join(' ')));
  const seen = new Set<ActNode>();
  const openers: { control: Control; score: number }[] = [];
  const tabs: { control: Control; score: number }[] = [];

  for (const selector of CANDIDATES) {
    const list = root.querySelectorAll(selector);
    for (let i = 0; i < list.length; i++) {
      const el = list[i]!;
      if (seen.has(el)) continue;
      seen.add(el);
      if (!usable(el) || !visible(el)) continue;
      const name = nameOf(el);
      if (!name) continue;
      const said = words(name);
      if (said.some((w) => BLOCKED.has(w)) || BLOCKED_PHRASE.test(said.join(' '))) continue;
      const evidence = evidenceOf(el, known, name);
      const control: Control = { element: el, name, evidence };
      const matched = (list: readonly string[], against: readonly string[] = task.words) => list.filter((w) => against.some((t) => same(w, t))).length;

      if (evidence === 'tab') {
        // A tab the question names, every word of it: "the injuries tab", "ver lesões". Never the one already open.
        if (el.getAttribute('aria-selected') === 'true') continue;
        const named = said.filter((w) => !STOP.has(w));
        if (named.length > 0 && matched(named) === named.length) tabs.push({ control, score: 2 + named.length });
        continue;
      }
      // What a starting control starts: its name without the verb ("New *event*"). The question's words count
      // in full; the screen's own name half — it says where, not what.
      const object = said.filter((w) => !STOP.has(w) && !START.has(w));
      const asked = matched(object);
      const placed = matched(object.filter((w) => !task.words.some((t) => same(w, t))), task.place ?? []);
      const overlap = asked + placed / 2;
      if (!task.start) continue;
      const starts = said.some((w) => START.has(w)) || /^\s*\+/.test(name) || evidence === 'declared';
      if (!starts) continue;
      // "New event" for "schedule an event"; a bare "New" or "+" only as the page's one way to start anything.
      const score = overlap > 0 ? 1 + overlap / object.length : object.length === 0 ? 0.5 : 0;
      if (score > 0) openers.push({ control, score });
    }
  }

  const pick = (list: { control: Control; score: number }[], weakAlone: boolean): Plan | null => {
    if (list.length === 0) return null;
    const ranked = [...list].sort((a, b) => b.score - a.score);
    const [best, next] = ranked as [(typeof ranked)[0], (typeof ranked)[0] | undefined];
    // Two different controls equally good: ambiguous. The same name twice (a header button and an empty
    // state's) is one thing offered twice: the first is fine.
    if (next && next.score === best.score && words(next.control.name).join(' ') !== words(best.control.name).join(' ')) {
      return { act: 'none', reason: 'ambiguous' };
    }
    if (weakAlone && best.score < 1 && list.length > 1) return { act: 'none', reason: 'ambiguous' };
    return { act: best.control.evidence === 'none' ? 'point' : 'press', control: best.control };
  };

  return pick(openers, true) ?? pick(tabs, false) ?? { act: 'none', reason: 'nothing' };
}
