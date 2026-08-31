import type { EmbeddingRuntime, JsonSchema, LlmRuntime } from '@nextgen/core-inference';

import type { EventBus } from './events.ts';
import type {
  Module,
  ModuleCategory,
  ModuleEntry,
  ModuleSourceType,
  Repositories,
} from './entities.ts';

/**
 * Use cases.
 *
 * Same `Result`-returning discipline as `domain-finance/use-cases.ts`. The
 * difference is that capturing a module needs real reasoning — reading raw
 * text and deciding what it means, whether it belongs to something that
 * already exists, and how to fold it in without repeating itself — so this
 * file is split into two halves with different guarantees:
 *
 *  - `proposeCapture` is async, calls the model, and produces a *proposal*.
 *    Nothing here writes to a repository.
 *  - `commitCapture` is sync and deterministic, exactly like every other
 *    write in this codebase. It only runs once a human has seen the proposal
 *    on a confirmation card and approved it (`module.capture` is a `write`
 *    capability — ADR-004 applies here exactly as it does to a transaction).
 *
 * That split is the concrete answer to "the AI needs reasoning capacity, but
 * must say so when it can't do something": the model gets latitude to read,
 * summarize, and judge — it never gets to write anything the user has not
 * seen, and a failure at any step degrades to a `clarify` question rather
 * than a guess (wired in the composition root, not here).
 */

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(reason: string): Result<T> => ({ ok: false, reason });

export interface UseCaseDeps {
  readonly repositories: Repositories;
  readonly events: EventBus;
  /** Injected so a use case is deterministic under test. Never `new Date()` inline. */
  readonly now: () => Date;
  readonly newId: (prefix: string) => string;
  /** The larger local model used for extraction/dedup judgment — not the router's. */
  readonly llm: LlmRuntime;
  /** A search index over module titles/summaries — a separate corpus from the capability registry's. */
  readonly embedder: EmbeddingRuntime;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// -------------------------------------------------------------- extraction --

interface ExtractedContent {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly category: string;
}

/**
 * `body` is listed **first**, deliberately. Measured directly against
 * `llama3.1:8b`: with `body` after `title`/`summary` in the schema, a real
 * multi-section CV came back with `body: "PROFESSIONAL EXPERIENCE"` — a
 * bare section header, valid JSON, schema-satisfying, and useless. The model
 * had already "spent its effort" on the short fields first. Asked for
 * `body` first instead, the identical input came back with every section,
 * bullet, date and number intact (1056 chars vs. 24). Small local models
 * under schema-constrained decoding are measurably lazy about long fields
 * that arrive last — field order is not cosmetic here.
 */
const EXTRACT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    body: {
      type: 'string',
      description:
        'The module itself. Reproduce every section, name, date and number from the source, ' +
        'organised with line breaks — a short body is the wrong answer for anything longer than ' +
        'a sentence of source material. Never invent a detail that is not present in the source, ' +
        'and never alter a number, date or amount from how the source stated it.',
    },
    title: { type: 'string', description: 'A short, specific title for this module' },
    summary: { type: 'string', description: 'One or two sentences — just enough to recognise it in a list; the detail belongs in body, not here' },
    category: { type: 'string', description: 'One short category name, e.g. "Travel", "Health", "Home"' },
  },
  required: ['body', 'title', 'summary', 'category'],
};

/**
 * Generous on purpose. The default (200, `OllamaLlmRuntime`'s fallback) is
 * sized for a routing decision, not a written module — at 200 tokens `body`
 * comes back as a one-line blurb no matter what the prompt asks for, which
 * is what "detailed module" actually meant the first few times this was
 * measured against a real multi-section document.
 */
const CONTENT_MAX_TOKENS = 1600;

