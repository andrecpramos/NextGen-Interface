import Link from 'next/link';
import type { JSX } from 'react';

import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

/**
 * The modules browser — `module.list`'s route.
 *
 * A real server-rendered page, not the chat stream re-skinned (Rule 7). It
 * reads the same repositories the assistant's `module.search`/`module.capture`
 * do, grouped by the category tree the user (via the AI) built at runtime —
 * there is no pre-seeded taxonomy to fall back on.
 */
export default async function ModulesPage(): Promise<JSX.Element> {
  const app = await getEngine();
  const modules = app.listModules();
  const categories = app.listCategories();

  const byCategory = new Map<string | null, typeof modules>();
  for (const m of modules) {
    const key = m.categoryId;
    byCategory.set(key, [...(byCategory.get(key) ?? []), m]);
  }

  const groups = [
    ...categories
      .filter((c) => byCategory.has(c.id))
      .map((c) => ({ name: c.name, items: byCategory.get(c.id)! })),
    ...(byCategory.has(null) ? [{ name: 'Uncategorised', items: byCategory.get(null)! }] : []),
  ];

  return (
    <div className="page">
      <div className="column">
        <header className="page__head">
          <h1 className="page__title">Modules</h1>
          <Link className="page__back" href="/">← Back to the assistant</Link>
        </header>

        {modules.length === 0 ? (
          <p className="page__empty">
            Nothing saved yet. Tell the assistant what to remember and it will show up here.
          </p>
        ) : (
          groups.map((group) => (
            <section className="module-group" key={group.name}>
              <p className="ngx-label module-group__name">{group.name}</p>
              <div className="module-grid">
                {group.items.map((m) => (
                  <Link className="module-card" href={`/modules/${m.id}`} key={m.id}>
                    <p className="module-card__title">{m.title}</p>
                    <p className="module-card__summary">{m.summary}</p>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
