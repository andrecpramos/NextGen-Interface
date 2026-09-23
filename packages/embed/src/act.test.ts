import { describe, expect, it } from 'vitest';

import { planAct, taskOf, words, type Plan } from './act.ts';
import { FakeDocument, type FakeElement } from './test-support/fake-dom.ts';

/**
 * ADR-031. On the page a question led to, the control that starts what was asked: pressed when it can
 * only open something, pointed at when it might do something, left alone when it commits, and nothing at
 * all when two are equally likely. Every case is a page an app could really render.
 */

type Spec = { tag?: string; text?: string; attrs?: Record<string, string>; kids?: Spec[] };

function page(...specs: Spec[]): FakeDocument {
  const doc = new FakeDocument();
  const build = (spec: Spec): FakeElement => {
    const el = doc.createElement(spec.tag ?? 'button');
    for (const [k, v] of Object.entries(spec.attrs ?? {})) el.setAttribute(k, v);
    if (spec.text) el.textContent = spec.text;
    for (const kid of spec.kids ?? []) el.append(build(kid));
    return el;
  };
  for (const spec of specs) doc.body.append(build(spec));
  return doc;
}

const plan = (question: string, doc: FakeDocument, destination: string | null = null, declared: string[] = []): Plan =>
  planAct(taskOf(question, destination), doc, declared);
const named = (p: Plan) => (p.act === 'none' ? p.reason : `${p.act}: ${p.control.name}`);

describe('what a question asks to start', () => {
  it('keeps what the question is about, in either language, and whether it starts something', () => {
    expect(taskOf('I want to schedule an event')).toEqual({ words: ['schedule', 'event'], place: [], start: true });
    expect(taskOf('Quero marcar um treino', 'Calendário')).toEqual({ words: ['marcar', 'treino'], place: ['calendario'], start: true });
    expect(taskOf('where are the injuries?').start).toBe(false);
  });

  it('reads accents, case and plurals alike', () => {
    expect(words('Novos Eventos!')).toEqual(['novo', 'evento']);
  });
});

describe('pressing — only what can only open something', () => {
  it('presses a control that says it opens a dialog', () => {
    const doc = page({ text: 'New event', attrs: { 'aria-haspopup': 'dialog' } }, { text: 'Export' });
    expect(named(plan('schedule an event', doc))).toBe('press: New event');
  });

  it('matches across the two languages: "event" and "Novo evento"', () => {
    const doc = page({ text: 'Novo evento', attrs: { 'aria-expanded': 'false' } });
    expect(named(plan('I want to schedule an event', doc))).toBe('press: Novo evento');
  });

  it('presses a link to a page of this site that starts it', () => {
    const doc = page({ tag: 'a', text: 'Add player', attrs: { href: '/squad/new' } });
    expect(named(plan('add a player', doc))).toBe('press: Add player');
  });

  it('presses a plain button the app declared opens something', () => {
    const doc = page({ text: 'Novo evento' });
    expect(named(plan('marcar um evento', doc, null, ['Novo evento']))).toBe('press: Novo evento');
  });

  it('opens the tab the question names — never the one already open', () => {
    const doc = page(
      { tag: 'div', attrs: { role: 'tab', 'aria-selected': 'true' }, text: 'Overview' },
      { tag: 'div', attrs: { role: 'tab', 'aria-selected': 'false' }, text: 'Injuries' },
    );
    expect(named(plan('where do I see the injuries', doc))).toBe('press: Injuries');
    expect(named(plan('show me the overview', doc))).toBe('nothing');
  });
});

describe('pointing — what might do something is the visitor’s to press', () => {
  it('points at a plain "New invoice" button: it may create a draft the moment it is pressed', () => {
    const doc = page({ text: 'New invoice' });
    expect(named(plan('create an invoice', doc))).toBe('point: New invoice');
  });

  it('points at a link that leaves the site rather than following it', () => {
    const doc = page({ tag: 'a', text: 'Add event', attrs: { href: 'https://elsewhere.example/new' } });
    expect(named(plan('add an event', doc))).toBe('point: Add event');
  });
});

