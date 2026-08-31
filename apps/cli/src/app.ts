import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { loadRegistry, makeEmbedder, route, thresholdsFor } from '@nextgen/core-intent';
import type {
  Capability,
  Registry,
  ScreenContext,
  TurnTrace as RouterTrace,
} from '@nextgen/core-intent';
import { OllamaLlmRuntime, type LlmRuntime } from '@nextgen/core-inference';
import { Dispatcher, type Decision } from '@nextgen/core-dispatch';
import {
  openMemoryDatabase,
  seed,
  SqliteAccountRepository,
  SqliteBudgetRepository,
  SqliteCategoryRepository,
  SqliteQueryEngine,
  SqliteTransactionRepository,
  SqliteUndoJournal,
  formatMoney,
  type CurrencyCode,
} from '@nextgen/data';
import {
  createTransaction,
  deleteBudget,
  deleteTransaction,
  setBudget,
  EventBus,
  type Repositories,
  type UseCaseDeps,
} from '@nextgen/domain-finance';
import {
  explain,
  formatExplanation,
  SqliteTraceStore,
  TraceRecorder,
  type TurnTrace,
} from '@nextgen/core-trace';

/**
 * The composition root.
 *
 * Every package until now was built and tested in isolation. This is the first
 * place they are wired into an actual turn — utterance in, router, dispatcher
 * policy, domain use case, database, trace out — and building it was the point:
 * seven packages that each pass their own tests have still never been run
 * together, and that gap is exactly where integration bugs live.
 *
 * `apps/web` (WP-09) wraps this same assembly behind a UI. Nothing here is
 * throwaway; the CLI is a surface, not a prototype.
 */

export interface AppOptions {
  readonly model?: string;
  readonly embedder?: 'hashing' | 'ollama';
  readonly currency?: CurrencyCode;
  readonly today?: string;
  /** Skip the LLM entirely. Stages 1–2 only — proves the offline path. */
  readonly noModel?: boolean;
  /**
   * Where `registry.json` lives.
   *
   * The CLI can find it by walking up from its own source. A bundler cannot —
   * `import.meta.dirname` means something else once the file has been through
   * one — so any host that is not this CLI passes the path in explicitly.
   */
  readonly registryPath?: string;
}

export interface TurnResult {
  readonly decision: Decision;
  /** Rendered answer, ready to print. */
  readonly output: readonly string[];
  readonly trace: TurnTrace;
}

export class FinanceApp {
  readonly #db: DatabaseSync;
  readonly #registry: Registry;
  readonly #dispatcher: Dispatcher;
  readonly #query: SqliteQueryEngine;
  readonly #repositories: Repositories;
  readonly #useCaseDeps: UseCaseDeps;
  readonly #recorder: TraceRecorder;
  readonly #traces: SqliteTraceStore;
  readonly #runtime: LlmRuntime | undefined;
  readonly #undo: SqliteUndoJournal;
  readonly #options: Required<Pick<AppOptions, 'currency' | 'today' | 'embedder'>>;
  readonly #embedder: ReturnType<typeof makeEmbedder>;
  readonly #model: string | undefined;

  /** Where the user "is". Stage 1 and the slot resolvers both read this. */
  route = '/';

