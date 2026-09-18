import { describe, expect, it } from 'vitest';

import { defineBoundary, defineCapability, defineRegistry } from './define.ts';
import { validateRegistry } from './validate.ts';
import { capabilityDocument, generateGoldenEntries, generateRouteTable } from './codegen.ts';
import { isCapabilityKind, isExecutableKind } from './types.ts';
import type { Capability, ExtractedRule, RegistryFile } from './types.ts';

const ex = (n: number) => Array.from({ length: n }, (_, i) => `phrasing number ${i + 1}`);

const ok = (over: Partial<Parameters<typeof defineCapability>[0]> = {}) =>
  defineCapability({
    id: 'transactions.list',
    kind: 'navigate',
    route: '/transactions',
    title: 'Transactions',
    description: 'Browse and filter the full list of recorded transactions',
    explanation: 'This screen lists every transaction you have recorded, newest first, and lets you filter them by date, category or account.',
    explanationSource: 'src/features/transactions/TransactionsPage.tsx',
    examples: ex(3),
    ...over,
  } as Parameters<typeof defineCapability>[0]);

const registryOf = (...capabilities: Capability[]): RegistryFile =>
  defineRegistry({
    domainDescription: 'A personal finance tracker, for these tests.',
    capabilities,
    enums: { Category: { values: ['food'] } },
  });

const rules = (r: RegistryFile) => validateRegistry(r).errors.map((e) => e.rule);

describe('validateRegistry — a valid registry', () => {
  it('accepts a well-formed capability', () => {
    expect(validateRegistry(registryOf(ok())).ok).toBe(true);
  });

  it('accepts a well-formed boundary entry', () => {
    const b = defineBoundary({
      id: 'unsupported.move_money',
      title: 'Moving real money',
      description: 'Paying, sending or transferring real money to another person',
      examples: ex(3),
      refusal: "I can record transactions, but I can't move real money.",
    });
    expect(validateRegistry(registryOf(ok(), b)).ok).toBe(true);
  });

  // WP-16 (Rule 1, D-2): stage 3 reads this field instead of a hardcoded
  // description, so a registry that omits it reproduces the exact defect the
  // field exists to fix.
  it('rejects a registry with no domainDescription', () => {
    const registry = { ...registryOf(ok()), domainDescription: '' };
    expect(rules(registry)).toContain('domain-description-required');
  });
});

describe('validateRegistry — the ≥3 examples rule', () => {
  // The rule WP-03 requires CI to enforce. Examples are the retrieval document,
  // the few-shot pool and the test fixtures, so two of them is under-specified
  // in three places at once.
  it('fails a capability with fewer than three examples', () => {
    for (const n of [0, 1, 2]) {
      expect(rules(registryOf(ok({ examples: ex(n) })))).toContain('examples-min');
    }
  });

  it('passes at exactly three', () => {
    expect(rules(registryOf(ok({ examples: ex(3) })))).not.toContain('examples-min');
  });

  it('rejects an empty example rather than counting it', () => {
    expect(rules(registryOf(ok({ examples: ['a real one', '', '   '] })))).toContain('example-empty');
  });
});

describe('validateRegistry — ADR-004 fail-closed', () => {
  it('rejects a missing kind', () => {
    const broken = { ...ok(), kind: '' } as Capability;
    expect(rules(registryOf(broken))).toContain('kind-required');
  });

  it('rejects an unknown kind rather than guessing the nearest', () => {
    for (const kind of ['reed', 'admin', 'READ', 'query']) {
      expect(rules(registryOf({ ...ok(), kind } as Capability))).toContain('kind-known');
    }
  });

  it('recognises exactly the five declared kinds', () => {
    for (const k of ['navigate', 'read', 'write', 'destructive', 'unsupported']) {
      expect(isCapabilityKind(k)).toBe(true);
    }
    expect(isCapabilityKind('admin')).toBe(false);
  });

  it('treats only the four executable kinds as executable', () => {
    expect(isExecutableKind('unsupported')).toBe(false);
    for (const k of ['navigate', 'read', 'write', 'destructive']) {
      expect(isExecutableKind(k)).toBe(true);
    }
  });
});

