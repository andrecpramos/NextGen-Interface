import type { Budget, Transaction } from './entities.ts';

/**
 * Domain events.
 *
 * A use case does one thing and **emits an event rather than reaching sideways**.
 * The rule matters more than it looks: the moment `createTransaction` starts
 * calling into budgets to recompute a total, the two are welded together and
 * domain #2 inherits the weld. Events keep each use case a single, testable
 * statement of what happened.
 *
 * They are also the natural feed for the trace, the undo journal and any future
 * coaching layer — none of which the use case should know about.
 */

export type DomainEvent =
  | { readonly type: 'transaction.created'; readonly transaction: Transaction }
  | { readonly type: 'transaction.updated'; readonly before: Transaction; readonly after: Transaction }
  | { readonly type: 'transaction.deleted'; readonly transaction: Transaction }
  | { readonly type: 'budget.set'; readonly budget: Budget; readonly replaced: Budget | null }
  | { readonly type: 'budget.deleted'; readonly budget: Budget }
  | { readonly type: 'budget.exceeded'; readonly budgetId: string; readonly spentMinor: number; readonly limitMinor: number };

export type EventHandler = (event: DomainEvent) => void;

export class EventBus {
  readonly #handlers: EventHandler[] = [];
  readonly #recorded: DomainEvent[] = [];

  subscribe(handler: EventHandler): () => void {
    this.#handlers.push(handler);
    return () => {
      const i = this.#handlers.indexOf(handler);
      if (i >= 0) this.#handlers.splice(i, 1);
    };
  }

  emit(event: DomainEvent): void {
    this.#recorded.push(event);
    // A throwing subscriber must not roll back the thing that already happened.
    // The event is a statement of fact; a listener's failure does not unmake it.
    for (const h of [...this.#handlers]) {
      try {
        h(event);
      } catch {
        /* a subscriber's failure is not the emitter's problem */
      }
    }
  }

  /** Everything emitted, for tests and for the trace. */
  get recorded(): readonly DomainEvent[] {
    return this.#recorded;
  }

  clear(): void {
    this.#recorded.length = 0;
  }
}