describe('never — whatever the question', () => {
  it('never presses or points at a control that commits, removes, pays or leaves', () => {
    for (const text of ['Delete event', 'Save event', 'Send invitation', 'Pay fees', 'Cancelar evento', 'Log out', 'Guardar']) {
      const doc = page({ text, attrs: { 'aria-haspopup': 'dialog' } });
      expect(named(plan(`${text} please, add event`, doc)), text).toBe('nothing');
    }
  });

  it('never touches a control inside a form, a submit, a disabled one, a hidden one, or its own', () => {
    const doc = page(
      { tag: 'form', kids: [{ text: 'New event', attrs: { 'aria-haspopup': 'dialog' } }] },
      { text: 'New event', attrs: { type: 'submit' } },
      { text: 'New event', attrs: { disabled: '' } },
      { tag: 'div', attrs: { hidden: '' }, kids: [{ text: 'New event', attrs: { 'aria-haspopup': 'dialog' } }] },
      { tag: 'div', attrs: { 'data-nextgen': '' }, kids: [{ text: 'New event', attrs: { 'aria-haspopup': 'dialog' } }] },
    );
    expect(named(plan('schedule an event', doc))).toBe('nothing');
  });

  it('leaves the app’s own navigation alone: the router already chose the page', () => {
    const doc = page({ tag: 'nav', kids: [{ tag: 'a', text: 'New event', attrs: { href: '/events/new' } }] });
    expect(named(plan('schedule an event', doc))).toBe('nothing');
  });

  it('does nothing when the question does not ask to start anything', () => {
    const doc = page({ text: 'New event', attrs: { 'aria-haspopup': 'dialog' } });
    expect(named(plan('where is the calendar', doc))).toBe('nothing');
  });
});

describe('ambiguous is nothing', () => {
  it('two different controls equally likely: neither', () => {
    const doc = page({ text: 'New training', attrs: { 'aria-haspopup': 'dialog' } }, { text: 'New match', attrs: { 'aria-haspopup': 'dialog' } });
    expect(named(plan('schedule an event', doc))).toBe('nothing');
    expect(named(plan('schedule a training', doc))).toBe('press: New training');
  });

  it('the same control offered twice (a header and an empty state) is one', () => {
    const doc = page({ text: 'New event', attrs: { 'aria-haspopup': 'dialog' } }, { text: 'New event', attrs: { 'aria-haspopup': 'dialog' } });
    expect(named(plan('schedule an event', doc))).toBe('press: New event');
  });

  it('a bare "+" or "New" only when it is the page’s one way to start anything', () => {
    expect(named(plan('schedule an event', page({ text: '+', attrs: { 'aria-label': 'New', 'aria-haspopup': 'menu' } })))).toBe('press: New');
    const two = page({ text: 'New', attrs: { 'aria-haspopup': 'menu' } }, { text: 'Add', attrs: { 'aria-haspopup': 'menu' } });
    expect(named(plan('schedule an event', two))).toBe('ambiguous');
  });
});

/**
 * The visitor's words, the screen's every name, and the app's own words for things. The first say what; the
 * screen's name only says where — and it is how a visitor writing English finds a control in Portuguese.
 */
describe('what to match a control against', () => {
  it('finds the control by the screen’s name in the app’s other language', () => {
    const doc = page({ text: 'Novo anúncio', attrs: { 'aria-haspopup': 'dialog' } });
    const task = taskOf('I want to create one', ['Anúncios', 'Announcements']);
    expect(named(planAct(task, doc))).toBe('press: Novo anúncio');
  });

  it('lets the visitor’s own words outrank the screen’s name', () => {
    const doc = page({ text: 'New calendar', attrs: { 'aria-haspopup': 'dialog' } }, { text: 'New event', attrs: { 'aria-haspopup': 'dialog' } });
    expect(named(planAct(taskOf('schedule an event', ['Calendar']), doc))).toBe('press: New event');
  });

  it('reads what people say as what the app calls it (its glossary)', () => {
    const doc = page({ text: 'Adicionar educando', attrs: { 'aria-haspopup': 'dialog' } });
    const glossary = [{ term: 'educando', aliases: ['o meu filho', 'filho'] }];
    expect(named(planAct(taskOf('quero adicionar o meu filho', [], glossary), doc))).toBe('press: Adicionar educando');
    expect(named(planAct(taskOf('quero adicionar o meu filho'), doc))).toBe('nothing');
  });
});
