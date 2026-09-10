import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { loadRegistry, makeEmbedder, route, thresholdsFor } from '@nextgen/core-intent';
import type {
  Capability,
  Registry,
  ScreenContext,
  TurnTrace as RouterTrace,
} from '@nextgen/core-intent';
import { FakeLlmRuntime, OllamaLlmRuntime, type EmbeddingRuntime, type LlmRuntime } from '@nextgen/core-inference';
import { PiperTtsEngine, VoiceAssetStore, WhisperCppSttEngine, type SttResult } from '@nextgen/core-voice';
import { Dispatcher, type Decision } from '@nextgen/core-dispatch';
import {
  canUndo,
  openMemoryDatabase,
  SqliteModuleCategoryRepository,
  SqliteModuleEntryRepository,
  SqliteModuleRepository,
  SqliteUndoJournal,
} from '@nextgen/data';
import {
  commitCapture,
  deleteModule,
  proposeCapture,
  relatedModules,
  revertModule,
  searchModules,
  EventBus,
  type CaptureProposal,
  type Module,
  type ModuleCategory,
  type ModuleEntry,
  type ModuleMatch,
  type Repositories,
  type UseCaseDeps,
} from '@nextgen/domain-modules';
import {
  explain,
  formatExplanation,
  SqliteTraceStore,
  TraceRecorder,
  type TurnRecorder,
  type TurnTrace,
} from '@nextgen/core-trace';

/**
 * The composition root.
 *
 * Every package until now was built and tested in isolation. This is the
 * first place they are wired into an actual turn — utterance in, router,
 * dispatcher policy, domain use case, database, trace out.
 *
 * `apps/web` (WP-09) wraps this same assembly behind a UI. Nothing here is
 * throwaway; the CLI is a surface, not a prototype.
 *
 * Renamed from `FinanceApp`: the registered domain is now `domain-modules`,
 * not `domain-finance` — see PLAN.md's WP-14. `domain-finance` is not wired
 * into `NextGenApp` (its use cases are module-specific, not generic), but it
 * is a `devDependency` here so `domain-swap.test.ts` can run the real router
 * against its registry — the actual evidence that `core-intent` is
 * domain-agnostic (WP-16), not just an assertion.
 */

export interface AppOptions {
  /** The router's stage-3 model — fast, small, picks among the ~7 module capabilities. */
  readonly model?: string;
  /** The larger model `module.capture` uses to read, summarize and judge — a different job than routing. */
  readonly moduleModel?: string;
  /** A vision-capable model, used only when a capture carries images — `moduleModel` need not be one. */
  readonly visionModel?: string;
  readonly embedder?: 'hashing' | 'ollama';
  readonly today?: string;
  /** Skip the LLM entirely. Stages 1–2 only for routing, and module.capture degrades to "say so, don't guess". */
  readonly noModel?: boolean;
  /**
   * Where `registry.json` lives.
   *
   * The CLI can find it by walking up from its own source. A bundler cannot —
   * `import.meta.dirname` means something else once the file has been through
   * one — so any host that is not this CLI passes the path in explicitly.
   */
  readonly registryPath?: string;
  /**
   * Where whisper.cpp/Piper's binaries and models are cached, downloaded and
   * verified on first use (matches `.gitignore`'s `models/` convention for
   * on-demand assets — never bundled, never committed).
   */
  readonly voiceDirectory?: string;
}

export interface TurnResult {
  readonly decision: Decision;
  /** Rendered answer, ready to print. */
  readonly output: readonly string[];
  readonly trace: TurnTrace;
}

const DEFAULT_MODULE_MODEL = 'llama3.1:8b';
const DEFAULT_VISION_MODEL = 'qwen2.5vl:7b';

/**
 * `llama3.1:8b` reads text well and cannot read an image at all; a
 * vision-capable model is a different, usually weaker-at-text pull. Rather
 * than force one model to do both jobs, this picks per-request: images
 * present → the vision model, otherwise the text model. `domain-modules`
 * stays unaware of the split — it sees one `LlmRuntime`.
 */
