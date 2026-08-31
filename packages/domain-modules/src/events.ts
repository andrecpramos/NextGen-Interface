import type { Module, ModuleEntry } from './entities.ts';

/**
 * Domain events.
 *
 * Same shape and same reasoning as `domain-finance/events.ts`: a use case
 * does one thing and emits an event rather than reaching sideways. Duplicated
 * rather than shared, deliberately — a domain package importing another
 * domain package is exactly the weld the "reach sideways" rule exists to
 * prevent, one level up.
 */

export type DomainEvent =
  | { readonly type: 'module.created'; readonly module: Module }
  | { readonly type: 'module.appended'; readonly module: Module; readonly entry: ModuleEntry }
  | { readonly type: 'module.deleted'; readonly module: Module }
  | { readonly type: 'module.reverted'; readonly module: Module };

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
    for (const h of [...this.#handlers]) {
      try {
        h(event);
      } catch {
        /* a subscriber's failure is not the emitter's problem */
      }
    }
  }

  get recorded(): readonly DomainEvent[] {
    return this.#recorded;
  }

  clear(): void {
    this.#recorded.length = 0;
  }
}