/**
 * Short and singular on purpose. Measured directly against `llama3.1:8b`
 * with a real multi-section CV: a system prompt that also covers factual
 * accuracy and category naming — genuinely correct instructions — made the
 * model treat "be thorough" as one instruction among several and it
 * produced `body: "PROFESSIONAL EXPERIENCE"`, 24 characters, technically
 * schema-valid and useless. The identical input against *this* prompt, with
 * the accuracy/category guidance moved into the schema's own field
 * descriptions instead of stacked here, came back with every section intact
 * (1056 characters). A small local model's attention to a length
 * instruction measurably degrades with each additional instruction sharing
 * the system message — keep this one instruction alone.
 */
const EXTRACT_SYSTEM =
  'You read raw notes, transcripts, or extracted document/image text and write a well-organised ' +
  'module that preserves the substance of the source. The body field is the module itself: ' +
  'reproduce every section, name, date and number from the source, organised with line breaks. ' +
  'A short body is a wrong answer for anything longer than a sentence of source material.';

async function extract(
  deps: UseCaseDeps,
  text: string,
  images?: readonly string[],
): Promise<Result<ExtractedContent>> {
  const result = await deps.llm.complete<ExtractedContent>({
    system: EXTRACT_SYSTEM,
    prompt: text || 'Read the attached image and extract what it says.',
    schema: EXTRACT_SCHEMA,
    maxTokens: CONTENT_MAX_TOKENS,
    ...(images && images.length > 0 ? { images } : {}),
  });

  if (result.value === null) {
    return fail(
      result.unavailable
        ? `the model needed for this is unavailable (${result.unavailable})`
        : 'could not read that into a module',
    );
  }
  const { title, summary, body, category } = result.value;
  if (!title?.trim() || !body?.trim()) {
    return fail('could not find anything to remember in that');
  }
  return ok({
    title: title.trim(),
    summary: (summary ?? '').trim() || title.trim(),
    body: body.trim(),
    category: (category ?? '').trim(),
  });
}

// ---------------------------------------------------- create-vs-append -----

export interface ModuleMatch {
  readonly module: Module;
  readonly score: number;
}

/** Below this, a candidate is not worth spending a judgment call on. Tunable, not load-bearing. */
const SHORTLIST_GATE = 0.5;
const SHORTLIST_SIZE = 5;

async function shortlist(deps: UseCaseDeps, extracted: ExtractedContent): Promise<readonly ModuleMatch[]> {
  const modules = deps.repositories.modules.list();
  if (modules.length === 0) return [];

  const corpus = modules.map((m) => `${m.title}. ${m.summary}`);
  // The hashing embedder needs a vocabulary fit to this corpus; the neural one
  // ignores the call (EmbeddingRuntime.fit is optional). Either way this must
  // be a *separate* embedder instance from the capability router's, or the
  // two corpora would stomp on each other's fitted vocabulary.
  deps.embedder.fit?.(corpus);

  const [query, vectors] = await Promise.all([
    deps.embedder.embed(`${extracted.title}. ${extracted.summary}`),
    deps.embedder.embedAll(corpus),
  ]);

  return modules
    .map((m, i) => ({ module: m, score: cosine(query, vectors[i] ?? []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE)
    .filter((s) => s.score >= SHORTLIST_GATE);
}

interface JudgeOutput {
  readonly decision: string;
  readonly targetId: string;
}

const JUDGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['append', 'create'] },
    targetId: { type: 'string', description: 'The id of the matching module, if decision is "append"' },
  },
  required: ['decision', 'targetId'],
};

