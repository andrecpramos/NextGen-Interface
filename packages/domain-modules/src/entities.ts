/**
 * Modules entities.
 *
 * The pivot: instead of a fixed, developer-defined set of capabilities over
 * one topic (finance), the user tells the AI what to remember and the AI
 * organizes it — arbitrary topic, arbitrary category, entirely built at
 * runtime. What matters about this file is the same thing that mattered about
 * `domain-finance/entities.ts`: no `core-*` package imports anything from
 * here, and the boundary test asserts it.
 */

export type ModuleEntryKind = 'seed' | 'append' | 'merge_snapshot' | 'revert';
export type ModuleSourceType = 'text' | 'image' | 'document' | 'voice';

export interface ModuleCategory {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly icon: string | null;
}

export interface Module {
  readonly id: string;
  readonly categoryId: string | null;
  readonly title: string;
  readonly summary: string;
  /** UNTRUSTED — model-consolidated prose. Fence before this reaches a prompt. */
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModuleEntry {
  readonly id: string;
  readonly moduleId: string;
  readonly kind: ModuleEntryKind;
  readonly sourceType: ModuleSourceType;
  /** UNTRUSTED. */
  readonly sourceExcerpt: string | null;
  readonly createdAt: string;
}

// ------------------------------------------------------------------- ports --

/**
 * The repository ports.
 *
 * Declared here, by the domain, and implemented in `@nextgen/data`. The
 * dependency edge runs **neither way** — see `domain-finance/entities.ts` for
 * why that asymmetry is worth more than the usual arrangement. `domain.test.ts`
 * asserts the fit at compile time.
 */
export interface ModuleCategoryRepository {
  insert(c: ModuleCategory): void;
  get(id: string): ModuleCategory | null;
  list(): readonly ModuleCategory[];
}

export interface ModuleRepository {
  insert(m: Module): void;
  get(id: string): Module | null;
  list(): readonly Module[];
  update(
    id: string,
    patch: Partial<Pick<Module, 'categoryId' | 'title' | 'summary' | 'body' | 'updatedAt'>>,
  ): Module | null;
  delete(id: string): Module | null;
}

export interface ModuleEntryRepository {
  insert(e: ModuleEntry): void;
  listByModule(moduleId: string): readonly ModuleEntry[];
}

export interface Repositories {
  readonly modules: ModuleRepository;
  readonly moduleCategories: ModuleCategoryRepository;
  readonly moduleEntries: ModuleEntryRepository;
}
