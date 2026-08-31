import 'server-only';

import type { AnswerRow, AnswerView, ConfirmView, NavItem, ParamView, TraceView } from '@nextgen/ui';
import type { FinanceApp } from '@nextgen/cli';
import type { Decision } from '@nextgen/core-dispatch';
import { explain, type TurnTrace } from '@nextgen/core-trace';
import { formatMoney, type CurrencyCode } from '@nextgen/data';

/**
 * The web renderer.
 *
 * "Answers are rendered, not narrated." The CLI turns a query result into
 * padded text; this turns the same result into a figure, a caption and a set
 * of rows with bars. Neither is more authoritative than the other — both read
 * the query engine, and the query engine is the only thing in the system
 * allowed to compute a number the user sees (Rule 2).
 *
 * Nothing here formats money by hand. `formatMoney` takes integer minor units
 * and a currency code, and that is the only arithmetic path (Rule 6).
 */

function fmt(currency: CurrencyCode) {
  return (minor: number) => formatMoney({ amountMinor: minor, currency });
}

/** The same period defaulting the CLI applies, so both surfaces agree. */
function period(app: FinanceApp, params: Readonly<Record<string, string | number>>) {
  const today = app.snapshot().today;
  return {
    from: String(params.from ?? `${today.slice(0, 7)}-01`),
    to: String(params.to ?? today),
  };
}

/** Bars are relative to the largest row: a comparison, not an absolute scale. */
function withBars(rows: readonly { label: string; minor: number }[], money: (n: number) => string): AnswerRow[] {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.minor)));
  return rows.map((r) => ({ label: r.label, value: money(r.minor), bar: Math.abs(r.minor) / max }));
}

export function renderAnswer(
  app: FinanceApp,
  capabilityId: string,
  params: Readonly<Record<string, string | number>>,
): AnswerView {
  const currency = app.currency;
  const money = fmt(currency);
  const q = app.query;
  const { from, to } = period(app, params);

  switch (capabilityId) {
    case 'spending.total': {
      const row = q.spendingTotal({ from, to, currency }).rows[0];
      return {
        headline: money(row?.totalMinor ?? 0),
        caption: `${from} to ${to} · ${row?.transactionCount ?? 0} transactions`,
      };
    }

    case 'spending.by_category': {
      if (params.category) {
        const row = q.spendingInCategory({ categoryId: String(params.category), from, to, currency }).rows[0];
        return {
          headline: money(row?.totalMinor ?? 0),
          caption: `${params.category} · ${from} to ${to}`,
        };
      }
      const rows = q.spendingByCategory({ from, to, currency }).rows;
      const total = rows.reduce((sum, r) => sum + r.totalMinor, 0);
      return {
        headline: money(total),
        caption: `Across ${rows.length} categories · ${from} to ${to}`,
        rows: withBars(rows.map((r) => ({ label: r.categoryName ?? 'Uncategorised', minor: r.totalMinor })), money),
      };
    }

    case 'spending.trend': {
      const rows = q.spendingTrend({ from: '2025-03-01', to, currency }).rows;
      return {
        caption: `Monthly spending through ${to}`,
        rows: withBars(rows.map((m) => ({ label: m.month, minor: m.totalMinor })), money),
      };
    }

    case 'account.balance':
    case 'accounts.list': {
      const rows = q.listAccounts().rows;
      const total = rows.reduce((sum, a) => sum + Number(a.balanceMinor), 0);
      return {
        headline: money(total),
        caption: `Across ${rows.length} account${rows.length === 1 ? '' : 's'}`,
        rows: rows.map((a) => ({
          label: String(a.name),
          value: money(Number(a.balanceMinor)),
          ...(Number(a.balanceMinor) < 0 ? { tone: 'danger' as const } : {}),
        })),
      };
    }

    case 'transactions.list':
    case 'search.transactions': {
      const result = params.query
        ? q.searchTransactions({ query: String(params.query) })
        : q.listTransactions({
            from, to,
            ...(params.category ? { categoryId: String(params.category) } : {}),
            limit: 10,
          });
      const rows = result.rows.slice(0, 10);
      return {
        caption: `${result.rows.length} transaction${result.rows.length === 1 ? '' : 's'}${params.query ? ` matching “${params.query}”` : ` · ${from} to ${to}`}`,
        rows: rows.map((t) => ({
          label: `${String(t.occurredAt).slice(0, 10)} · ${t.merchant ?? t.categoryName ?? '—'}`,
          value: money(Number(t.amountMinor)),
        })),
      };
    }

    case 'budget.status':
    case 'budget.view': {
      const rows = q.budgetStatus({ currency, on: to }).rows;
      const over = rows.filter((b) => b.remainingMinor < 0);
      return {
        ...(over.length > 0
          ? { headline: `${over.length} over budget`, tone: 'danger' as const }
          : { headline: 'All within budget', tone: 'accent' as const }),
        caption: `${rows.length} budget${rows.length === 1 ? '' : 's'} · as of ${to}`,
        // The bar can exceed 1 here on purpose — that is what "over" looks like,
        // and the fill switches colour AND the value carries a sign cue.
        rows: rows.map((b) => ({
          label: b.categoryName,
          value: `${money(b.spentMinor)} of ${money(b.limitMinor)}`,
          bar: b.limitMinor > 0 ? b.spentMinor / b.limitMinor : 0,
          ...(b.remainingMinor < 0 ? { tone: 'danger' as const } : {}),
        })),
      };
    }

    case 'categories.list': {
      const rows = q.listCategories().rows;
      return {
        caption: `${rows.length} categories`,
        rows: rows.map((c) => ({ label: `${c.parentId ? '— ' : ''}${c.name}`, value: '' })),
      };
    }

    default: {
      // A navigate capability with nothing to read. The route already changed;
      // saying so is the whole answer.
      const cap = app.capabilities.find((c) => c.id === capabilityId);
      return { caption: `Opened ${cap?.title ?? capabilityId}.` };
    }
  }
}

