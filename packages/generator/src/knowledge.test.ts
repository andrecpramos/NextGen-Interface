import { describe, expect, it } from 'vitest';

import { applyKnowledge, EMPTY_KNOWLEDGE, knowledgeBoundaries, knowledgeGaps, parseKnowledge } from './knowledge.ts';
import type { AnnotatedCapability } from './types.ts';

/**
 * The adopter's own account of their app: what each screen is for, what is on it, what their
 * users call it and what they ask. It is the one input to the generator that is *written*
 * rather than read, so it arrives as untrusted JSON (parse, never cast) and is merged
 * deterministically, offline, into the fields stage 2 already indexes.
 */

const cap = (over: Partial<AnnotatedCapability> & { id: string; route: string; title: string }): AnnotatedCapability =>
  ({
    kind: 'navigate',
    description: `${over.title} is a screen in this application.`,
    explanation: `${over.title} is a screen in this application.`,
    examples: ['a', 'b', 'c'],
    roles: ['PARENT'],
    ...over,
  }) as AnnotatedCapability;

const medical = cap({ id: 'guardian.medical', route: '/my/children/medical', title: 'Estado Médico' });
const children = cap({ id: 'guardian.children', route: '/my/children', title: 'Os Meus Educandos' });
const news = cap({ id: 'comms.news', route: '/my/announcements', title: 'Anúncios' });

const file = {
  app: { name: 'Clube FC', about: 'Gestão de um clube: os pais acompanham os filhos, os treinadores gerem o plantel.' },
  glossary: [{ term: 'educando', means: 'um jovem atleta ao cuidado de um encarregado', aliases: ['filho', 'filha', 'criança'] }],
  screens: {
    '/my/children/medical': {
      purpose: 'Onde o encarregado vê a saúde do educando: lesões, alergias e aptidão.',
      contains: ['lesões', 'alergias', 'aptidão médica'],
      aliases: ['ficha médica', 'enfermaria'],
      askedAs: ['o meu filho magoou-se', 'onde ficam as alergias', 'ver lesões'],
    },
  },
};

describe('parseKnowledge — a file somebody wrote', () => {
  it('reads a well-formed file without complaint', () => {
    const { knowledge, problems } = parseKnowledge(file);
    expect(problems).toEqual([]);
    expect(knowledge.app.about).toContain('Gestão de um clube');
    expect(knowledge.glossary[0]!.aliases).toEqual(['filho', 'filha', 'criança']);
    expect(knowledge.screens['/my/children/medical']!.askedAs).toHaveLength(3);
  });

  it('accepts an empty object: nothing is required, and everything is a gap instead', () => {
    const { knowledge, problems } = parseKnowledge({});
    expect(problems).toEqual([]);
    expect(knowledge).toEqual(EMPTY_KNOWLEDGE);
  });

  it('survives what is not a file at all, and says so', () => {
    for (const raw of [null, undefined, 42, 'text', [1, 2]]) {
      const { knowledge, problems } = parseKnowledge(raw);
      expect(knowledge).toEqual(EMPTY_KNOWLEDGE);
      expect(problems[0]!.path).toBe('');
    }
  });

  it('drops an entry of the wrong type, keeps the rest, and names where it was', () => {
    const { knowledge, problems } = parseKnowledge({
      screens: { '/a': { purpose: 7, contains: 'one', askedAs: ['ok', 3, null, 'also ok'], aliases: {} } },
    });
    expect(knowledge.screens['/a']!.purpose).toBeNull();
    expect(knowledge.screens['/a']!.contains).toEqual(['one']);
    expect(knowledge.screens['/a']!.askedAs).toEqual(['ok', 'also ok']);
    expect(problems.map((p) => p.path).sort()).toEqual(['screens./a.aliases', 'screens./a.askedAs[1]', 'screens./a.askedAs[2]', 'screens./a.purpose']);
  });

  it('tolerates a single string where a list belongs — the way people write these', () => {
    const { knowledge, problems } = parseKnowledge({ screens: { '/a': { askedAs: 'onde vejo isto' } } });
    expect(problems).toEqual([]);
    expect(knowledge.screens['/a']!.askedAs).toEqual(['onde vejo isto']);
  });

  it('cleans text: control characters gone, whitespace collapsed, length capped', () => {
    const { knowledge, problems } = parseKnowledge({
      app: { about: `  a\u0000b\u0007   c\n\nd  ${'x'.repeat(2000)}` },
    });
    expect(knowledge.app.about!.startsWith('ab c d ')).toBe(true);
    expect(knowledge.app.about!.length).toBeLessThanOrEqual(600);
    expect(problems.some((p) => p.path === 'app.about' && /long/.test(p.message))).toBe(true);
  });

  it('caps how much one file can carry, so a hostile or runaway file cannot bloat every registry', () => {
    const screens = Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`/s${i}`, { askedAs: Array.from({ length: 200 }, (_, j) => `q${j}`) }]));
    const { knowledge, problems } = parseKnowledge({ screens, glossary: Array.from({ length: 900 }, (_, i) => ({ term: `t${i}`, aliases: ['x'] })) });
    expect(Object.keys(knowledge.screens).length).toBeLessThanOrEqual(500);
    expect(knowledge.glossary.length).toBeLessThanOrEqual(200);
    expect(knowledge.screens['/s0']!.askedAs.length).toBeLessThanOrEqual(40);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('will not let a key rewrite what objects are', () => {
    const raw = JSON.parse('{"screens":{"__proto__":{"purpose":"x"},"constructor":{"purpose":"y"},"/ok":{"purpose":"fine"}}}');
    const { knowledge, problems } = parseKnowledge(raw);
    expect(Object.keys(knowledge.screens)).toEqual(['/ok']);
    expect(({} as Record<string, unknown>).purpose).toBeUndefined();
    expect(problems.length).toBe(2);
  });

  it('points at a mistyped top-level key rather than silently ignoring the section', () => {
    const { problems } = parseKnowledge({ screen: { '/a': { purpose: 'x' } } });
    expect(problems[0]).toMatchObject({ path: 'screen' });
    expect(problems[0]!.message).toMatch(/unknown/i);
  });
});

