import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { dedupeFieldRules, rulesEntry, rulesFor } from './field-rules.ts';
import { readPage } from './pages.ts';
import type { FieldRule, FormField } from './types.ts';

/**
 * ADR-020's **read** tier: constraints an application writes down,
 * read from a real control's own attributes or from a validation schema bound
 * through react-hook-form's `resolver`.
 *
 * Every test that checks a `line` writes a real file to a temp directory and
 * reads it back through `readPage`, the same entry point `generate.ts` uses —
 * the acceptance this work package sets is "resolves to the line it names",
 * which a hand-built `ts.SourceFile` could not actually prove.
 */

const tmp = (name: string, source: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'nextgen-rules-'));
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  return file;
};

/** The exact text of one line of a file on disk, 1-based — what a `source` pointer names. */
const lineOf = (file: string, line: number): string => (readFileSync(file, 'utf8').split('\n')[line - 1] ?? '').trim();

const rulesByName = (fields: readonly FormField[], name: string): readonly FieldRule[] =>
  fields.find((f) => f.name === name)?.rules ?? [];

describe('htmlFieldRules — a native attribute on a real control', () => {
  it('reads required, min/max, minLength/maxLength and pattern, each at its own line', () => {
    const file = tmp(
      'Expense.tsx',
      [
        'export default function ExpenseForm() {',
        '  return (',
        '    <form>',
        '      <input name="amount" type="number" min={0} max={1000} required aria-label="Amount" />',
        '      <input name="note" minLength={3} maxLength={280} pattern="^[a-zA-Z ]+$" aria-label="Note" />',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    const fields = readPage(file).fields;

    const amount = rulesByName(fields, 'amount');
    expect(amount).toEqual(
      expect.arrayContaining([
        { kind: 'required', line: 4 },
        { kind: 'min', value: 0, line: 4 },
        { kind: 'max', value: 1000, line: 4 },
      ]),
    );
    expect(lineOf(file, 4)).toContain('name="amount"');

    const note = rulesByName(fields, 'note');
    expect(note).toEqual(
      expect.arrayContaining([
        { kind: 'minLength', value: 3, line: 5 },
        { kind: 'maxLength', value: 280, line: 5 },
        { kind: 'pattern', value: '^[a-zA-Z ]+$', line: 5 },
      ]),
    );
    expect(lineOf(file, 5)).toContain('name="note"');
  });

  it('reads a bare boolean attribute, not only `required={true}`', () => {
    const file = tmp(
      'Bare.tsx',
      ['export default function F() {', '  return <form><input name="x" aria-label="X" required /></form>', '}'].join('\n'),
    );
    expect(rulesByName(readPage(file).fields, 'x')).toEqual([{ kind: 'required', line: 2 }]);
  });

  it('finds nothing on a control with no constraint', () => {
    const file = tmp(
      'Plain.tsx',
      ['export default function F() {', '  return <form><input name="x" aria-label="X" /></form>', '}'].join('\n'),
    );
    expect(rulesByName(readPage(file).fields, 'x')).toEqual([]);
  });
});

describe('schemaFieldRules — zod, bound through react-hook-form', () => {
  const source = [
    "import { useForm } from 'react-hook-form';",
    "import { zodResolver } from '@hookform/resolvers/zod';",
    "import { z } from 'zod';",
    '',
    'const schema = z.object({',
    '  amount: z.number().min(0).max(1000),',
    "  category: z.enum(['food', 'rent']),",
    '  email: z.string().email().optional(),',
    '  name: z.string().min(2),',
    '});',
    '',
    'export default function ExpenseForm() {',
    '  const { register } = useForm({ resolver: zodResolver(schema) });',
    '  return (',
    '    <form>',
    "      <input {...register('amount')} aria-label=\"Amount\" />",
    "      <select {...register('category')} aria-label=\"Category\" />",
    "      <input {...register('email')} aria-label=\"Email\" />",
    "      <input {...register('name')} aria-label=\"Name\" />",
    '    </form>',
    '  )',
    '}',
  ].join('\n');

  it('reads required-by-default, min and max on a number field', () => {
    const file = tmp('ZodAmount.tsx', source);
    expect(rulesByName(readPage(file).fields, 'amount')).toEqual(
      expect.arrayContaining([
        { kind: 'required', line: 6 },
        { kind: 'min', value: 0, line: 6 },
        { kind: 'max', value: 1000, line: 6 },
      ]),
    );
    expect(lineOf(file, 6)).toContain('amount:');
  });

  it('reads z.enum(...) as an enum, at the schema property’s own line', () => {
    const file = tmp('ZodCategory.tsx', source);
    expect(rulesByName(readPage(file).fields, 'category')).toEqual(
      expect.arrayContaining([{ kind: 'enum', values: ['food', 'rent'], line: 7 }]),
    );
  });

  it('does not mark a field required when the chain declares it optional', () => {
    const file = tmp('ZodEmail.tsx', source);
    const rules = rulesByName(readPage(file).fields, 'email');
    expect(rules.some((r) => r.kind === 'required')).toBe(false);
    expect(rules).toEqual(expect.arrayContaining([{ kind: 'email', line: 8 }]));
  });

  it('reads a string minimum as minLength, not min', () => {
    const file = tmp('ZodName.tsx', source);
    expect(rulesByName(readPage(file).fields, 'name')).toEqual(
      expect.arrayContaining([{ kind: 'required', line: 9 }, { kind: 'minLength', value: 2, line: 9 }]),
    );
  });

  it('finds the schema through a local variable, not only inline', () => {
    // `source` above already declares `schema` above the component and passes
    // it by reference — this asserts that indirection resolved at all, since
    // every other case in this describe block would read zero rules if it had not.
    const file = tmp('ZodIndirect.tsx', source);
    expect(rulesByName(readPage(file).fields, 'amount').length).toBeGreaterThan(0);
  });
});

describe('schemaFieldRules — yup, bound through react-hook-form', () => {
  const source = [
    "import { useForm } from 'react-hook-form';",
    "import { yupResolver } from '@hookform/resolvers/yup';",
    "import * as yup from 'yup';",
    '',
    'const schema = yup.object({',
    "  role: yup.string().oneOf(['admin', 'member']).required(),",
    '  bio: yup.string().max(500),',
    '  code: yup.string().matches(/^[A-Z]{3}$/),',
    '});',
    '',
    'export default function MemberForm() {',
    '  const { register } = useForm({ resolver: yupResolver(schema) });',
    '  return (',
    '    <form>',
    "      <select {...register('role')} aria-label=\"Role\" />",
    "      <input {...register('bio')} aria-label=\"Bio\" />",
    "      <input {...register('code')} aria-label=\"Code\" />",
    '    </form>',
    '  )',
    '}',
  ].join('\n');

  it('reads .required() explicitly — yup never implies it', () => {
    const file = tmp('YupRole.tsx', source);
    expect(rulesByName(readPage(file).fields, 'role')).toEqual(
      expect.arrayContaining([{ kind: 'required', line: 6 }, { kind: 'enum', values: ['admin', 'member'], line: 6 }]),
    );
  });

  it('does not mark a field required when .required() is absent', () => {
    const file = tmp('YupBio.tsx', source);
    const rules = rulesByName(readPage(file).fields, 'bio');
    expect(rules.some((r) => r.kind === 'required')).toBe(false);
    expect(rules).toEqual(expect.arrayContaining([{ kind: 'maxLength', value: 500, line: 7 }]));
  });

  it('reads .matches(/regex/) as a pattern, keeping the regex source verbatim', () => {
    const file = tmp('YupCode.tsx', source);
    expect(rulesByName(readPage(file).fields, 'code')).toEqual(
      expect.arrayContaining([{ kind: 'pattern', value: '/^[A-Z]{3}$/', line: 8 }]),
    );
  });
});

describe('schemaFieldRules — the documented scope limit', () => {
  it('reads nothing through a namespace this module does not recognise', () => {
    const file = tmp(
      'Wrapped.tsx',
      [
        "import { useForm } from 'react-hook-form';",
        "import { zodResolver } from '@hookform/resolvers/zod';",
        "import { schema as ourZod } from './zod-setup';",
        '',
        'const schema = ourZod.object({ amount: ourZod.number().min(0) });',
        '',
        'export default function F() {',
        '  const { register } = useForm({ resolver: zodResolver(schema) });',
        "  return <form><input {...register('amount')} aria-label=\"Amount\" /></form>;",
        '}',
      ].join('\n'),
    );
    // Not a crash, and not a guess: an unrecognised namespace yields no rules
    // at all rather than a wrong one.
    expect(rulesByName(readPage(file).fields, 'amount')).toEqual([]);
  });
});

describe('dedupeFieldRules', () => {
  it('collapses the same kind and value found twice', () => {
    const rules: FieldRule[] = [
      { kind: 'required', line: 3 },
      { kind: 'min', value: 0, line: 3 },
      { kind: 'required', line: 12 }, // the schema's own copy of the same fact
    ];
    expect(dedupeFieldRules(rules)).toEqual([{ kind: 'required', line: 3 }, { kind: 'min', value: 0, line: 3 }]);
  });

  it('keeps two rules of the same kind when their value differs', () => {
    const rules: FieldRule[] = [{ kind: 'min', value: 0, line: 3 }, { kind: 'min', value: 5, line: 12 }];
    expect(dedupeFieldRules(rules)).toEqual(rules);
  });
});

describe('rulesFor / rulesEntry — phrasing, in the app’s own language', () => {
  const field = (over: Partial<FormField>): FormField => ({
    tag: 'input',
    label: null,
    labelKey: null,
    id: null,
    name: null,
    type: null,
    rules: [],
    ...over,
  });

  it('phrases required, min/max and enum in English', () => {
    const fields = [
      field({ name: 'amount', label: 'Amount', rules: [{ kind: 'required', line: 4 }, { kind: 'min', value: 0, line: 4 }] }),
      field({ name: 'category', label: 'Category', rules: [{ kind: 'enum', values: ['food', 'rent'], line: 7 }] }),
    ];
    const phrased = rulesFor(fields, undefined, 'en');
    expect(phrased).toEqual([
      { field: 'amount', statement: 'Amount is required.', line: 4 },
      { field: 'amount', statement: 'Amount must be at least 0.', line: 4 },
      { field: 'category', statement: 'Category must be one of: food, rent.', line: 7 },
    ]);
  });

  it('phrases the same rules in Portuguese', () => {
    const fields = [field({ name: 'amount', label: 'Montante', rules: [{ kind: 'required', line: 4 }] })];
    expect(rulesFor(fields, undefined, 'pt-PT')).toEqual([{ field: 'amount', statement: 'Montante é obrigatório.', line: 4 }]);
  });

  it('never quotes a pattern’s regex to the visitor', () => {
    const fields = [field({ name: 'code', label: 'Code', rules: [{ kind: 'pattern', value: '^[A-Z]{3}$', line: 8 }] })];
    const [rule] = rulesFor(fields, undefined, 'en');
    expect(rule!.statement).toBe('Code must match a specific format.');
    expect(rule!.statement).not.toContain('[A-Z]');
  });

  it('drops a rule whose field has no resolvable label — the same principle stepsFor applies', () => {
    const fields = [field({ name: 'amount', label: null, labelKey: null, rules: [{ kind: 'required', line: 4 }] })];
    expect(rulesFor(fields, undefined, 'en')).toEqual([]);
  });

  it('rulesEntry attaches the page file to every rule’s source, spread-ready', () => {
    const fields = [field({ name: 'amount', label: 'Amount', rules: [{ kind: 'required', line: 4 }] })];
    expect(rulesEntry(fields, undefined, 'en', '/app/src', '/app/src/features/expenses/ExpensePage.tsx')).toEqual({
      rules: [
        {
          field: 'amount',
          statement: 'Amount is required.',
          tier: 'read',
          source: 'features/expenses/ExpensePage.tsx:4',
        },
      ],
    });
  });

  it('rulesEntry omits `rules` entirely when there is nothing to say', () => {
    expect(rulesEntry([], undefined, 'en', '/app/src', '/app/src/x.tsx')).toEqual({});
  });
});