/**
 * The confirmation card's data.
 *
 * `amount` is shown as a plain decimal rather than "€12.00" for one reason: it
 * has to survive being edited and sent back. A formatted string is a
 * one-way trip — the currency symbol, the grouping separator and the locale all
 * have to be un-picked to get an integer back out, and every one of those is a
 * chance to turn 1,200 into 1.2. The currency goes in the field's label instead.
 */
export function renderConfirm(
  decision: Extract<Decision, { type: 'confirm' }>,
  trace: TurnTrace,
  currency: CurrencyCode,
): ConfirmView {
  const params: ParamView[] = Object.entries(decision.params).map(([name, value]) => {
    const isAmount = name === 'amount' && typeof value === 'number';
    return {
      name: isAmount ? `${name} (${currency})` : name,
      display: isAmount ? (value / 100).toFixed(2) : String(value),
      raw: String(value),
      source: trace.paramSources[name] ?? 'model',
      editable: true,
    };
  });

  return {
    capabilityId: decision.capabilityId,
    title: decision.title,
    destructive: decision.destructive,
    params,
  };
}

/**
 * The trace, as the panel wants it.
 *
 * `explain()` does the prose; every string it returns is assembled from ids,
 * enums and numbers held in the record. The candidate scores are passed through
 * raw because the panel draws them, and a decision whose runners-up you cannot
 * see is asserted rather than explained.
 */
export function renderTrace(trace: TurnTrace, local: boolean): TraceView {
  const e = explain(trace);
  return {
    turnId: trace.turnId,
    headline: e.headline,
    steps: e.steps,
    alternatives: e.alternatives,
    dataUsed: e.dataUsed,
    values: e.values,
    timing: e.timing,
    candidates: trace.candidates.map((c) => ({ capabilityId: c.capabilityId, score: c.score })),
    chosen: trace.capabilityId,
    decidedAt: trace.decidedAt,
    local,
    notes: trace.notes,
  };
}

/**
 * The drawer's contents.
 *
 * Every `navigate` capability in the registry, in registry order. Not a menu
 * anybody maintains: a capability added tomorrow appears here, and an entry
 * can never point at something the dispatcher cannot run.
 */
export function renderNav(app: FinanceApp): NavItem[] {
  return app.capabilities
    .filter((c) => c.kind === 'navigate')
    .map((c) => ({ capabilityId: c.id, label: c.title, route: c.route }));
}
