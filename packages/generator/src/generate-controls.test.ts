import { describe, expect, it } from 'vitest';

import { SCHOOL_CONFIG } from './fixture-app.ts';
import { generate } from './generate.ts';

/**
 * ADR-042 end to end, on the school fixture: what a screen lets a visitor do reaches each role's registry
 * only where that role may do it — through `actions`, and through nothing else. "Justificar falta" is on
 * the home screen STUDENT and PARENT share, for parents only.
 */
describe('generate — a control only some roles may use', () => {
  it('reaches those roles’ registries, and no word of it any other’s', async () => {
    const output = await generate({ config: SCHOOL_CONFIG, model: null });
    const parent = output.registries.get('PARENT')!;
    const student = JSON.stringify(output.registries.get('STUDENT'));
    expect(parent.capabilities.find((c) => c.route === '/my')?.actions).toEqual(['Justificar falta', 'Excuse an absence']);
    for (const word of ['Justificar', 'Excuse an absence']) expect(student, word).not.toContain(word);
  });

  it('is never read as something the screen shows', async () => {
    const output = await generate({ config: SCHOOL_CONFIG, model: null });
    const lessons = output.master.find((c) => c.route === '/lessons')!;
    expect(lessons.actions).toEqual(['Cancelar aula de apoio', 'Cancel support class']);
    expect(lessons.explanation).not.toMatch(/Cancelar aula de apoio|Nova aula de apoio/);
  });
});
