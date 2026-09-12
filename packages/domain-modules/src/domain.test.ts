import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRegistry } from '@nextgen/core-capability';
import { FakeEmbeddingRuntime, FakeLlmRuntime } from '@nextgen/core-inference';
import {
  openMemoryDatabase,
  SqliteModuleCategoryRepository,
  SqliteModuleEntryRepository,
  SqliteModuleRepository,
} from '@nextgen/data';

import { boundary, capabilities, registry } from './capabilities.ts';
import { EventBus } from './events.ts';
import {
  commitCapture, deleteModule, proposeCapture, relatedModules, revertModule, searchModules,
  type UseCaseDeps,
} from './use-cases.ts';
import type {
  ModuleCategoryRepository, ModuleEntryRepository, ModuleRepository, Repositories,
} from './entities.ts';

// ------------------------------------------------------------ the ports fit --

/**
 * The port/adapter fit, asserted at compile time — same reasoning as
 * `domain-finance/domain.test.ts`: TypeScript is structural, so `@nextgen/data`'s
 * classes satisfy the domain's ports without either package importing the
 * other's version.
 */
const _modules: ModuleRepository = new SqliteModuleRepository(openMemoryDatabase());
const _categories: ModuleCategoryRepository = new SqliteModuleCategoryRepository(openMemoryDatabase());
const _entries: ModuleEntryRepository = new SqliteModuleEntryRepository(openMemoryDatabase());
void [_modules, _categories, _entries];

// --------------------------------------------------------------- fixtures --

function setup(llm?: FakeLlmRuntime, embedder?: FakeEmbeddingRuntime) {
  const db = openMemoryDatabase();
  const repositories: Repositories = {
    modules: new SqliteModuleRepository(db),
    moduleCategories: new SqliteModuleCategoryRepository(db),
    moduleEntries: new SqliteModuleEntryRepository(db),
  };
  const events = new EventBus();
  let n = 0;
  const deps: UseCaseDeps = {
    repositories,
    events,
    now: () => new Date('2026-08-29T12:00:00.000Z'),
    newId: (p) => `${p}_${++n}`,
    llm: llm ?? new FakeLlmRuntime(),
    embedder: embedder ?? new FakeEmbeddingRuntime(),
  };
  return { db, deps, events, repositories };
}

// ------------------------------------------------------------- Rule 1 ------

describe('Rule 1 — no core-* package imports domain-modules', () => {
  const repoRoot = join(import.meta.dirname, '..', '..', '..');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|js|mjs|cjs)$/.test(entry)) out.push(full);
    }
    return out;
  }

  const corePackages = readdirSync(join(repoRoot, 'packages')).filter((p) => p.startsWith('core-'));

  it('finds the core packages it is meant to be checking', () => {
    expect(corePackages.length).toBeGreaterThanOrEqual(5);
  });

  for (const pkg of corePackages) {
    it(`${pkg} does not import domain-modules`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(join(repoRoot, 'packages', pkg))) {
        const text = readFileSync(file, 'utf8');
        if (/domain-modules|domain_modules/.test(text)) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    });

    it(`${pkg} does not declare domain-modules as a dependency`, () => {
      const raw = readFileSync(join(repoRoot, 'packages', pkg, 'package.json'), 'utf8').replace(/^﻿/, '');
      const pkgJson = JSON.parse(raw);
      const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      expect(Object.keys(deps)).not.toContain('@nextgen/domain-modules');
    });
  }
});

// -------------------------------------------------------- the registry ------

