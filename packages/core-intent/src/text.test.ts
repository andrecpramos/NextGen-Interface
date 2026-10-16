import { describe, expect, it } from 'vitest';

import { normalize } from './text.ts';

/**
 * Found with a microphone: whisper.cpp ends every transcript with a
 * full stop, and `normalize()` kept it, so `"My modules."` never met the stage-1
 * trigger `"my modules"`. 10 of 40 spoken turns routed differently from the same
 * words typed; after the fix, 1 of 40 — and that one is a mishearing.
 */
describe('normalize — sentence punctuation', () => {
  it('drops a trailing full stop, so a transcript matches what was typed', () => {
    expect(normalize('My modules.')).toBe(normalize('my modules'));
    expect(normalize('Undo that.')).toBe('undo that');
  });

  it('drops a comma between words', () => {
    expect(normalize('ok, show my notes')).toBe('ok show my notes');
  });

  it('keeps a mark with a digit on both sides — amounts and dates survive for the slot resolvers', () => {
    expect(normalize('spent 12.50 on lunch')).toBe('spent 12.50 on lunch');
    expect(normalize('1,234 euros')).toBe('1,234 euros');
    expect(normalize('due 01.02.2026.')).toBe('due 01.02.2026');
  });

  it('still drops a mark touching a digit on one side only', () => {
    expect(normalize('costs 12.')).toBe('costs 12');
    expect(normalize('item 3, then 4')).toBe('item 3 then 4');
  });
});