async function judge(
  deps: UseCaseDeps,
  extracted: ExtractedContent,
  candidates: readonly ModuleMatch[],
): Promise<{ readonly decision: 'append' | 'create'; readonly targetModuleId: string | null }> {
  if (candidates.length === 0) return { decision: 'create', targetModuleId: null };

  const listing = candidates
    .map((c) => `id=${c.module.id} title="${c.module.title}" summary="${c.module.summary}"`)
    .join('\n');

  const result = await deps.llm.complete<JudgeOutput>({
    system:
      'You decide whether a new note belongs inside an existing module or needs a new one. ' +
      'Only choose an existing module if the new note is genuinely about the same specific ' +
      'topic, not merely a related category. If in doubt, create a new module.',
    prompt:
      `New note:\ntitle="${extracted.title}"\nsummary="${extracted.summary}"\n\n` +
      `Existing modules it might belong to:\n${listing}`,
    schema: JUDGE_SCHEMA,
  });

  const value = result.value;
  if (!value || value.decision !== 'append') return { decision: 'create', targetModuleId: null };

  // Rule 4's discipline, applied here: a model-produced id is untrusted until
  // checked against the shortlist actually offered. Anything else is "create".
  const match = candidates.find((c) => c.module.id === value.targetId);
  return match
    ? { decision: 'append', targetModuleId: match.module.id }
    : { decision: 'create', targetModuleId: null };
}

interface MergedContent {
  readonly summary: string;
  readonly body: string;
}

// `body` first — see EXTRACT_SCHEMA's comment; the same laziness-under-schema-order
// effect applies here, and a merge that quietly shrinks to a stub is worse
// than one that never ran, since it overwrites what was there before.
const MERGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    body: {
      type: 'string',
      description:
        'The full consolidated module, not a summary of the merge — keep every section, name, ' +
        'date and number either source actually says. Never introduce a claim present in neither ' +
        'source, and never alter a number, date or amount from how its source stated it.',
    },
    summary: { type: 'string' },
  },
  required: ['body', 'summary'],
};

// Short and singular — see EXTRACT_SYSTEM's comment; the accuracy constraint
// lives in the schema description above instead of stacked in here.
const MERGE_SYSTEM =
  "You consolidate a module's notes. The body field is the full consolidated module: combine " +
  'the existing body and the new material, remove information the two sources both say, reorder ' +
  'for clarity, and keep everything either source actually says. A shortened result is a wrong ' +
  'answer.';

async function merge(
  deps: UseCaseDeps,
  existing: Module,
  rawSource: string,
): Promise<Result<MergedContent>> {
  const result = await deps.llm.complete<MergedContent>({
    system: MERGE_SYSTEM,
    prompt: `Existing module body:\n${existing.body}\n\nNew material:\n${rawSource}`,
    schema: MERGE_SCHEMA,
    maxTokens: CONTENT_MAX_TOKENS,
  });
  if (!result.value?.body?.trim()) return fail('could not merge that into the existing module');
  return ok({
    summary: (result.value.summary || existing.summary).trim(),
    body: result.value.body.trim(),
  });
}

// -------------------------------------------------------------- capture ----

/** What the AI is prepared to do with a capture, and what a person can choose instead. */
export type CaptureDecision = 'create' | 'append' | 'interpret';