describe('applyKnowledge — merged into what stage 2 indexes', () => {
  const { knowledge } = parseKnowledge(file);

  it('adds what the screen is for, what is on it and what it is called to its description', () => {
    const { capabilities } = applyKnowledge([medical, children, news], knowledge);
    const m = capabilities.find((c) => c.id === 'guardian.medical')!;
    for (const word of ['lesões', 'alergias', 'aptidão', 'enfermaria', 'ficha médica']) expect(m.description).toContain(word);
    expect(m.description.startsWith(medical.description)).toBe(true);
  });

  it('adds the phrases people use as examples, once, keeping what was there', () => {
    const noisy = { ...knowledge, screens: { '/my/children/medical': { ...knowledge.screens['/my/children/medical']!, askedAs: ['O meu filho magoou-se', 'o meu filho magoou-se', 'a', 'onde ficam as alergias'] } } };
    const m = applyKnowledge([medical], noisy).capabilities[0]!;
    expect(m.examples).toEqual(['a', 'b', 'c', 'O meu filho magoou-se', 'onde ficam as alergias']);
  });

  it('serves the adopter’s own words as the explanation, and says where they came from', () => {
    const m = applyKnowledge([medical], knowledge).capabilities[0]!;
    expect(m.explanation).toBe('Onde o encarregado vê a saúde do educando: lesões, alergias e aptidão.');
    expect(m.explanationSource).toBe('knowledge.json');
  });

  it('gives a screen the everyday words for a term it mentions, and no other screen', () => {
    const { capabilities } = applyKnowledge([medical, children, news], knowledge);
    const byId = Object.fromEntries(capabilities.map((c) => [c.id, c]));
    expect(byId['guardian.medical']!.description).toContain('criança');
    expect(byId['comms.news']!.description).not.toContain('criança');
  });

  it('matches a screen by its route or by its id', () => {
    const byId = parseKnowledge({ screens: { 'comms.news': { purpose: 'Novidades do clube.' } } }).knowledge;
    expect(applyKnowledge([news], byId).capabilities[0]!.explanation).toBe('Novidades do clube.');
  });

  it('leaves alone every screen it knows nothing about, and never changes what a screen is', () => {
    const { capabilities } = applyKnowledge([medical, children, news], knowledge);
    expect(capabilities.find((c) => c.id === 'comms.news')).toEqual(news);
    for (const c of capabilities) {
      const before = [medical, children, news].find((x) => x.id === c.id)!;
      expect([c.id, c.kind, c.route, c.title, c.roles]).toEqual([before.id, before.kind, before.route, before.title, before.roles]);
    }
  });

  it('reports knowledge about screens that are not there — a typo, or a page that was removed', () => {
    const stale = parseKnowledge({ screens: { '/my/children/medicl': { purpose: 'x' }, '/gone': { purpose: 'y' } } }).knowledge;
    expect(applyKnowledge([medical], stale).unmatched).toEqual(['/gone', '/my/children/medicl']);
  });

  it('does not touch what it was given, and gives the same answer every time', () => {
    const before = JSON.stringify([medical, children, news]);
    const a = applyKnowledge([medical, children, news], knowledge);
    const b = applyKnowledge([medical, children, news], knowledge);
    expect(JSON.stringify([medical, children, news])).toBe(before);
    expect(a).toEqual(b);
  });

  it('is a no-op for an app that has written nothing', () => {
    expect(applyKnowledge([medical, news], EMPTY_KNOWLEDGE).capabilities).toEqual([medical, news]);
  });

  it('keeps every screen at three examples or more, which the registry requires', () => {
    for (const c of applyKnowledge([medical, children, news], knowledge).capabilities) expect((c.examples ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('knowledgeGaps — what the scanner does not know, for the agent to ask about', () => {
  const screens = [medical, children, news];

  it('with no file at all: every screen is unknown, and so is the app', () => {
    const { gaps, coverage } = knowledgeGaps(screens, EMPTY_KNOWLEDGE);
    expect(gaps.filter((g) => g.kind === 'screen-unknown').map((g) => g.route)).toEqual(['/my/children/medical', '/my/children', '/my/announcements']);
    expect(gaps.some((g) => g.kind === 'app-about-missing')).toBe(true);
    expect(coverage).toEqual({ screens: 3, withPurpose: 0, withPhrasing: 0 });
  });

  it('names what is missing on a screen that is only half described', () => {
    const half = parseKnowledge({ app: { about: 'x' }, screens: { '/my/children/medical': { askedAs: ['uma'] }, '/my/children': { purpose: 'Os filhos.' } } }).knowledge;
    const { gaps, coverage } = knowledgeGaps(screens, half);
    const kinds = (route: string) => gaps.filter((g) => g.route === route).map((g) => g.kind);
    expect(kinds('/my/children/medical')).toEqual(['purpose-missing', 'phrasing-thin']);
    expect(kinds('/my/children')).toEqual(['phrasing-thin']);
    expect(kinds('/my/announcements')).toEqual(['screen-unknown']);
    expect(coverage).toEqual({ screens: 3, withPurpose: 1, withPhrasing: 0 });
  });

  it('says so when a screen is fully described, and reports nothing for it', () => {
    const { gaps, coverage } = knowledgeGaps([medical], parseKnowledge(file).knowledge);
    expect(gaps.filter((g) => g.route === '/my/children/medical')).toEqual([]);
    expect(coverage).toEqual({ screens: 1, withPurpose: 1, withPhrasing: 1 });
  });

  it('lists knowledge that points at nothing, so it can be fixed rather than trusted', () => {
    const { gaps } = knowledgeGaps([medical], parseKnowledge({ app: { about: 'x' }, screens: { '/gone': { purpose: 'y' } } }).knowledge);
    expect(gaps).toContainEqual(expect.objectContaining({ kind: 'knowledge-orphan', route: '/gone' }));
  });

  it('asks about a screen once, not once per role that can reach it', () => {
    const twice = [medical, { ...medical, roles: ['COACH'] }] as AnnotatedCapability[];
    expect(knowledgeGaps(twice, EMPTY_KNOWLEDGE).gaps.filter((g) => g.kind === 'screen-unknown')).toHaveLength(1);
  });
});

const payments = {
  about: 'Pagamentos e quotas',
  say: 'Não trato de pagamentos. As quotas são geridas pela secretaria do clube.',
  askedAs: ['quanto tenho de pagar este mês', 'pagar a quota do meu filho', 'em que dia vence a mensalidade'],
};

describe('cannot — what the app does not do, in the adopter’s words', () => {
  it('reads a declared limit: what it is about, what to say, and what people ask', () => {
    const { knowledge, problems } = parseKnowledge({ cannot: [payments] });
    expect(problems).toEqual([]);
    expect(knowledge.cannot).toEqual([payments]);
  });

  it('drops a limit with nothing to say, or too little to be recognised, and names why', () => {
    const { knowledge, problems } = parseKnowledge({
      cannot: [{ about: 'x', askedAs: ['a', 'b', 'c'] }, { about: 'y', say: 'no', askedAs: ['one', 'two'] }, { say: 'no', askedAs: ['a', 'b', 'c'] }, 'nope'],
    });
    expect(knowledge.cannot).toEqual([]);
    expect(problems.map((p) => p.path).sort()).toEqual(['cannot[0]', 'cannot[1]', 'cannot[2]', 'cannot[3]']);
    expect(problems.find((p) => p.path === 'cannot[1]')!.message).toMatch(/at least 3/);
  });

  it('becomes a declared limit in every registry: no route, the adopter’s refusal, their phrasing as examples', () => {
    const [limit] = knowledgeBoundaries(parseKnowledge({ cannot: [payments] }).knowledge);
    expect(limit).toMatchObject({ kind: 'unsupported', route: null, title: 'Pagamentos e quotas', refusal: payments.say });
    expect(limit!.id).toMatch(/^unsupported.declared.pagamentos_e_quotas$/);
    expect(limit!.examples).toEqual(payments.askedAs);
    expect(limit!.description).toContain('Pagamentos e quotas');
    expect(limit!.description).toContain('em que dia vence a mensalidade');
  });

  it('gives two limits about the same thing two ids, and the same ones every time', () => {
    const two = parseKnowledge({ cannot: [payments, { ...payments, say: 'outra' }] }).knowledge;
    const a = knowledgeBoundaries(two);
    expect(new Set(a.map((c) => c.id)).size).toBe(2);
    expect(knowledgeBoundaries(two)).toEqual(a);
  });

  it('is nothing at all for an app that declared no limits', () => {
    expect(knowledgeBoundaries(EMPTY_KNOWLEDGE)).toEqual([]);
  });

  it('is a gap to ask about while none is declared, and not once one is', () => {
    const none = knowledgeGaps([medical], EMPTY_KNOWLEDGE).gaps;
    expect(none.some((g) => g.kind === 'limits-missing')).toBe(true);
    const some = knowledgeGaps([medical], parseKnowledge({ cannot: [payments] }).knowledge).gaps;
    expect(some.some((g) => g.kind === 'limits-missing')).toBe(false);
  });
});