function visionAwareRuntime(text: LlmRuntime, vision: LlmRuntime): LlmRuntime {
  return {
    name: `${text.name} (+vision: ${vision.name})`,
    isAvailable: () => text.isAvailable(),
    complete: (request) => (request.images && request.images.length > 0 ? vision : text).complete(request),
  };
}

export class NextGenApp {
  readonly #db: DatabaseSync;
  readonly #registry: Registry;
  readonly #dispatcher: Dispatcher;
  readonly #repositories: Repositories;
  readonly #useCaseDeps: UseCaseDeps;
  readonly #recorder: TraceRecorder;
  readonly #traces: SqliteTraceStore;
  readonly #routerRuntime: LlmRuntime | undefined;
  readonly #undo: SqliteUndoJournal;
  readonly #options: Required<Pick<AppOptions, 'today' | 'embedder'>>;
  readonly #embedder: ReturnType<typeof makeEmbedder>;
  readonly #model: string | undefined;
  readonly #stt: WhisperCppSttEngine;
  readonly #tts: PiperTtsEngine;

  /** Where the user "is". Stage 1 and the slot resolvers both read this. */
  route = '/';

  private constructor(parts: {
    db: DatabaseSync;
    registry: Registry;
    embedder: ReturnType<typeof makeEmbedder>;
    moduleEmbedder: EmbeddingRuntime;
    routerRuntime: LlmRuntime | undefined;
    moduleRuntime: LlmRuntime;
    model: string | undefined;
    voiceStore: VoiceAssetStore;
    options: Required<Pick<AppOptions, 'today' | 'embedder'>>;
  }) {
    this.#db = parts.db;
    this.#registry = parts.registry;
    this.#embedder = parts.embedder;
    this.#routerRuntime = parts.routerRuntime;
    this.#model = parts.model;
    this.#options = parts.options;
    this.#stt = new WhisperCppSttEngine({ store: parts.voiceStore });
    this.#tts = new PiperTtsEngine({ store: parts.voiceStore });

    this.#repositories = {
      modules: new SqliteModuleRepository(this.#db),
      moduleCategories: new SqliteModuleCategoryRepository(this.#db),
      moduleEntries: new SqliteModuleEntryRepository(this.#db),
    };
    this.#undo = new SqliteUndoJournal(this.#db);

    // The dispatcher's journal port is async; the SQLite one is sync. Bridging
    // that is the composition root's job, not either package's.
    this.#dispatcher = new Dispatcher({
      registry: this.#registry,
      undo: {
        record: async (e) =>
          this.#undo.record({
            capabilityId: e.capabilityId,
            params: e.params,
            describedAs: e.describedAs,
            payload: this.#payloadFor(e.capabilityId, e.params),
            recordedAt: e.recordedAt,
          }),
        undo: async (token) => this.#undo.undo(token),
        get: async (token) => {
          const entry = this.#undo.get(token);
          return entry
            ? {
                capabilityId: entry.capabilityId,
                params: entry.params,
                describedAs: entry.describedAs,
                recordedAt: entry.recordedAt,
              }
            : null;
        },
      },
    });

    this.#traces = new SqliteTraceStore(this.#db, { capacity: 200 });
    this.#recorder = new TraceRecorder(this.#traces);

    let n = 0;
    this.#useCaseDeps = {
      repositories: this.#repositories,
      events: new EventBus(),
      now: () => new Date(`${this.#options.today}T12:00:00.000Z`),
      newId: (p) => `${p}_${Date.now()}_${++n}`,
      llm: parts.moduleRuntime,
      embedder: parts.moduleEmbedder,
    };
  }

  static async create(options: AppOptions = {}): Promise<NextGenApp> {
    const embedderKind = options.embedder ?? 'ollama';
    const embedder = makeEmbedder(embedderKind);
    // A separate instance for module search — sharing one with the router
    // would mean each `.fit()` call stomps the other's fitted vocabulary
    // (relevant only to the hashing embedder; the neural one is stateless).
    const moduleEmbedder = makeEmbedder(embedderKind);

    // The registry is generated from domain-modules by `pnpm registry:build`.
    const registryPath = options.registryPath ?? join(
      import.meta.dirname, '..', '..', '..',
      'packages', 'core-intent', 'eval', 'registry.json',
    );
    const registry = await loadRegistry(registryPath, embedder);

    const db = openMemoryDatabase();

    // Matches .gitignore's `models/` convention: on-demand assets, never
    // bundled, never committed. Downloaded and verified on first voice use.
    const voiceDirectory = options.voiceDirectory ?? join(
      import.meta.dirname, '..', '..', '..', 'models', 'voice',
    );
    const voiceStore = new VoiceAssetStore({ directory: voiceDirectory });

    return new NextGenApp({
      db,
      registry,
      embedder,
      moduleEmbedder,
      voiceStore,
      routerRuntime: options.noModel ? undefined : new OllamaLlmRuntime({ model: options.model }),
      // module.capture needs real reasoning — a different, larger local model
      // than the router's, and a vision-capable one specifically when a
      // capture carries images. Degrades to an honest "unavailable" rather
      // than a silent guess when no model is running at all.
      moduleRuntime: options.noModel
        ? new FakeLlmRuntime({ unavailable: 'running with --no-model' })
        : visionAwareRuntime(
            new OllamaLlmRuntime({ model: options.moduleModel ?? DEFAULT_MODULE_MODEL }),
            new OllamaLlmRuntime({ model: options.visionModel ?? DEFAULT_VISION_MODEL }),
          ),
      model: options.model,
      options: {
        today: options.today ?? '2026-08-29',
        embedder: embedderKind,
      },
    });
  }

  get context(): ScreenContext {
    return { route: this.route, today: this.#options.today };
  }

  get traceStore(): SqliteTraceStore {
    return this.#traces;
  }

  get today(): string {
    return this.#options.today;
  }

  /**
   * What the application can do, as declared.
   *
   * A surface that wants to *show* the user their options reads them from the
   * same registry the router matches against. If the two ever disagree, the UI
   * is advertising something that cannot be run — so there is only one list.
   */
  get capabilities(): readonly Capability[] {
    return this.#registry.capabilities;
  }

  /**
   * The same search `module.search`'s read handler uses, exposed so a surface
   * that wants a richer view than padded text can build one from the same
   * source rather than re-deriving it. Same reasoning as `query` in the
   * finance-era composition root: this is the only thing allowed to compute
   * the answer, and both renderers read it.
   */
  async search(query: string): Promise<readonly ModuleMatch[]> {
    return searchModules(this.#useCaseDeps, query);
  }

  /**
   * Plain reads for the module browser pages (Rule 7: `module.list`'s route
   * has to be a real, browsable screen, not just a chat answer). These carry
   * no policy — listing and viewing are `navigate`/`read`-equivalent, and
   * nothing here writes.
   */
  listModules(): readonly Module[] {
    return this.#repositories.modules.list();
  }

  listCategories(): readonly ModuleCategory[] {
    return this.#repositories.moduleCategories.list();
  }

  getModule(id: string): Module | null {
    return this.#repositories.modules.get(id);
  }

  /** Same mechanism as search()/capture-time shortlist, scoped to a saved module. */
  async relatedModules(id: string): Promise<readonly ModuleMatch[]> {
    return relatedModules(this.#useCaseDeps, id);
  }

  listEntries(moduleId: string): readonly ModuleEntry[] {
    return this.#repositories.moduleEntries.listByModule(moduleId);
  }

  /** Voice in: a 16kHz mono WAV path (already resampled client-side) → text. */
  async transcribe(wavPath: string): Promise<SttResult> {
    return this.#stt.transcribe(wavPath);
  }

  /** Voice out: text → WAV bytes. */
  async speak(text: string): Promise<Buffer> {
    return this.#tts.synthesize(text);
  }

  /**
   * One turn.
   *
   * The whole point of the assembly, in order: route, then apply policy, then —
   * only if policy allows — touch data. Nothing the model produced reaches the
   * database without passing through the dispatcher.
   *
   * `module.capture` is the one exception to "route, then dispatch": the hard
   * reasoning (extract, decide create-vs-append, merge) has to run *before*
   * dispatch, because its result — the proposed title/body/category — is what
   * the confirmation card shows. See `#proposeAndDispatchCapture`.
   *
   * `sttConfidence`, when the turn came from voice, rides straight into the
   * trace — `explain()` already knows how to report it, and did before any
   * caller populated it.
   */
  async turn(utterance: string, options?: { readonly sttConfidence?: number }): Promise<TurnResult> {
    let decision: Decision = { type: 'clarify', question: 'I did not understand that.', options: [] };
    let output: readonly string[] = [];

    await this.#recorder.run(
      {
        transcript: utterance,
        ...(this.#routerRuntime ? { modelId: this.#routerRuntime.name } : {}),
        ...(options?.sttConfidence !== undefined ? { sttConfidence: options.sttConfidence } : {}),
        promptVersion: 'v3',
      },
      async (r) => {
        const routed: RouterTrace = await route(utterance, this.context, {
          registry: this.#registry,
          embedder: this.#embedder,
          thresholds: thresholdsFor(this.#options.embedder),
          useStage3: this.#routerRuntime !== undefined,
          runtime: this.#routerRuntime,
          model: this.#model,
        });

        // --- carry the routing decision into the trace ------------------------
        r.decidedAt(routed.decidedAt);
        r.candidates(routed.candidates);
        r.capability(routed.capabilityId, routed.kind, routed.route);
        r.missing(routed.missing);
        for (const note of routed.notes) r.note(note);
        if (routed.latency.stage1 !== undefined) r.stageLatency('stage1', routed.latency.stage1);
        if (routed.latency.stage2 !== undefined) r.stageLatency('stage2', routed.latency.stage2);
        if (routed.latency.stage3 !== undefined) r.stageLatency('stage3', routed.latency.stage3);

        // --- policy, or — for a capture turn — propose first -------------------
        if (routed.capabilityId === 'module.capture') {
          const text = String(routed.params.body ?? utterance);
          decision = await this.#proposeAndDispatchCapture(
            r, text, 'text', undefined, routed.latency.stage3 ?? 0,
          );
        } else {
          for (const [name, value] of Object.entries(routed.params)) {
            r.param(name, value, this.#isDeterministic(name) ? 'deterministic' : 'model');
          }
          decision = this.#dispatcher.decide({
            capabilityId: routed.capabilityId,
            params: routed.params,
            missing: routed.missing,
            candidates: routed.candidates.map((c) => c.capabilityId),
          });
        }

        r.requiresConfirmation(decision.type === 'confirm');
        r.outcome(
          decision.type === 'execute' ? 'execute'
            : decision.type === 'refuse' ? 'out_of_scope'
              : 'clarify',
        );

        // --- act, only if policy allows --------------------------------------
        if (decision.type === 'execute') {
          const { lines, dataRead } = await this.#read(decision.capabilityId, decision.params);
          output = lines;
          for (const d of dataRead) r.read(d);
          if (decision.route) this.route = decision.route;
        } else if (decision.type === 'refuse') {
          output = [decision.reason];
        } else if (decision.type === 'confirm') {
          output = this.#describeConfirmation(decision);
        } else {
          output = [decision.question, ...decision.options.map((o) => `  · ${o}`)];
        }
      },
    );

    return { decision, output, trace: this.#traces.latest()! };
  }

  /**
   * Run a capability the user picked by hand.
   *
   * Rule 7 taken literally: a path that does not consult the router at all —
   * a capability id straight into the dispatcher. Policy is unchanged: a
   * `write` picked from a menu still produces a confirmation card.
   */
  async invoke(capabilityId: string): Promise<TurnResult> {
    const cap = this.#registry.byId.get(capabilityId);
    if (!cap) throw new Error(`unknown capability "${capabilityId}"`);

    let decision: Decision = { type: 'refuse', reason: 'not runnable', declared: false };
    let output: readonly string[] = [];

    await this.#recorder.run(
      { transcript: cap.title, promptVersion: 'v3' },
      async (r) => {
        r.decidedAt('deterministic');
        r.candidates([{ capabilityId, score: 1 }]);
        r.capability(cap.id, cap.kind, cap.route);
        r.missing([]);
        r.note('chosen directly from the menu; the router was not consulted');

        decision = this.#dispatcher.decide({
          capabilityId,
          params: {},
          missing: [],
          candidates: [capabilityId],
        });

        r.requiresConfirmation(decision.type === 'confirm');
        r.outcome(
          decision.type === 'execute' ? 'execute'
            : decision.type === 'refuse' ? 'out_of_scope'
              : 'clarify',
        );

        if (decision.type === 'execute') {
          const { lines, dataRead } = await this.#read(decision.capabilityId, decision.params);
          output = lines;
          for (const d of dataRead) r.read(d);
          if (decision.route) this.route = decision.route;
        } else if (decision.type === 'refuse') {
          output = [decision.reason];
        } else if (decision.type === 'confirm') {
          output = this.#describeConfirmation(decision);
        } else {
          output = [decision.question, ...decision.options.map((o) => `  · ${o}`)];
        }
      },
    );

    return { decision, output, trace: this.#traces.latest()! };
  }

  /**
   * Carry out a confirmed write.
   *
   * Separate from `turn()` on purpose: the confirmation is not a formality the
   * caller can skip, it is a different call that only exists once the user has
   * seen the parsed parameters (ADR-004).
   */
  async confirm(decision: Decision): Promise<readonly string[]> {
    if (decision.type !== 'confirm') return ['nothing to confirm'];

    const approved = await this.#dispatcher.approve(decision);
    if (approved.type === 'refuse') return [`refused: ${approved.reason}`];
    if (approved.type !== 'approved') return ['could not approve'];

    const { capabilityId, params } = approved;

    switch (capabilityId) {
      case 'module.capture': {
        const sourceType = params.sourceType;
        const action = String(params.action ?? 'create');
        const decision = action === 'interpret' ? 'interpret' : action.startsWith('append:') ? 'append' : 'create';
        const targetModuleId = action.startsWith('append:') ? action.slice('append:'.length) : null;

        const r = await commitCapture(this.#useCaseDeps, {
          decision,
          targetModuleId,
          title: String(params.title ?? 'Untitled'),
          summary: String(params.summary ?? ''),
          body: String(params.body ?? ''),
          category: String(params.category ?? ''),
          sourceType:
            sourceType === 'image' || sourceType === 'document' || sourceType === 'voice' ? sourceType : 'text',
          sourceExcerpt: String(params.sourceExcerpt ?? params.body ?? ''),
        });
        if (!r.ok) return [`Could not do that: ${r.reason}`];

        switch (r.value.kind) {
          case 'created': return [`Saved "${r.value.module.title}".`];
          case 'appended': return [`Added to "${r.value.module.title}".`];
          case 'interpreted': return [r.value.title, r.value.body];
        }
      }
      case 'module.delete': {
        const r = deleteModule(this.#useCaseDeps, String(params.target ?? ''));
        return r.ok
          ? [`Deleted "${r.value.title}".`, `Undo with the token in the trace.`]
          : [`Could not delete it: ${r.reason}`];
      }
      case 'module.revert': {
        const r = revertModule(this.#useCaseDeps, String(params.target ?? ''));
        return r.ok ? [`Reverted "${r.value.title}" to its previous version.`] : [`Could not revert it: ${r.reason}`];
      }
      default:
        return [`"${capabilityId}" is confirmed but has no action wired up yet.`];
    }
  }

  /** "Why did you do that?" — rendered from the record, never from a model. */
  why(): string {
    const trace = this.#traces.latest();
    return trace ? formatExplanation(explain(trace)) : 'No turns yet.';
  }

  // ------------------------------------------------------------- capture ----

  /**
   * The one place a turn does real work *before* the dispatcher sees it.
   *
   * `module.capture`'s hard reasoning — extract, decide create-vs-append,
   * merge — has to happen here so its result can become the confirmation
   * card's editable fields. On failure this builds a `clarify` directly with
   * the actual reason, rather than routing through the dispatcher's generic
   * "missing param" question — "the model needed for this is unavailable" is
   * a better answer than "Which body?".
   *
   * Shared by both entry points: a chat turn the router recognised as a
   * capture (`turn()`), and a file/image upload that bypasses the router
   * entirely (`captureFromContent()`) — the reasoning is identical either
   * way, only where the raw material came from differs.
   */
  async #proposeAndDispatchCapture(
    r: TurnRecorder,
    text: string,
    sourceType: 'text' | 'image' | 'document' | 'voice',
    images: readonly string[] | undefined,
    routerStage3Ms: number,
  ): Promise<Decision> {
    const startedAt = performance.now();
    const proposal = await proposeCapture(this.#useCaseDeps, { text, sourceType, ...(images ? { images } : {}) });
    // The router's own `stage3` is a different model call than this one, but
    // it is the one field `explain()` reads to say "the model was used, Nms"
    // vs "without using the model at all" — added rather than overwritten, so
    // a turn that needed both is not under-reported either way.
    r.stageLatency('stage3', routerStage3Ms + (performance.now() - startedAt));

    if (!proposal.ok) {
      r.note(`module.capture: ${proposal.reason}`);
      return { type: 'clarify', question: proposal.reason, options: [] };
    }

    const value: CaptureProposal = proposal.value;
    // The standardised question: create / add to one of these specific
    // existing modules / just interpret and save nothing. Defaults to the
    // AI's own suggestion, but every shortlisted module is offered as a
    // real alternative — deciding *which* module this belongs to is the
    // person's call, not something the AI silently commits to.
    const defaultAction = value.decision === 'append' && value.targetModuleId
      ? `append:${value.targetModuleId}`
      : 'create';
    const params: Record<string, string> = {
      action: defaultAction,
      title: value.title,
      summary: value.summary,
      body: value.body,
      category: value.category,
      sourceType,
      sourceExcerpt: text || `[${sourceType}]`,
      // Carries the candidate list to the renderer as the field's options —
      // not a value anyone edits directly, so it stays out of the visible
      // param list (apps/web/lib/render.ts hides it explicitly).
      candidatesJson: JSON.stringify(value.candidates),
    };

    for (const [name, val] of Object.entries(params)) {
      r.param(name, val, 'model');
    }
    if (value.decision === 'append') {
      r.note(`proposing to append to the existing module "${value.targetModuleTitle}"`);
    }
    if (value.candidates.length > 0) {
      r.note(`${value.candidates.length} existing module(s) offered as alternatives: ${value.candidates.map((c) => c.title).join(', ')}`);
    }

    return this.#dispatcher.decide({
      capabilityId: 'module.capture',
      params,
      missing: [],
      candidates: ['module.capture'],
    });
  }

  /**
   * Capture from an upload — a photo or a document, rather than something
   * typed. Bypasses the router the same way `invoke()` does (Rule 7's "menu
   * selections cannot be misrouted", applied to an upload instead of a menu
   * tap): there is no sentence to route, so there is nothing for the 1.5B
   * model to get wrong here.
   */
  async captureFromContent(input: {
    readonly text: string;
    readonly sourceType: 'text' | 'image' | 'document' | 'voice';
    readonly images?: readonly string[];
  }): Promise<TurnResult> {
    let decision: Decision = { type: 'refuse', reason: 'not runnable', declared: false };
    let output: readonly string[] = [];

    await this.#recorder.run(
      { transcript: `[${input.sourceType} upload]`, promptVersion: 'v3' },
      async (r) => {
        r.decidedAt('deterministic');
        r.candidates([{ capabilityId: 'module.capture', score: 1 }]);
        r.capability('module.capture', 'write', '/modules/new');
        r.missing([]);
        r.note('uploaded directly; the router was not consulted');

        decision = await this.#proposeAndDispatchCapture(r, input.text, input.sourceType, input.images, 0);

        r.requiresConfirmation(decision.type === 'confirm');
        r.outcome(
          decision.type === 'execute' ? 'execute'
            : decision.type === 'refuse' ? 'out_of_scope'
              : 'clarify',
        );

        if (decision.type === 'refuse') {
          output = [decision.reason];
        } else if (decision.type === 'confirm') {
          output = this.#describeConfirmation(decision);
        } else if (decision.type === 'clarify') {
          output = [decision.question, ...decision.options.map((o) => `  · ${o}`)];
        }
      },
    );

    return { decision, output, trace: this.#traces.latest()! };
  }

  // -------------------------------------------------------------- reading --

  async #read(
    capabilityId: string,
    params: Readonly<Record<string, string | number>>,
  ): Promise<{ lines: string[]; dataRead: { table: string; rowCount: number; from?: string; to?: string }[] }> {
    switch (capabilityId) {
      case 'module.search': {
        const query = String(params.query ?? '');
        const matches: readonly ModuleMatch[] = await searchModules(this.#useCaseDeps, query);
        if (matches.length === 0) {
          return { lines: [`Nothing saved yet matches "${query}".`], dataRead: [{ table: 'modules', rowCount: 0 }] };
        }
        const [best, ...rest] = matches;
        const lines = [
          `${best!.module.title}`,
          best!.module.body,
          ...(rest.length > 0 ? ['', `Also related: ${rest.map((m) => m.module.title).join(', ')}`] : []),
        ];
        return { lines, dataRead: [{ table: 'modules', rowCount: matches.length }] };
      }
      default: {
        // A navigate capability with nothing to read: the route already changed.
        // The declared explanation rides along (WP-36) — §1.1's promise is to
        // take the user there *and* tell them what they will find. It was
        // written when the registry was built, so printing it costs nothing.
        const cap = this.#registry.byId.get(capabilityId);
        return {
          lines: [
            `→ ${cap?.route ?? '/'}  (${cap?.title ?? capabilityId})`,
            ...(cap?.explanation ? [cap.explanation] : []),
          ],
          dataRead: [],
        };
      }
    }
  }

  // ---------------------------------------------------------- confirmation --

  /**
   * The confirmation card, as text.
   *
   * ADR-004 rule 1: it shows the **parsed parameters**, not the utterance —
   * for `module.capture` that means the proposed title/category/body, so a
   * wrong guess is caught and edited here rather than silently saved.
   */
  #describeConfirmation(decision: Extract<Decision, { type: 'confirm' }>): string[] {
    // The warning is *derived*, not asserted. It used to read "this cannot be
    // undone without the journal" for every destructive action — which promises a
    // journal that can, and for `module.delete` and `module.revert` no restore
    // path exists at all (PLAN.md §4 defect 3, WP-18). Telling a user an action is
    // recoverable at the moment they confirm it, when it is not, is the worst
    // possible place to be wrong.
    const reversible = decision.destructive && canUndo(decision.capabilityId);
    const headline = decision.destructive
      ? reversible
        ? `⚠  ${decision.title} — you can undo this afterwards.`
        : `⚠  ${decision.title} — this is permanent and cannot be undone.`
      : `${decision.title}?`;
    const lines = [headline, ''];
    for (const [name, value] of Object.entries(decision.params)) {
      // provenance/internal, not something to review as its own line
      if (name === 'sourceExcerpt' || name === 'sourceType' || name === 'candidatesJson') continue;
      lines.push(`    ${name.padEnd(12)} ${String(value)}`);
    }
    lines.push('', 'Type  yes  to confirm, or anything else to cancel.');
    return lines;
  }

  #payloadFor(capabilityId: string, params: Readonly<Record<string, string | number>>): unknown {
    // A destructive undo needs the row itself, captured BEFORE the delete.
    if (capabilityId === 'module.delete' || capabilityId === 'module.revert') {
      return this.#repositories.modules.get(String(params.target ?? ''));
    }
    return params;
  }

  #isDeterministic(name: string): boolean {
    // Nothing in the modules domain has a deterministic slot resolver — every
    // module capability's params are free text (query/target) or model-read
    // content (module.capture's proposal). Kept as its own method, matching
    // domain-finance's shape, so a future capability with a real resolver
    // (a date, say) has one place to declare it.
    return false;
  }
}
