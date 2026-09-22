import { describe, expect, it } from 'vitest';

import { applyKnowledge, EMPTY_KNOWLEDGE, knowledgeBoundaries, knowledgeContext, knowledgeGaps, parseKnowledge } from './knowledge.ts';
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
    expect(knowledge.cannot).toEqual([{ ...payments, instead: [] }]);
  });

  // The assistant helps, it does not act: a limit can say where the visitor can do it themselves.
  it('reads where the visitor can help themselves, as routes, and drops anything else with a reason', () => {
    const { knowledge, problems } = parseKnowledge({ cannot: [{ ...payments, instead: ['/my/invoices', 'the office', '/my/contacts', '/third'] }] });
    expect(knowledge.cannot[0]!.instead).toEqual(['/my/invoices', '/my/contacts']);
    expect(problems.map((p) => p.path)).toEqual(expect.arrayContaining(['cannot[0].instead[1]']));
  });

  it('carries it into the declared limit as helpAt, and leaves a limit without one as it was', () => {
    const [helped] = knowledgeBoundaries(parseKnowledge({ cannot: [{ ...payments, instead: ['/my/invoices'] }] }).knowledge);
    expect(helped!.helpAt).toEqual(['/my/invoices']);
    const [plain] = knowledgeBoundaries(parseKnowledge({ cannot: [payments] }).knowledge);
    expect(plain).not.toHaveProperty('helpAt');
  });

  it('names a place that is no screen of this app as a gap, rather than dropping it without a word', () => {
    const k = parseKnowledge({ cannot: [{ ...payments, instead: ['/my/children/medical', '/nowhere'] }] }).knowledge;
    const gaps = knowledgeGaps([medical], k).gaps.filter((g) => g.kind === 'instead-unknown');
    expect(gaps.map((g) => g.route)).toEqual(['/nowhere']);
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

/**
 * How the app works, and how to reason about a request in it — for the model stage (ADR-023).
 * It is the one part of the file that is *about the whole app* rather than a screen, so it is
 * the part most likely to name something a given role must not be told (Rule 17): each rule and
 * each glossary entry can be scoped to roles, and a role receives only its own.
 */
describe('rules — how the app works, told to the model', () => {
  const guardianRule = 'O estado médico é por educando: se houver mais do que um, é preciso saber qual.';
  const coachRule = 'Um treinador só vê os jogadores das equipas que dirige.';
  const source = {
    rules: [guardianRule, { text: coachRule, roles: ['COACH'] }],
    glossary: [
      { term: 'educando', means: 'um jovem atleta', aliases: ['filho', 'filha'] },
      { term: 'convocatória', means: 'a lista de um jogo', aliases: ['lista'], roles: ['COACH'] },
    ],
    cannot: [payments],
  };
  const { knowledge } = parseKnowledge(source);

  it('reads a rule as a string or as text with the roles it is for', () => {
    expect(knowledge.rules).toEqual([
      { text: guardianRule, roles: null },
      { text: coachRule, roles: ['COACH'] },
    ]);
    expect(knowledge.glossary[1]!.roles).toEqual(['COACH']);
    expect(knowledge.glossary[0]!.roles).toBeNull();
  });

  it('drops a rule that is not text, and names where it was', () => {
    const { knowledge: k, problems } = parseKnowledge({ rules: ['ok', 7, { roles: ['X'] }, { text: '   ' }, { text: 'fine', roles: 'PARENT' }] });
    expect(k.rules.map((r) => r.text)).toEqual(['ok', 'fine']);
    expect(k.rules[1]!.roles).toEqual(['PARENT']);
    expect(problems.map((p) => p.path).sort()).toEqual(['rules[1]', 'rules[2]', 'rules[3]']);
  });

  it('caps how many rules one file can carry', () => {
    const { knowledge: k, problems } = parseKnowledge({ rules: Array.from({ length: 90 }, (_, i) => `regra ${i}`) });
    expect(k.rules).toHaveLength(60);
    expect(problems.some((p) => p.path === 'rules' && /too many/.test(p.message))).toBe(true);
  });

  it('gives each role only its own: what is for everyone, and what is for it', () => {
    const parent = knowledgeContext(knowledge, 'PARENT')!;
    expect(parent.rules).toEqual([guardianRule]);
    expect(parent.glossary?.map((g) => g.term)).toEqual(['educando']);
    const coach = knowledgeContext(knowledge, 'COACH')!;
    expect(coach.rules).toEqual([guardianRule, coachRule]);
    expect(coach.glossary?.map((g) => g.term)).toEqual(['educando', 'convocatória']);
  });

  it('never tells one role what another was told, in any field', () => {
    const parent = JSON.stringify(knowledgeContext(knowledge, 'PARENT'));
    expect(parent).not.toContain('treinador só vê');
    expect(parent).not.toContain('convocatória');
    expect(knowledgeContext(knowledge, 'PLAYER')).not.toBeNull();
    expect(JSON.stringify(knowledgeContext(knowledge, 'PLAYER'))).not.toContain('convocatória');
  });

  it('gives every role the app’s declared limits, which are about the app and not a screen', () => {
    for (const role of ['PARENT', 'COACH', 'ANYONE']) {
      expect(knowledgeContext(knowledge, role)!.limits).toEqual([{ about: 'Pagamentos e quotas', say: payments.say }]);
    }
  });

  it('is nothing at all for an app that said nothing, or only what is for other roles', () => {
    expect(knowledgeContext(EMPTY_KNOWLEDGE, 'PARENT')).toBeNull();
    const onlyCoach = parseKnowledge({ rules: [{ text: coachRule, roles: ['COACH'] }] }).knowledge;
    expect(knowledgeContext(onlyCoach, 'PARENT')).toBeNull();
  });

  it('keeps a few aliases per word, so vocabulary cannot crowd out the rules', () => {
    const many = parseKnowledge({ glossary: [{ term: 'x', aliases: Array.from({ length: 20 }, (_, i) => `a${i}`) }] }).knowledge;
    expect(knowledgeContext(many, 'PARENT')!.glossary![0]!.aliases!.length).toBeLessThanOrEqual(8);
  });

  it('is a gap to ask about while there are none, and not once there are', () => {
    expect(knowledgeGaps([medical], EMPTY_KNOWLEDGE).gaps.some((g) => g.kind === 'rules-missing')).toBe(true);
    expect(knowledgeGaps([medical], knowledge).gaps.some((g) => g.kind === 'rules-missing')).toBe(false);
  });

  it('points at a rule scoped to a role the app does not have, rather than dropping it without a word', () => {
    const typo = parseKnowledge({ rules: [{ text: 'algo', roles: ['COACHH'] }] }).knowledge;
    const gap = knowledgeGaps([medical], typo).gaps.find((g) => g.kind === 'role-unknown');
    expect(gap).toBeDefined();
    expect(gap!.message).toContain('COACHH');
  });
});
