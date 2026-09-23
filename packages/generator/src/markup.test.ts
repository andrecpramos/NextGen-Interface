import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readMarkupPage } from './markup.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/openers/${name}`, import.meta.url));
const labels = (name: string) => (readMarkupPage(fixture(name)).openers ?? []).map((o) => o.label ?? `key:${o.labelKey}`);

/**
 * ADR-031, for the frameworks read as markup: a control whose handler only shows something — a flag set
 * true or toggled, `open…()` — is an opener; one that saves, closes, deletes, or shows something *and*
 * does something else is not. Read from what the handler does, never from what the button says.
 */
describe('readMarkupPage — controls that only open something', () => {
  it('reads Vue: a flag set or toggled, an open…() call, named by text, key or aria-label', () => {
    expect(labels('Events.vue')).toEqual(['key:events.new', 'Filters', 'Import events']);
  });

  it('reads Svelte, whose handler holds a ">" inside the tag', () => {
    expect(labels('Events.svelte')).toEqual(['New event']);
  });

  it('reads an Angular template', () => {
    expect(labels('events.component.html')).toEqual(['New event']);
  });

  it('never counts a control that saves, closes, deletes, sends, or does anything besides showing', () => {
    const all = ['Events.vue', 'Events.svelte', 'events.component.html'].flatMap(labels);
    for (const not of ['Save', 'Close', 'Delete', 'Send', 'New tracked']) expect(all).not.toContain(not);
  });
});