  private constructor(parts: {
    db: DatabaseSync;
    registry: Registry;
    embedder: ReturnType<typeof makeEmbedder>;
    runtime: LlmRuntime | undefined;
    model: string | undefined;
    options: Required<Pick<AppOptions, 'currency' | 'today' | 'embedder'>>;
  }) {
    this.#db = parts.db;
    this.#registry = parts.registry;
    this.#embedder = parts.embedder;
    this.#runtime = parts.runtime;
    this.#model = parts.model;
    this.#options = parts.options;

    this.#repositories = {
      accounts: new SqliteAccountRepository(this.#db),
      categories: new SqliteCategoryRepository(this.#db),
      transactions: new SqliteTransactionRepository(this.#db),
      budgets: new SqliteBudgetRepository(this.#db),
    };
    this.#query = new SqliteQueryEngine(this.#db);
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
    };
  }

  static async create(options: AppOptions = {}): Promise<FinanceApp> {
    const embedderKind = options.embedder ?? 'ollama';
    const embedder = makeEmbedder(embedderKind);

    // The registry is generated from domain-finance by `pnpm registry:build`.
    const registryPath = options.registryPath ?? join(
      import.meta.dirname, '..', '..', '..',
      'packages', 'core-intent', 'eval', 'registry.json',
    );
    const registry = await loadRegistry(registryPath, embedder);

    const db = openMemoryDatabase();
    seed(db, { currency: options.currency ?? 'EUR', endDate: options.today ?? '2026-08-29' });

    return new FinanceApp({
      db,
      registry,
      embedder,
      runtime: options.noModel ? undefined : new OllamaLlmRuntime({ model: options.model }),
      model: options.model,
      options: {
        currency: options.currency ?? 'EUR',
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

  get currency(): CurrencyCode {
    return this.#options.currency;
  }

  /**
   * The fixed query set, for surfaces that render rather than print.
   *
   * `#read` below is the *CLI's* renderer: it returns padded text lines, which
   * is the right answer for a terminal and the wrong one for a screen that
   * wants a figure at 44px and a bar beside it. Rather than teach one renderer
   * to speak two languages, each surface renders from the same query engine —
   * which is the only thing that is allowed to compute a number either way.
   */
  get query(): SqliteQueryEngine {
    return this.#query;
  }

  /**
   * Headline figures, computed.
   *
   * This exists so the discoverability tiles can carry live numbers instead of
   * captions. Every value is produced by the query engine and formatted by
   * `formatMoney` — Rule 2 applies to a tile exactly as it applies to an
   * answer, and the model is not involved in either.
   */
  snapshot(): {
    currency: CurrencyCode;
    today: string;
    monthToDate: { totalMinor: number; transactionCount: number; from: string; to: string };
    budgets: readonly { categoryId: string; categoryName: string; spentMinor: number; limitMinor: number; remainingMinor: number }[];
    accounts: readonly { name: string; balanceMinor: number }[];
  } {
    const today = this.#options.today;
    const from = `${today.slice(0, 7)}-01`;
    const total = this.#query.spendingTotal({ from, to: today, currency: this.#options.currency });
    const budgets = this.#query.budgetStatus({ currency: this.#options.currency, on: today });
    const accounts = this.#query.listAccounts();

    return {
      currency: this.#options.currency,
      today,
      monthToDate: {
        totalMinor: total.rows[0]?.totalMinor ?? 0,
        transactionCount: total.rows[0]?.transactionCount ?? 0,
        from,
        to: today,
      },
      budgets: budgets.rows.map((b) => ({
        categoryId: b.categoryId,
        categoryName: b.categoryName,
        spentMinor: b.spentMinor,
        limitMinor: b.limitMinor,
        remainingMinor: b.remainingMinor,
      })),
      accounts: accounts.rows.map((a) => ({
        name: String(a.name),
        balanceMinor: Number(a.balanceMinor),
      })),
    };
  }

  /**
   * One turn.
   *
   * The whole point of the assembly, in order: route, then apply policy, then —
   * only if policy allows — touch data. Nothing the model produced reaches the
   * database without passing through the dispatcher.
   */
  async turn(utterance: string): Promise<TurnResult> {
    let decision: Decision = { type: 'clarify', question: 'I did not understand that.', options: [] };
    let output: readonly string[] = [];

    await this.#recorder.run(
      {
        transcript: utterance,
        ...(this.#runtime ? { modelId: this.#runtime.name } : {}),
        promptVersion: 'v3',
      },
      async (r) => {
        const routed: RouterTrace = await route(utterance, this.context, {
          registry: this.#registry,
          embedder: this.#embedder,
          thresholds: thresholdsFor(this.#options.embedder),
          useStage3: this.#runtime !== undefined,
          runtime: this.#runtime,
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
        for (const [name, value] of Object.entries(routed.params)) {
          // The router already applied Rule 11, so anything surviving a
          // deterministic resolver is deterministic. Free-text params are the
          // model's. This is what `explain()` reports back to the user.
          r.param(name, value, this.#isDeterministic(name) ? 'deterministic' : 'model');
        }

        // --- policy ----------------------------------------------------------
        decision = this.#dispatcher.decide({
          capabilityId: routed.capabilityId,
          params: routed.params,
          missing: routed.missing,
          candidates: routed.candidates.map((c) => c.capabilityId),
        });

        r.requiresConfirmation(decision.type === 'confirm');
        r.outcome(
          decision.type === 'execute' ? 'execute'
            : decision.type === 'refuse' ? 'out_of_scope'
              : 'clarify',
        );

        // --- act, only if policy allows --------------------------------------
        if (decision.type === 'execute') {
          const { lines, dataRead } = this.#read(decision.capabilityId, decision.params);
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
   * This is Rule 7 taken literally. "Every screen reachable by AI is reachable
   * without it" does not mean *typing a sentence that the router will probably
   * route correctly* — that is still the AI, and it still fails 20% of the time
   * at the top-1 measured here. It means a path that does not consult the
   * router at all, which is what this is: a capability id straight into the
   * dispatcher.
   *
   * Policy is unchanged. A `write` picked from a menu still produces a
   * confirmation card, because the policy is attached to the capability's
   * *kind*, never to how the user got there (ADR-004).
   */
  async invoke(capabilityId: string): Promise<TurnResult> {
    const cap = this.#registry.byId.get(capabilityId);
    if (!cap) throw new Error(`unknown capability "${capabilityId}"`);

    let decision: Decision = { type: 'refuse', reason: 'not runnable', declared: false };
    let output: readonly string[] = [];

    await this.#recorder.run(
      { transcript: cap.title, promptVersion: 'v3' },
      async (r) => {
        // The trace still has to be honest about how this was decided: it was
        // not a match, it was a selection. `deterministic` with a single
        // candidate at 1.0 says exactly that, and the note spells it out.
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
          const { lines, dataRead } = this.#read(decision.capabilityId, decision.params);
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
    const currency = this.#options.currency;

    switch (capabilityId) {
      case 'transaction.create': {
        const r = createTransaction(this.#useCaseDeps, {
          accountId: 'acc_current',
          amountMinor: Number(params.amount ?? 0),
          categoryId: (params.category as string) ?? null,
          ...(params.date ? { occurredAt: `${params.date}T12:00:00.000Z` } : {}),
        });
        return r.ok
          ? [`Recorded ${formatMoney({ amountMinor: r.value.amountMinor, currency })} to ${r.value.categoryId ?? 'uncategorised'}.`]
          : [`Could not record it: ${r.reason}`];
      }
      case 'transaction.delete': {
        const r = deleteTransaction(this.#useCaseDeps, String(params.target ?? ''));
        return r.ok
          ? [`Deleted ${r.value.id}.`, `Undo with the token in the trace.`]
          : [`Could not delete it: ${r.reason}`];
      }
      case 'budget.set': {
        const r = setBudget(this.#useCaseDeps, {
          categoryId: String(params.category ?? ''),
          limitMinor: Number(params.amount ?? 0),
          periodStart: `${this.#options.today.slice(0, 7)}-01`,
          periodEnd: `${this.#options.today.slice(0, 7)}-28`,
          currency,
        });
        return r.ok
          ? [`Budget for ${r.value.categoryId} set to ${formatMoney({ amountMinor: r.value.limitMinor, currency })}.`]
          : [`Could not set it: ${r.reason}`];
      }
      case 'budget.delete': {
        const r = deleteBudget(this.#useCaseDeps, `bud_${params.category}_${this.#options.today.slice(0, 7)}-01`);
        return r.ok ? [`Deleted the ${r.value.categoryId} budget.`] : [`Could not delete it: ${r.reason}`];
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

  // -------------------------------------------------------------- reading --

  #read(
    capabilityId: string,
    params: Readonly<Record<string, string | number>>,
  ): { lines: string[]; dataRead: { table: string; rowCount: number; from?: string; to?: string }[] } {
    const currency = this.#options.currency;
    const from = String(params.from ?? `${this.#options.today.slice(0, 7)}-01`);
    const to = String(params.to ?? this.#options.today);
    const money = (m: number) => formatMoney({ amountMinor: m, currency });

    switch (capabilityId) {
      case 'spending.total': {
        const r = this.#query.spendingTotal({ from, to, currency });
        return {
          lines: [`You spent ${money(r.rows[0]!.totalMinor)} between ${from} and ${to} (${r.rows[0]!.transactionCount} transactions).`],
          dataRead: [...r.dataRead],
        };
      }
      case 'spending.by_category': {
        if (params.category) {
          const r = this.#query.spendingInCategory({ categoryId: String(params.category), from, to, currency });
          return {
            lines: [`${params.category}: ${money(r.rows[0]!.totalMinor)} between ${from} and ${to}.`],
            dataRead: [...r.dataRead],
          };
        }
        const r = this.#query.spendingByCategory({ from, to, currency });
        return {
          lines: [
            `Spending by category, ${from} to ${to}:`,
            ...r.rows.map((c) => `  ${(c.categoryName ?? '?').padEnd(16)} ${money(c.totalMinor)}`),
          ],
          dataRead: [...r.dataRead],
        };
      }
      case 'spending.trend': {
        const r = this.#query.spendingTrend({ from: '2025-03-01', to, currency });
        return {
          lines: ['Monthly spending:', ...r.rows.map((m) => `  ${m.month}  ${money(m.totalMinor)}`)],
          dataRead: [...r.dataRead],
        };
      }
      case 'account.balance':
      case 'accounts.list': {
        const r = this.#query.listAccounts();
        return {
          lines: [
            'Accounts:',
            ...r.rows.map((a) => `  ${String(a.name).padEnd(12)} ${money(Number(a.balanceMinor))}`),
          ],
          dataRead: [...r.dataRead],
        };
      }
      case 'transactions.list':
      case 'search.transactions': {
        const r = params.query
          ? this.#query.searchTransactions({ query: String(params.query) })
          : this.#query.listTransactions({
              from, to,
              ...(params.category ? { categoryId: String(params.category) } : {}),
              limit: 10,
            });
        return {
          lines: [
            `${r.rows.length} transaction(s):`,
            ...r.rows.slice(0, 10).map(
              (t) =>
                `  ${String(t.occurredAt).slice(0, 10)}  ${String(t.categoryName ?? '—').padEnd(14)}` +
                ` ${money(Number(t.amountMinor)).padStart(10)}  ${t.merchant ?? ''}`,
            ),
          ],
          dataRead: [...r.dataRead],
        };
      }
      case 'budget.status':
      case 'budget.view': {
        const r = this.#query.budgetStatus({ currency, on: this.#options.today });
        return {
          lines: [
            'Budgets:',
            ...r.rows.map(
              (b) =>
                `  ${b.categoryName.padEnd(14)} ${money(b.spentMinor).padStart(10)} of ${money(b.limitMinor)}` +
                `  ${b.remainingMinor < 0 ? `OVER by ${money(-b.remainingMinor)}` : `${money(b.remainingMinor)} left`}`,
            ),
          ],
          dataRead: [...r.dataRead],
        };
      }
      case 'categories.list': {
        const r = this.#query.listCategories();
        return {
          lines: ['Categories:', ...r.rows.map((c) => `  ${c.parentId ? '  ' : ''}${c.name}`)],
          dataRead: [...r.dataRead],
        };
      }
      default: {
        // A navigate capability with nothing to read: the route already changed.
        const cap = this.#registry.byId.get(capabilityId);
        return { lines: [`→ ${cap?.route ?? '/'}  (${cap?.title ?? capabilityId})`], dataRead: [] };
      }
    }
  }

  // ---------------------------------------------------------- confirmation --

  /**
   * The confirmation card, as text.
   *
   * ADR-004 rule 1: it shows the **parsed parameters**, not the utterance. That
   * is where a misheard "twelve" versus "twenty" gets caught, and it is the
   * single highest-value detail in the system.
   */
  #describeConfirmation(decision: Extract<Decision, { type: 'confirm' }>): string[] {
    const currency = this.#options.currency;
    const lines = [
      decision.destructive ? `⚠  ${decision.title} — this cannot be undone without the journal.` : `${decision.title}?`,
      '',
    ];
    for (const [name, value] of Object.entries(decision.params)) {
      const shown =
        name === 'amount' && typeof value === 'number'
          ? formatMoney({ amountMinor: value, currency })
          : String(value);
      lines.push(`    ${name.padEnd(10)} ${shown}`);
    }
    lines.push('', 'Type  yes  to confirm, or anything else to cancel.');
    return lines;
  }

  #payloadFor(capabilityId: string, params: Readonly<Record<string, string | number>>): unknown {
    // A destructive undo needs the row itself, captured BEFORE the delete.
    if (capabilityId === 'transaction.delete') {
      return this.#repositories.transactions.get(String(params.target ?? ''));
    }
    if (capabilityId === 'budget.delete') {
      return this.#repositories.budgets.get(`bud_${params.category}_${this.#options.today.slice(0, 7)}-01`);
    }
    return params;
  }

  #isDeterministic(name: string): boolean {
    // dates, money, enums and numbers all have resolvers; free text does not.
    return ['from', 'to', 'date', 'amount', 'category', 'account', 'period'].includes(name);
  }
}
