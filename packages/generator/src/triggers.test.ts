import { describe, expect, it } from 'vitest';

import { assignTriggers } from './triggers.ts';

/**
 * WP-38 lever 1.
 *
 * The property under test is not "triggers get emitted" — it is that an
 * *ambiguous* one never does. Stage 1 answers with score 1.0 and no margin
 * check, so a trigger claimed by two capabilities is the most confident wrong
 * answer this system can produce.
 */

const from = (o: Record<string, string[]>) => assignTriggers(new Map(Object.entries(o)));

describe('assignTriggers', () => {
  it('gives a capability the label only it claims', () => {
    const { triggers } = from({
      'academy.academic': ['Percurso escolar'],
      'medical.injuries': ['Lesões'],
    });
    expect(triggers.get('academy.academic')).toEqual(['percurso escolar']);
    expect(triggers.get('medical.injuries')).toEqual(['lesoes']);
  });

  /** The load-bearing one. */
  it('drops a phrase two capabilities both claim, rather than picking one', () => {
    const { triggers, ambiguous } = from({
      'training.calendar': ['Calendário'],
      'medical.calendar': ['Calendário'],
    });
    expect(triggers.has('training.calendar')).toBe(false);
    expect(triggers.has('medical.calendar')).toBe(false);
    expect(ambiguous.get('calendario')).toEqual(['medical.calendar', 'training.calendar']);
  });

  it('keeps the unambiguous labels of a capability that also had an ambiguous one', () => {
    const { triggers } = from({
      'training.calendar': ['Calendário', 'Calendário de treinos'],
      'medical.calendar': ['Calendário'],
    });
    expect(triggers.get('training.calendar')).toEqual(['calendario de treinos']);
  });

  /**
   * Stage 1 skips triggers under 4 characters when matching a substring, so a
   * shorter one can only fire on an exact whole-utterance match. Emitting them
   * inflates the trigger count without adding coverage, and the count is
   * supposed to mean something.
   */
  it('drops a phrase too short for stage 1 to match as a substring', () => {
    const { triggers } = from({ 'home.index': ['Só'], 'a.b': ['Início'] });
    expect(triggers.has('home.index')).toBe(false);
    expect(triggers.get('a.b')).toEqual(['inicio']);
  });

  /**
   * Normalisation is `core-intent`'s own, imported rather than copied — a
   * trigger is only useful if it is byte-identical to what stage 1 looks up.
   */
  it('stores the normalised form, so the registry shows what will actually match', () => {
    const { triggers } = from({ 'a.b': ['  Avaliações  FÍSICAS!  '] });
    expect(triggers.get('a.b')).toEqual(['avaliacoes fisicas']);
  });

  it('deduplicates spellings that normalise to the same phrase', () => {
    const { triggers } = from({ 'a.b': ['Lesões', 'lesoes', 'LESÕES'] });
    expect(triggers.get('a.b')).toEqual(['lesoes']);
  });

  it('preserves order, so the most natural spelling stays first', () => {
    const { triggers } = from({ 'a.b': ['Percurso escolar', 'Academia percurso escolar'] });
    expect(triggers.get('a.b')).toEqual(['percurso escolar', 'academia percurso escolar']);
  });

  it('omits a capability entirely rather than giving it an empty trigger list', () => {
    const { triggers } = from({ 'a.b': ['x'], 'c.d': ['Treinos'] });
    expect(triggers.has('a.b')).toBe(false);
    expect([...triggers.keys()]).toEqual(['c.d']);
  });

  it('is unbothered by a capability with no candidates at all', () => {
    expect(from({ 'a.b': [] }).triggers.size).toBe(0);
  });

  /**
   * A phrase claimed three times is no less ambiguous than one claimed twice,
   * and the report should name every claimant so the adopter can see which
   * screens collide.
   */
  it('reports every claimant of an ambiguous phrase', () => {
    const { ambiguous } = from({ 'a.x': ['Perfil'], 'b.x': ['Perfil'], 'c.x': ['Perfil'] });
    expect(ambiguous.get('perfil')).toEqual(['a.x', 'b.x', 'c.x']);
  });
});