describe('validateRegistry — duplicate triggers', () => {
  it('rejects the same trigger on two capabilities', () => {
    // Stage 1 takes the first registration, so the second capability silently
    // becomes unreachable by phrase. Silent is the problem.
    const a = ok({ id: 'transactions.list', triggers: ['transactions'] });
    const b = ok({ id: 'transactions.search', route: '/search', triggers: ['transactions'] });
    expect(rules(registryOf(a, b))).toContain('trigger-unique');
  });

  it('allows a capability to repeat its own trigger', () => {
    expect(rules(registryOf(ok({ triggers: ['transactions', 'transactions'] })))).not.toContain('trigger-unique');
  });

  it('compares triggers case-insensitively', () => {
    const a = ok({ id: 'a.one', triggers: ['Budget'] });
    const b = ok({ id: 'b.two', route: '/b', triggers: ['budget'] });
    expect(rules(registryOf(a, b))).toContain('trigger-unique');
  });
});

describe('validateRegistry — route and param coherence', () => {
  it('rejects a path parameter the capability never declares', () => {
    expect(rules(registryOf(ok({ id: 'budget.detail', route: '/budget/:id' })))).toContain('route-param-declared');
  });

  it('rejects a path parameter that is declared but optional', () => {
    const c = ok({ id: 'budget.detail', route: '/budget/:id', params: { id: { type: 'string' } } });
    expect(rules(registryOf(c))).toContain('route-param-required');
  });

  it('accepts a required path parameter', () => {
    const c = ok({ id: 'budget.detail', route: '/budget/:id', params: { id: { type: 'string', required: true } } });
    expect(rules(registryOf(c))).not.toContain('route-param-declared');
  });

  it('rejects a param naming an enum the registry does not declare', () => {
    const c = ok({ params: { category: { type: 'enum:Nonexistent' } } });
    expect(rules(registryOf(c))).toContain('param-enum-declared');
  });

  it('rejects a missing route on an executable capability', () => {
    expect(rules(registryOf({ ...ok(), route: null } as Capability))).toContain('route-required');
  });

  it('rejects duplicate ids', () => {
    expect(rules(registryOf(ok(), ok()))).toContain('id-unique');
  });
});

describe('validateRegistry — boundary entries', () => {
  const b = (over: Partial<Capability>) =>
    ({
      id: 'unsupported.thing', kind: 'unsupported', route: null, title: 'Thing',
      description: 'A thing this application deliberately does not do at all',
      params: {}, examples: ex(3), refusal: 'Not something I do.', ...over,
    }) as Capability;

  it('requires a refusal message', () => {
    const noRefusal = { ...b({}) } as Capability & { refusal?: string };
    delete noRefusal.refusal;
    expect(rules(registryOf(ok(), noRefusal))).toContain('boundary-refusal');
  });

  it('rejects a boundary entry that declares a route', () => {
    // A refusal with a route is a refusal you can navigate to.
    expect(rules(registryOf(ok(), b({ route: '/somewhere' })))).toContain('boundary-no-route');
  });

  it('rejects a boundary entry that declares params', () => {
    expect(rules(registryOf(ok(), b({ params: { x: { type: 'string' } } })))).toContain('boundary-no-params');
  });

  it('rejects a refusal message on an executable capability', () => {
    expect(rules(registryOf(ok({ }) as Capability & { refusal?: string }))).not.toContain('refusal-misplaced');
    const weird = { ...ok(), refusal: 'nope' } as Capability;
    expect(rules(registryOf(weird))).toContain('refusal-misplaced');
  });
});

/**
 * WP-36. "What is this page?" is answered from a string written once at build
 * time, not from a model called per turn — the same move ADR-009 made for
 * refusals. A capability with no explanation is a question the assistant has to
 * escalate or invent an answer to, which is the chat-widget failure Ladder A1
 * exists to avoid.
 */