export interface CaptureCandidate {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

export interface CaptureProposal {
  /** The AI's own suggestion — never `'interpret'`; that option only exists because a person chose it. */
  readonly decision: 'create' | 'append';
  readonly targetModuleId: string | null;
  readonly targetModuleTitle: string | null;
  readonly title: string;
  readonly summary: string;
  /** Freshly extracted content — never pre-merged. A merge only happens once a person has confirmed *which* module, at commit time, over whatever body they end up approving. */
  readonly body: string;
  readonly category: string;
  /** Every existing module this could plausibly belong to, for "add to existing" to offer as real choices rather than trusting the AI's one guess. */
  readonly candidates: readonly CaptureCandidate[];
}

export interface CaptureInput {
  /** Plain text — the raw utterance, or already-extracted document/PDF text. Empty is valid when `images` carries the content instead. */
  readonly text: string;
  readonly sourceType: ModuleSourceType;
  /** Base64 image bytes, no data-URI prefix. The vision-capable model reads these directly — no separate OCR step. */
  readonly images?: readonly string[];
}

/**
 * Read the input and propose what it means: a title/summary/body/category,
 * the AI's own best guess at create-vs-append, and — regardless of that
 * guess — every existing module the input plausibly relates to. Writes
 * nothing, and merges nothing; both happen only in `commitCapture`, once a
 * person has actually chosen among the three standardised options this
 * proposal supports (create / add to a specific existing module / just
 * interpret, save nothing).
 *
 * This is what the composition root calls *before* dispatch, so its result
 * can become the `params` a `write`-kind capability's confirmation card
 * shows — the review step is the existing `ConfirmationCard`, not a new one.
 */
export async function proposeCapture(deps: UseCaseDeps, input: CaptureInput): Promise<Result<CaptureProposal>> {
  const trimmed = input.text.trim();
  const hasImages = (input.images?.length ?? 0) > 0;
  if (!trimmed && !hasImages) return fail('there is nothing to remember in that');

  const extracted = await extract(deps, trimmed, input.images);
  if (!extracted.ok) return extracted;

  const shortlisted = await shortlist(deps, extracted.value);
  const { decision, targetModuleId } = await judge(deps, extracted.value, shortlisted);
  const target = targetModuleId ? shortlisted.find((c) => c.module.id === targetModuleId) : undefined;

  return ok({
    decision,
    targetModuleId,
    targetModuleTitle: target?.module.title ?? null,
    title: extracted.value.title,
    summary: extracted.value.summary,
    body: extracted.value.body,
    category: extracted.value.category,
    candidates: shortlisted.map((c) => ({ id: c.module.id, title: c.module.title, summary: c.module.summary })),
  });
}

function resolveCategory(deps: UseCaseDeps, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = deps.repositories.moduleCategories
    .list()
    .find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;

  const category: ModuleCategory = { id: deps.newId('cat'), name: trimmed, parentId: null, icon: null };
  deps.repositories.moduleCategories.insert(category);
  return category.id;
}

export interface CommitCaptureInput {
  readonly decision: CaptureDecision;
  /** Required when `decision === 'append'`. */
  readonly targetModuleId: string | null;
  readonly title: string;
  readonly summary: string;
  /** The (possibly user-edited) extracted content. For an append, this is what gets merged into the target — not the raw source. */
  readonly body: string;
  readonly category: string;
  readonly sourceType: ModuleSourceType;
  /** The original raw material, for provenance — never the extracted/edited body. */
  readonly sourceExcerpt: string;
}

export type CommitOutcome =
  | { readonly kind: 'created'; readonly module: Module }
  | { readonly kind: 'appended'; readonly module: Module }
  /** Nothing was written — the person asked to just be told what it says. */
  | { readonly kind: 'interpreted'; readonly title: string; readonly summary: string; readonly body: string };

const SNAPSHOT_LIMIT = 4000;

/**
 * Write the (possibly user-edited) proposal, for whichever of the three
 * standardised choices the person actually made:
 *
 *  - **interpret** — the honest no-op. Nothing is persisted; the extracted
 *    content is simply handed back so it can be shown as an answer.
 *  - **append** — merges here, not in `proposeCapture`, and over whatever
 *    `body` the person ends up approving (their edits included) rather than
 *    the raw source — merging already-organised content produces a cleaner
 *    result than merging unformatted raw text.
 *  - **create** — a plain insert.
 *
 * Async only because `append` calls the model to merge; `create` and
 * `interpret` touch nothing beyond `input` and remain as deterministic as
 * every other write in this codebase.
 */
export async function commitCapture(deps: UseCaseDeps, input: CommitCaptureInput): Promise<Result<CommitOutcome>> {
  const now = deps.now().toISOString();

  if (input.decision === 'interpret') {
    return ok({ kind: 'interpreted', title: input.title, summary: input.summary, body: input.body });
  }

  if (input.decision === 'append') {
    if (!input.targetModuleId) return fail('no existing module was chosen to add this to');
    const existing = deps.repositories.modules.get(input.targetModuleId);
    if (!existing) return fail(`no module "${input.targetModuleId}"`);

    const merged = await merge(deps, existing, input.body);
    if (!merged.ok) return merged;

    // A snapshot of the pre-merge body, so module.revert has something to
    // restore. It is not itself a "source" — 'text' is the closest fit.
    deps.repositories.moduleEntries.insert({
      id: deps.newId('mentry'),
      moduleId: existing.id,
      kind: 'merge_snapshot',
      sourceType: 'text',
      sourceExcerpt: existing.body.slice(0, SNAPSHOT_LIMIT),
      createdAt: now,
    });

    const updated = deps.repositories.modules.update(existing.id, {
      summary: merged.value.summary,
      body: merged.value.body,
      updatedAt: now,
    });
    if (!updated) return fail(`could not update module "${existing.id}"`);

    const entry: ModuleEntry = {
      id: deps.newId('mentry'),
      moduleId: existing.id,
      kind: 'append',
      sourceType: input.sourceType,
      sourceExcerpt: input.sourceExcerpt.slice(0, SNAPSHOT_LIMIT),
      createdAt: now,
    };
    deps.repositories.moduleEntries.insert(entry);
    deps.events.emit({ type: 'module.appended', module: updated, entry });
    return ok({ kind: 'appended', module: updated });
  }

  const categoryId = resolveCategory(deps, input.category);
  const module: Module = {
    id: deps.newId('mod'),
    categoryId,
    title: input.title,
    summary: input.summary,
    body: input.body,
    createdAt: now,
    updatedAt: now,
  };
  try {
    deps.repositories.modules.insert(module);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  deps.repositories.moduleEntries.insert({
    id: deps.newId('mentry'),
    moduleId: module.id,
    kind: 'seed',
    sourceType: input.sourceType,
    sourceExcerpt: input.sourceExcerpt.slice(0, SNAPSHOT_LIMIT),
    createdAt: now,
  });
  deps.events.emit({ type: 'module.created', module });
  return ok({ kind: 'created', module });
}

// -------------------------------------------------------------- search -----

/** Used by `module.search`'s read handler — the same corpus/scoring as the create-vs-append shortlist. */
export async function searchModules(deps: UseCaseDeps, query: string): Promise<readonly ModuleMatch[]> {
  const trimmed = query.trim();
  const modules = deps.repositories.modules.list();
  if (modules.length === 0 || !trimmed) return [];

  const corpus = modules.map((m) => `${m.title}. ${m.summary}`);
  deps.embedder.fit?.(corpus);
  const [q, vectors] = await Promise.all([deps.embedder.embed(trimmed), deps.embedder.embedAll(corpus)]);

  return modules
    .map((m, i) => ({ module: m, score: cosine(q, vectors[i] ?? []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE);
}

// -------------------------------------------------------- delete / revert --

export function deleteModule(deps: UseCaseDeps, id: string): Result<Module> {
  const module = deps.repositories.modules.delete(id);
  if (!module) return fail(`no module "${id}"`);
  deps.events.emit({ type: 'module.deleted', module });
  return ok(module);
}

/**
 * Undo the last merge — restores the body from the last `merge_snapshot`
 * entry. Restores `body` only; a reverted `summary` is a small enough loss
 * that snapshotting it too was cut for this pass.
 */
export function revertModule(deps: UseCaseDeps, id: string): Result<Module> {
  const module = deps.repositories.modules.get(id);
  if (!module) return fail(`no module "${id}"`);

  const entries = deps.repositories.moduleEntries.listByModule(id);
  const lastSnapshot = [...entries].reverse().find((e) => e.kind === 'merge_snapshot');
  if (!lastSnapshot?.sourceExcerpt) return fail(`"${id}" has no prior version to revert to`);

  const now = deps.now().toISOString();
  const restored = deps.repositories.modules.update(id, { body: lastSnapshot.sourceExcerpt, updatedAt: now });
  if (!restored) return fail(`could not revert "${id}"`);

  deps.repositories.moduleEntries.insert({
    id: deps.newId('mentry'),
    moduleId: id,
    kind: 'revert',
    sourceType: 'text',
    sourceExcerpt: null,
    createdAt: now,
  });
  deps.events.emit({ type: 'module.reverted', module: restored });
  return ok(restored);
}
