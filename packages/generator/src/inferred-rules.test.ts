import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readPage } from './pages.ts';
import type { InferredCandidate } from './types.ts';

/**
 * WP-55 — ADR-020's **inferred** tier, "the risky one": a condition read from what a
 * page's own code *does*, rather than from something it declares. Every test here is
 * really testing one thing over and over, in different shapes: does an exact pattern
 * ship (`recognized: true`), and does everything else — a near-miss, an `&&` instead of
 * an `||`, an `if`/`else`, a second statement in the guard — land in review only, never
 * silently guessed at.
 */

const tmp = (name: string, source: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'nextgen-inferred-'));
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  return file;
};

const candidatesOf = (file: string): readonly InferredCandidate[] => readPage(file).inferredCandidates;

describe('disabled-submit — a submit control disabled until a field is filled', () => {
  it('recognises a single !field', () => {
    const file = tmp(
      'Single.tsx',
      [
        'export default function F() {',
        '  return (',
        '    <form>',
        '      <input name="receipt" aria-label="Receipt" />',
        '      <button type="submit" disabled={!receipt}>Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    expect(candidatesOf(file)).toEqual([
      { pattern: 'disabled-submit', field: 'receipt', statement: null, recognized: true, detail: '!receipt', line: 5 },
    ]);
  });

  it('recognises every field in an ||-chain, each as its own candidate', () => {
    const file = tmp(
      'Chain.tsx',
      [
        'export default function F() {',
        '  return (',
        '    <form>',
        '      <input name="amount" aria-label="Amount" />',
        '      <input name="category" aria-label="Category" />',
        '      <button type="submit" disabled={!amount || !category}>Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    const candidates = candidatesOf(file);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.field).sort()).toEqual(['amount', 'category']);
    expect(candidates.every((c) => c.recognized)).toBe(true);
  });

  it('still recognises the known field in a chain that also names something unrelated', () => {
    const file = tmp(
      'Mixed.tsx',
      [
        'export default function F() {',
        '  return (',
        '    <form>',
        '      <input name="amount" aria-label="Amount" />',
        '      <button type="submit" disabled={!amount || isSubmitting}>Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    // isSubmitting is not `!identifier` and not a known field either way — it is simply
    // not evidence against "amount is required", since the OR still fires on !amount alone.
    expect(candidatesOf(file)).toEqual([
      { pattern: 'disabled-submit', field: 'amount', statement: null, recognized: true, detail: '!amount || isSubmitting', line: 5 },
    ]);
  });

  it('does not decompose an && — it changes what the condition means', () => {
    const file = tmp(
      'And.tsx',
      [
        'export default function F() {',
        '  return (',
        '    <form>',
        '      <input name="amount" aria-label="Amount" />',
        '      <input name="category" aria-label="Category" />',
        '      <button type="submit" disabled={!amount && !category}>Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    expect(candidatesOf(file)).toEqual([
      { pattern: 'disabled-submit', field: null, statement: null, recognized: false, detail: '!amount && !category', line: 6 },
    ]);
  });

  it('reports a disabled expression with no known field as review-only, not silently', () => {
    const file = tmp(
      'Unknown.tsx',
      [
        'export default function F() {',
        '  return <form><button type="submit" disabled={isSubmitting}>Save</button></form>',
        '}',
      ].join('\n'),
    );
    expect(candidatesOf(file)).toEqual([
      { pattern: 'disabled-submit', field: null, statement: null, recognized: false, detail: 'isSubmitting', line: 2 },
    ]);
  });

  it('finds nothing on a submit control with no disabled attribute', () => {
    const file = tmp('None.tsx', ['export default function F() {', '  return <form><button type="submit">Save</button></form>', '}'].join('\n'));
    expect(candidatesOf(file)).toEqual([]);
  });
});

describe('guard-message — the submit handler’s own early return', () => {
  const handler = (guard: string, body: string) =>
    [
      'export default function F() {',
      "  const [amount, setAmount] = useState('');",
      '  function handleSubmit(e) {',
      '    e.preventDefault();',
      `    if (${guard}) {`,
      `      ${body}`,
      '      return;',
      '    }',
      '    save();',
      '  }',
      '  return (',
      '    <form onSubmit={handleSubmit}>',
      '      <input name="amount" aria-label="Amount" />',
      '      <button type="submit">Save</button>',
      '    </form>',
      '  )',
      '}',
    ].join('\n');

  it('reads !field guarded by a setError(…) call, skipping the leading preventDefault', () => {
    const file = tmp('Guard1.tsx', handler('!amount', "setError('Amount is required to submit this.');"));
    expect(candidatesOf(file)).toEqual([
      {
        pattern: 'guard-message',
        field: 'amount',
        statement: 'Amount is required to submit this.',
        recognized: true,
        detail: expect.stringContaining('if (!amount)'),
        line: 5,
      },
    ]);
  });

  it('reads field === \'\' guarded by toast.error(…)', () => {
    const file = tmp('Guard2.tsx', handler("amount === ''", "toast.error('Please enter an amount.');"));
    const [candidate] = candidatesOf(file);
    expect(candidate).toMatchObject({ field: 'amount', statement: 'Please enter an amount.', recognized: true });
  });

  it('reads the LAST string argument of setFieldError(name, message), not the field name itself', () => {
    const file = tmp('Guard2b.tsx', handler('!amount', "setFieldError('amount', 'Amount cannot be empty.');"));
    const [candidate] = candidatesOf(file);
    expect(candidate).toMatchObject({ field: 'amount', statement: 'Amount cannot be empty.', recognized: true });
  });

  it('reads a throw new Error(…), braced, with no separate return needed', () => {
    const file = tmp(
      'Guard3.tsx',
      [
        'export default function F() {',
        '  function handleSubmit(e) {',
        '    e.preventDefault();',
        '    if (!amount) {',
        "      throw new Error('Amount is required.');",
        '    }',
        '    save();',
        '  }',
        '  return (',
        '    <form onSubmit={handleSubmit}>',
        '      <input name="amount" aria-label="Amount" />',
        '      <button type="submit">Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    const [candidate] = candidatesOf(file);
    expect(candidate).toMatchObject({ field: 'amount', statement: 'Amount is required.', recognized: true });
  });

  it('reads an unbraced throw the same way', () => {
    const file = tmp(
      'Guard4.tsx',
      [
        'export default function F() {',
        '  function handleSubmit(e) {',
        '    e.preventDefault();',
        "    if (!amount) throw new Error('Amount is required.');",
        '    save();',
        '  }',
        '  return (',
        '    <form onSubmit={handleSubmit}>',
        '      <input name="amount" aria-label="Amount" />',
        '      <button type="submit">Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    const [candidate] = candidatesOf(file);
    expect(candidate).toMatchObject({ field: 'amount', statement: 'Amount is required.', recognized: true });
  });

  it('is not recognized when the guarded name matches no known field', () => {
    const file = tmp('Guard5.tsx', handler('!isLoggedIn', "setError('You must be signed in.');"));
    expect(candidatesOf(file)).toEqual([
      { pattern: 'guard-message', field: null, statement: null, recognized: false, detail: expect.any(String), line: 5 },
    ]);
  });

  it('is not recognized when the guard shape is not one of the trusted comparisons', () => {
    const file = tmp('Guard6.tsx', handler('amount.length < 3', "setError('Too short.');"));
    expect(candidatesOf(file)[0]).toMatchObject({ recognized: false, field: null });
  });

  it('is not recognized when the message call has no string literal argument', () => {
    const file = tmp('Guard7.tsx', handler('!amount', 'setError(buildMessage());'));
    expect(candidatesOf(file)[0]).toMatchObject({ recognized: false, field: null });
  });

  it('is not recognized when the call is not one of the trusted message shapes', () => {
    const file = tmp('Guard8.tsx', handler('!amount', "console.log('Amount is required.');"));
    expect(candidatesOf(file)[0]).toMatchObject({ recognized: false, field: null });
  });

  it('is not a candidate at all when the guard has an else branch', () => {
    const file = tmp(
      'Guard9.tsx',
      [
        'export default function F() {',
        '  function handleSubmit(e) {',
        '    e.preventDefault();',
        '    if (!amount) {',
        "      setError('Amount is required.');",
        '      return;',
        '    } else {',
        '      save();',
        '    }',
        '  }',
        '  return (',
        '    <form onSubmit={handleSubmit}>',
        '      <input name="amount" aria-label="Amount" />',
        '      <button type="submit">Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    expect(candidatesOf(file)).toEqual([]);
  });

  it('is not a candidate at all when the if is not the handler’s first real statement', () => {
    const file = tmp(
      'Guard10.tsx',
      [
        'export default function F() {',
        '  function handleSubmit(e) {',
        '    e.preventDefault();',
        '    logAttempt();',
        '    if (!amount) {',
        "      setError('Amount is required.');",
        '      return;',
        '    }',
        '    save();',
        '  }',
        '  return (',
        '    <form onSubmit={handleSubmit}>',
        '      <input name="amount" aria-label="Amount" />',
        '      <button type="submit">Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    expect(candidatesOf(file)).toEqual([]);
  });

  it('is not a candidate at all when the if does not exit early', () => {
    const file = tmp(
      'Guard11.tsx',
      [
        'export default function F() {',
        '  function handleSubmit(e) {',
        '    e.preventDefault();',
        '    if (!amount) {',
        "      setWarning('Amount looks low.');",
        '    }',
        '    save();',
        '  }',
        '  return (',
        '    <form onSubmit={handleSubmit}>',
        '      <input name="amount" aria-label="Amount" />',
        '      <button type="submit">Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    expect(candidatesOf(file)).toEqual([]);
  });

  it('resolves an inline arrow onSubmit the same way as a named handler', () => {
    const file = tmp(
      'Guard12.tsx',
      [
        'export default function F() {',
        '  return (',
        '    <form onSubmit={(e) => {',
        '      e.preventDefault();',
        '      if (!amount) {',
        "        setError('Amount is required.');",
        '        return;',
        '      }',
        '      save();',
        '    }}>',
        '      <input name="amount" aria-label="Amount" />',
        '      <button type="submit">Save</button>',
        '    </form>',
        '  )',
        '}',
      ].join('\n'),
    );
    const [candidate] = candidatesOf(file);
    expect(candidate).toMatchObject({ field: 'amount', statement: 'Amount is required.', recognized: true });
  });

  it('finds nothing when there is no submit handler at all', () => {
    const file = tmp('NoHandler.tsx', ['export default function F() {', '  return <form><button type="submit">Save</button></form>', '}'].join('\n'));
    expect(candidatesOf(file)).toEqual([]);
  });
});
