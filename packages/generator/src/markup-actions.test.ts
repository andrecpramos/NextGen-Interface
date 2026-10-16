import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readMarkupControls, readMarkupPage } from './markup.ts';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/actions/${name}`, import.meta.url));
const names = (list: readonly { label: string | null; labelKey: string | null }[] | undefined) =>
  (list ?? []).map((c) => c.label ?? `key:${c.labelKey}`);

/**
 * ADR-042, for the frameworks read as markup (Vue, Svelte, Angular): what a screen lets a visitor do is in
 * its controls there too. Read as text, conservatively — no role is evaluated here, so a control under a
 * condition about who the visitor is is left out and reported, never listed for everyone.
 */
describe('readMarkupPage — controls that do something', () => {
  it('reads Vue: a handler that calls something, a submit, named by text or key', () => {
    const facts = readMarkupPage(fixture('Sessions.vue'));
    expect(names(facts.actions)).toEqual(['key:sessions.cancel', 'Publish plan', 'Save changes', 'Export CSV']);
  });

  it('reads Svelte, both event syntaxes, and a form’s button with no type', () => {
    expect(names(readMarkupPage(fixture('Sessions.svelte')).actions)).toEqual(['Cancel session', 'Publish plan', 'Export CSV', 'Publish article']);
  });

  it('reads Angular, including its block syntax', () => {
    expect(names(readMarkupPage(fixture('sessions.component.html')).actions)).toEqual(['Cancel session', 'Save changes', 'Export CSV']);
  });

  it('never lists what opens, moves, closes or leaves', () => {
    const all = ['Sessions.vue', 'Sessions.svelte', 'sessions.component.html'].flatMap((f) => names(readMarkupPage(fixture(f)).actions));
    for (const not of ['New session', 'Back to training', 'Close', 'Sign out', 'Your Feed', 'Preview']) expect(all).not.toContain(not);
  });

  it('leaves out a control a condition about who guards, and says which', () => {
    const vue = readMarkupPage(fixture('Sessions.vue'));
    expect(names(vue.guardedControls)).toEqual(['Delete session', 'Archive season', 'Reorder drills']);
    // A condition about whose the item is — its author — is about who, as much as a role is.
    expect(names(readMarkupPage(fixture('Sessions.svelte')).guardedControls)).toEqual(['Archive season', 'Delete article']);
    expect(names(readMarkupPage(fixture('sessions.component.html')).guardedControls)).toEqual(['Delete session', 'Archive season']);
  });
});

/**
 * A Vue or Svelte page is usually composed: SvelteKit's `/editor` renders `<Editor />`, and the form is in
 * there (a public app, 2026-10-16). Its controls are read through the components it imports, as a JSX
 * page's are — and a component rendered under a condition about who passes it on to every control in it.
 */
describe('readMarkupControls — through the components a markup page renders', () => {
  const resolve = (specifier: string, from: string): string | null => {
    const file = join(dirname(from), specifier);
    return specifier.startsWith('.') && existsSync(file) ? file : null;
  };
  const reading = readMarkupControls(fixture('EditorPage.svelte'), resolve);

  it('finds the controls of a component the page renders', () => {
    expect(names(reading.actions)).toEqual(['Publish article']);
  });

  it('leaves out every control of a component rendered under a condition about who', () => {
    expect(names(reading.actions)).not.toContain('Purge drafts');
    expect(names(reading.guarded)).toEqual(['Purge drafts']);
  });
});