describe('validateRegistry — the declared explanation', () => {
  it('rejects a capability that cannot say what it is', () => {
    expect(rules(registryOf(ok({ explanation: '' })))).toContain('explanation-required');
  });

  it('warns when the served text is too short to be an answer', () => {
    const result = validateRegistry(registryOf(ok({ explanation: 'A page.' })));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.rule)).toContain('explanation-thin');
  });

  it('warns when a wrong answer could not be traced back to its source', () => {
    const untraceable = { ...ok() } as Capability & { explanationSource?: string };
    delete untraceable.explanationSource;
    const result = validateRegistry(registryOf(untraceable));
    expect(result.warnings.map((w) => w.rule)).toContain('explanation-untraceable');
  });

  // A declared limit answers "what is this?" with its refusal, so requiring a
  // second string would be asking for the same sentence twice.
  it('does not require one from a declared limit', () => {
    const b = defineBoundary({
      id: 'unsupported.thing', title: 'Thing',
      description: 'Something this application deliberately does not do',
      examples: ex(3), refusal: 'Not something I do.',
    });
    expect(rules(registryOf(ok(), b))).not.toContain('explanation-required');
  });
});

describe('validateRegistry — extracted rules (ADR-020, WP-54)', () => {
  const withRule = (over: Partial<ExtractedRule> = {}) => ({
    ...ok(),
    rules: [{ field: 'amount', statement: 'Amount is required.', tier: 'read' as const, source: 'src/Page.tsx:12', ...over }],
  });

  it('accepts a well-formed rule', () => {
    expect(validateRegistry(registryOf(withRule())).ok).toBe(true);
  });

  it('rejects a rule with no field', () => {
    expect(rules(registryOf(withRule({ field: '' })))).toContain('rule-field-required');
  });

  it('rejects a rule with no statement', () => {
    expect(rules(registryOf(withRule({ statement: '' })))).toContain('rule-statement-required');
  });

  it('rejects a rule with no source — an extracted rule with no provenance cannot be checked', () => {
    expect(rules(registryOf(withRule({ source: '' })))).toContain('rule-untraceable');
  });

  it('rejects an unrecognised tier', () => {
    expect(rules(registryOf(withRule({ tier: 'guessed' as never })))).toContain('rule-tier-invalid');
  });

  it('rejects a rule on a declared limit — there is no form to constrain', () => {
    const b = defineBoundary({
      id: 'unsupported.thing', title: 'Thing',
      description: 'Something this application deliberately does not do',
      examples: ex(3), refusal: 'Not something I do.',
    });
    const boundaryWithRule = { ...b, rules: [{ field: 'x', statement: 'X is required.', tier: 'read' as const, source: 'a.tsx:1' }] };
    expect(rules(registryOf(ok(), boundaryWithRule))).toContain('rules-on-boundary');
  });
});

describe('capabilityDocument — the retrieval text', () => {
  /**
   * The explanation is what gets *served*; the description is what gets
   * *matched*. Keeping them apart is what lets an adopter rewrite a bad answer
   * without invalidating every embedding and every calibrated threshold
   * (Rule 14, Finding 1).
   */
  it('does not embed the explanation', () => {
    const withExplanation = ok({ explanation: 'Zzyzx quixotic explanation text that appears nowhere else.' });
    expect(capabilityDocument(withExplanation)).not.toContain('Zzyzx');
  });

  it('joins title, description, triggers and example phrasings', () => {
    const c = ok({ triggers: ['spending report'], examples: ['show my transactions', 'b', 'c'] });
    expect(capabilityDocument(c)).toBe(
      'Transactions. Browse and filter the full list of recorded transactions. spending report. show my transactions. b. c',
    );
  });

  /**
   * WP-38 / WP-40. A trigger already present in the title or description adds
   * WEIGHT, not signal — and weight here is a retrieval bug, not a nicety.
   *
   * The generator derives triggers from nav labels, and a nav label is usually
   * the title, so 141 of 245 generated triggers were duplicates. Embedding them
   * doubled the title's weight for every real capability while declared
   * boundaries, which carry no triggers, got no such boost. Measured: capability
   * ranking improved and out-of-scope refusal fell 32.4% → 26.5%.
   */
  it('does not count a trigger that the title or description already contains', () => {
    const c = ok({ triggers: ['transactions'], examples: ['a', 'b', 'c'] });
    // "transactions" appears in both the title and the description already.
    expect(capabilityDocument(c)).toBe(
      'Transactions. Browse and filter the full list of recorded transactions. a. b. c',
    );
  });

  it('compares accent-insensitively, because a generated trigger is normalised', () => {
    const c = ok({
      title: 'Avaliações físicas',
      description: 'Uma descrição.',
      triggers: ['avaliacoes fisicas', 'physical assessments'],
      examples: ['a', 'b', 'c'],
    });
    const doc = capabilityDocument(c);
    // The normalised duplicate is dropped; the genuinely different English
    // label survives, because it is phrasing the title does not carry.
    expect(doc).not.toContain('avaliacoes fisicas');
    expect(doc).toContain('physical assessments');
  });

  it('reads the `say` field of a rich example, not the object', () => {
    const c = ok({ examples: [{ say: 'show my transactions', expect: { route: '/transactions' } }, 'b', 'c'] });
    expect(capabilityDocument(c)).toContain('show my transactions');
    expect(capabilityDocument(c)).not.toContain('route');
  });

  it('produces identical text for the two example forms', () => {
    // This is what lets examples gain `expect` blocks without shifting every
    // stage-2 score and invalidating the committed scorecards.
    const plain = ok({ examples: ['a', 'b', 'c'] });
    const rich = ok({ examples: [{ say: 'a' }, { say: 'b' }, { say: 'c' }] });
    expect(capabilityDocument(plain)).toBe(capabilityDocument(rich));
  });
});