describe('capability registry', () => {
  it('validates', () => {
    const result = validateRegistry(registry);
    expect(result.errors).toEqual([]);
  });

  it('classifies every capability and gives each at least three examples', () => {
    for (const c of registry.capabilities) {
      expect(['navigate', 'read', 'write', 'destructive', 'unsupported']).toContain(c.kind);
      expect((c.examples ?? []).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives every executable capability a route — reachable without the AI (Rule 7)', () => {
    for (const c of capabilities) {
      expect(c.route, `${c.id} has no route`).toBeTruthy();
      expect(c.route!.startsWith('/')).toBe(true);
    }
  });

  it('gives every declared limit a refusal and no route', () => {
    for (const b of boundary) {
      expect(b.refusal, `${b.id} has no refusal`).toBeTruthy();
      expect(b.route).toBeNull();
    }
  });

  it('covers the module lifecycle: capture, browse, search, delete, revert', () => {
    const ids = new Set(capabilities.map((c) => c.id));
    for (const id of ['module.capture', 'module.list', 'module.search', 'module.delete', 'module.revert']) {
      expect(ids, `missing ${id}`).toContain(id);
    }
  });
});

// ------------------------------------------------------- capture pipeline --

describe('proposeCapture', () => {
  it('creates a new module when nothing matches — the shortlist is empty on a fresh database', async () => {
    const { deps } = setup(
      new FakeLlmRuntime({
        fallback: { title: 'Passport renewal', summary: 'Expires June 2027.', body: 'Passport expires June 2027.', category: 'Travel' },
      }),
    );
    const r = await proposeCapture(deps, { text: 'my passport expires in June 2027', sourceType: 'text' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.decision).toBe('create');
    expect(r.ok && r.value.title).toBe('Passport renewal');
  });

  it('refuses rather than guessing when the model is unavailable — "say so, do not guess"', async () => {
    const { deps } = setup(new FakeLlmRuntime({ unavailable: 'no model running' }));
    const r = await proposeCapture(deps, { text: 'anything', sourceType: 'text' });
    expect(r).toMatchObject({ ok: false });
  });

  it('refuses rather than guessing on empty input', async () => {
    const { deps } = setup();
    const r = await proposeCapture(deps, { text: '   ', sourceType: 'text' });
    expect(r).toMatchObject({ ok: false });
  });

  it('proposes append with the AI\'s suggestion, but the body stays fresh-extracted — merging happens at commit, not here', async () => {
    const { deps, repositories } = setup(
      new FakeLlmRuntime({
        completions: [
          // judge() — the prompt lists the shortlist candidates.
          { whenPromptContains: 'Existing modules it might belong to', value: { decision: 'append', targetId: 'mod_existing' } },
          // extract() — the prompt is the raw text itself.
          { whenPromptContains: 'the wifi password is now hunter2', value: {
            title: 'Wifi password', summary: 'Router wifi credentials.', body: 'Wifi password: hunter2.', category: 'Home',
          } },
        ],
      }),
      // Every embedding is identical, so cosine similarity is 1 — always shortlisted.
      new FakeEmbeddingRuntime(4),
    );
    repositories.modules.insert({
      id: 'mod_existing', categoryId: null, title: 'Wifi password', summary: 'Router wifi credentials.',
      body: 'Wifi password: oldpassword.', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const r = await proposeCapture(deps, { text: 'the wifi password is now hunter2', sourceType: 'text' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toMatchObject({
      decision: 'append', targetModuleId: 'mod_existing', targetModuleTitle: 'Wifi password',
      // The fresh extraction, not a merged result — proposeCapture never calls merge().
      body: 'Wifi password: hunter2.',
      candidates: [{ id: 'mod_existing', title: 'Wifi password' }],
    });
  });

  it('offers every shortlisted module as a candidate, not only the one the AI picked', async () => {
    const { deps, repositories } = setup(
      new FakeLlmRuntime({
        completions: [
          { whenPromptContains: 'Existing modules it might belong to', value: { decision: 'create', targetId: '' } },
          { whenPromptContains: 'a note about something', value: {
            title: 'Something', summary: 'A note.', body: 'A note about something.', category: 'Other',
          } },
        ],
      }),
      new FakeEmbeddingRuntime(4),
    );
    repositories.modules.insert({
      id: 'mod_a', categoryId: null, title: 'Module A', summary: 'First.',
      body: 'x', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    repositories.modules.insert({
      id: 'mod_b', categoryId: null, title: 'Module B', summary: 'Second.',
      body: 'x', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const r = await proposeCapture(deps, { text: 'a note about something', sourceType: 'text' });
    // The AI suggested create — but both existing modules are still offered,
    // since the standardised choice is the person's to make, not just the AI's.
    expect(r.ok && r.value.decision).toBe('create');
    expect(r.ok && r.value.candidates.map((c) => c.id).sort()).toEqual(['mod_a', 'mod_b']);
  });

  it('never trusts a judged targetId outside the shortlist it was actually offered (Rule 4, applied here)', async () => {
    const { deps, repositories } = setup(
      new FakeLlmRuntime({
        completions: [
          { whenPromptContains: 'some new note', value: { title: 'New thing', summary: 'A new thing.', body: 'A new thing.', category: 'Other' } },
          // The model names an id that was never in the shortlist.
          { whenPromptContains: 'Existing modules it might belong to', value: { decision: 'append', targetId: 'mod_hallucinated' } },
        ],
      }),
      new FakeEmbeddingRuntime(4),
    );
    repositories.modules.insert({
      id: 'mod_real', categoryId: null, title: 'Something else', summary: 'Something else entirely.',
      body: 'Body.', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });

    const r = await proposeCapture(deps, { text: 'some new note', sourceType: 'text' });
    expect(r.ok && r.value.decision).toBe('create');
    expect(r.ok && r.value.targetModuleId).toBeNull();
  });
});

describe('commitCapture', () => {
  it('creates a module, resolving a fresh category by name', async () => {
    const { deps, repositories, events } = setup();
    const r = await commitCapture(deps, {
      decision: 'create', targetModuleId: null, title: 'Passport renewal', summary: 'Expires 2027.',
      body: 'Passport expires June 2027.', category: 'Travel', sourceType: 'text', sourceExcerpt: 'my passport expires in June 2027',
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.kind).toBe('created');
    const category = repositories.moduleCategories.list().find((c) => c.name === 'Travel');
    expect(category).toBeTruthy();
    expect(r.ok && r.value.kind === 'created' && r.value.module.categoryId).toBe(category!.id);
    expect(events.recorded.map((e) => e.type)).toEqual(['module.created']);
  });

  it('reuses an existing category rather than creating a duplicate', async () => {
    const { deps, repositories } = setup();
    repositories.moduleCategories.insert({ id: 'cat_travel', name: 'Travel', parentId: null, icon: null });
    await commitCapture(deps, {
      decision: 'create', targetModuleId: null, title: 'Visa', summary: 'Visa notes.', body: 'Visa notes.',
      category: 'travel', sourceType: 'text', sourceExcerpt: 'visa notes',
    });
    expect(repositories.moduleCategories.list().filter((c) => c.name.toLowerCase() === 'travel')).toHaveLength(1);
  });

  it('interprets without writing anything — the honest "just tell me" path', async () => {
    const { deps, repositories, events } = setup();
    const r = await commitCapture(deps, {
      decision: 'interpret', targetModuleId: null, title: 'Passport renewal', summary: 'Expires 2027.',
      body: 'Passport expires June 2027.', category: 'Travel', sourceType: 'text', sourceExcerpt: 'my passport expires in June 2027',
    });
    expect(r.ok && r.value).toMatchObject({ kind: 'interpreted', title: 'Passport renewal' });
    expect(repositories.modules.list()).toEqual([]);
    expect(events.recorded).toEqual([]);
  });

  it('appending merges the edited body into the target and snapshots the pre-merge body first', async () => {
    const { deps, repositories } = setup(
      new FakeLlmRuntime({
        completions: [
          { whenPromptContains: 'Existing module body', value: { summary: 'Wifi info, updated.', body: 'Merged: old and new password.' } },
        ],
      }),
    );
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Wifi', summary: 'Wifi info.', body: 'Old password.',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const r = await commitCapture(deps, {
      decision: 'append', targetModuleId: 'mod1', title: 'Wifi', summary: 'Wifi info, updated.',
      body: 'New password.', category: '', sourceType: 'text', sourceExcerpt: 'the password changed',
    });
    expect(r.ok && r.value.kind).toBe('appended');
    // The merge ran — the stored body is the model's merged result, not the raw edited body verbatim.
    expect(repositories.modules.get('mod1')).toMatchObject({ body: 'Merged: old and new password.' });
    const snapshot = repositories.moduleEntries.listByModule('mod1').find((e) => e.kind === 'merge_snapshot');
    expect(snapshot?.sourceExcerpt).toBe('Old password.');
  });

  it('refuses an append with no target rather than guessing one', async () => {
    const { deps } = setup();
    const r = await commitCapture(deps, {
      decision: 'append', targetModuleId: null, title: 'Wifi', summary: 'x', body: 'x',
      category: '', sourceType: 'text', sourceExcerpt: 'x',
    });
    expect(r).toMatchObject({ ok: false });
  });
});

describe('searchModules', () => {
  it('returns nothing on an empty database or an empty query', async () => {
    const { deps } = setup();
    expect(await searchModules(deps, 'wifi')).toEqual([]);
    const { deps: deps2, repositories } = setup();
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Wifi', summary: 'Wifi info.', body: 'x',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(await searchModules(deps2, '   ')).toEqual([]);
  });

  it('finds a module by a word that only appears in the body, not the title or summary', async () => {
    const { deps, repositories } = setup(undefined, new FakeEmbeddingRuntime(64));
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Home info', summary: 'Notes about the apartment.',
      body: 'The wifi password is on the router label underneath.',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const results = await searchModules(deps, 'router label');
    expect(results.map((r) => r.module.id)).toContain('mod1');
  });
});

describe('relatedModules', () => {
  it('returns nothing for an unknown module id, an empty database, or a lone module', async () => {
    const { deps, repositories } = setup(undefined, new FakeEmbeddingRuntime(64));
    expect(await relatedModules(deps, 'mod_nonexistent')).toEqual([]);

    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Wifi', summary: 'Wifi info.', body: 'x',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(await relatedModules(deps, 'mod1')).toEqual([]);
    expect(await relatedModules(deps, 'mod_nonexistent')).toEqual([]);
  });

  it('excludes the module itself even when another module scores identically', async () => {
    const { deps, repositories } = setup(undefined, new FakeEmbeddingRuntime(64));
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Passport', summary: 'Passport details.', body: 'Expires June 2027.',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    repositories.modules.insert({
      id: 'mod2', categoryId: null, title: 'Passport', summary: 'Passport details.', body: 'Expires June 2027.',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const results = await relatedModules(deps, 'mod1');
    expect(results.map((r) => r.module.id)).toEqual(['mod2']);
  });

  it('excludes a module sharing no real vocabulary with the target', async () => {
    const { deps, repositories } = setup(undefined, new FakeEmbeddingRuntime(64));
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Passport', summary: 'Passport renewal details.', body: 'Expires June 2027.',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    repositories.modules.insert({
      id: 'mod2', categoryId: null, title: 'Gym membership', summary: 'Fitness class schedule.', body: 'Tuesdays at 6pm.',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const results = await relatedModules(deps, 'mod1');
    expect(results.map((r) => r.module.id)).not.toContain('mod2');
  });

  it('respects an explicit limit', async () => {
    const { deps, repositories } = setup(undefined, new FakeEmbeddingRuntime(64));
    for (let i = 0; i < 7; i++) {
      repositories.modules.insert({
        id: `mod${i}`, categoryId: null, title: 'Passport', summary: 'Passport renewal details.', body: 'Expires June 2027.',
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
      });
    }
    const results = await relatedModules(deps, 'mod0', { limit: 2 });
    expect(results.length).toBe(2);
  });

  it('truncates the body past CORPUS_BODY_CHARS, so a word far beyond the cutoff cannot drive a match', async () => {
    // A larger dim keeps these specific tokens collision-free in the hashing embedder.
    const { deps, repositories } = setup(undefined, new FakeEmbeddingRuntime(256));
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Wombat', summary: 'Marsupial.',
      // 2005 filler chars push the shared word past the 2000-char cutoff, so it never
      // reaches the corpus. Without truncation this word alone would dominate both
      // vectors and score well above the relatedness gate.
      body: `${'q'.repeat(2005)} ${'zzzqux '.repeat(30)}`,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    repositories.modules.insert({
      id: 'mod2', categoryId: null, title: 'Gecko', summary: 'Reptile.',
      body: 'zzzqux '.repeat(30),
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const results = await relatedModules(deps, 'mod1');
    expect(results.map((r) => r.module.id)).not.toContain('mod2');
  });
});

describe('delete and revert', () => {
  it('returns the deleted module so undo has something to restore', () => {
    const { deps, repositories } = setup();
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Wifi', summary: 'Wifi info.', body: 'x',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(deleteModule(deps, 'mod1')).toMatchObject({ ok: true, value: { id: 'mod1' } });
    expect(deleteModule(deps, 'mod1').ok).toBe(false);
  });

  it('refuses to revert a module with no merge history', () => {
    const { deps, repositories } = setup();
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Wifi', summary: 'Wifi info.', body: 'x',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(revertModule(deps, 'mod1').ok).toBe(false);
  });

  it('restores the body from the last snapshot', () => {
    const { deps, repositories } = setup();
    repositories.modules.insert({
      id: 'mod1', categoryId: null, title: 'Wifi', summary: 'Wifi info.', body: 'New password.',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    });
    repositories.moduleEntries.insert({
      id: 'e1', moduleId: 'mod1', kind: 'merge_snapshot', sourceType: 'text',
      sourceExcerpt: 'Old password.', createdAt: '2026-08-01T00:00:00.000Z',
    });
    const r = revertModule(deps, 'mod1');
    expect(r.ok && r.value.body).toBe('Old password.');
  });
});