describe('generateRouteTable', () => {
  it('emits one entry per executable capability', () => {
    const table = generateRouteTable(registryOf(ok()));
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ capabilityId: 'transactions.list', route: '/transactions' });
  });

  it('never emits a route for a declared limit', () => {
    const boundary = defineBoundary({
      id: 'unsupported.thing', title: 'Thing',
      description: 'Something this application deliberately does not do',
      examples: ex(3), refusal: 'Not something I do.',
    });
    const table = generateRouteTable(registryOf(ok(), boundary));
    expect(table.map((r) => r.capabilityId)).toEqual(['transactions.list']);
  });
});

describe('generateGoldenEntries — examples as fixtures', () => {
  it('emits an entry for every example, refined by any expectation it carries', () => {
    const c = ok({
      examples: [
        { say: 'show last month', expect: { params: { from: '2026-07-01' }, maxStage: 'embedding' } },
        'a bare phrasing',
        'another',
      ],
    });
    const entries = generateGoldenEntries(registryOf(c));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      utterance: 'show last month',
      expect: { outcome: 'execute', capability: 'transactions.list', maxStage: 'embedding' },
    });
  });

  // WP-19: the reason the artefact was 0 bytes in both reference apps. Declaring
  // an utterance as an example of a capability is the assertion; requiring a
  // second, hand-written one meant nothing was ever asserted.
  it('derives the expectation for a bare example from its capability', () => {
    const c = ok({ examples: ['one', 'two', 'three'] });
    const entries = generateGoldenEntries(registryOf(c));
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.utterance)).toEqual(['one', 'two', 'three']);
    for (const entry of entries) {
      expect(entry.expect).toEqual({ outcome: 'execute', capability: 'transactions.list' });
    }
  });

  it('marks a write example as requiring confirmation', () => {
    const c = ok({
      id: 'transaction.create', kind: 'write', route: '/transactions/new',
      examples: [{ say: 'add 20 for coffee', expect: {} }, 'b', 'c'],
    });
    expect(generateGoldenEntries(registryOf(c))[0]?.expect).toMatchObject({ requiresConfirmation: true });
  });

  it('expects a refusal from a boundary example', () => {
    const b = defineBoundary({
      id: 'unsupported.thing', title: 'Thing',
      description: 'Something this application deliberately does not do',
      examples: [{ say: 'do the thing', expect: {} }, 'b', 'c'],
      refusal: 'Not something I do.',
    });
    const entry = generateGoldenEntries(registryOf(ok(), b)).find((e) => e.utterance === 'do the thing');
    expect(entry?.expect).toMatchObject({ outcome: 'out_of_scope' });
    expect(entry?.expect).not.toHaveProperty('capability');
  });
});
