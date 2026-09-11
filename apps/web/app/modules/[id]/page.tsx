import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { getEngine } from '@/lib/engine';

export const dynamic = 'force-dynamic';

const ENTRY_LABEL: Record<string, string> = {
  seed: 'created',
  append: 'added to',
  merge_snapshot: 'version saved before a merge',
  revert: 'reverted to an earlier version',
};

const SOURCE_LABEL: Record<string, string> = {
  text: 'typed or spoken',
  image: 'a photo',
  document: 'an uploaded document',
  voice: 'voice',
};

/**
 * A module's own page — `module.open`-equivalent, reachable directly by URL
 * with no prior chat turn (Rule 7). Provenance mirrors the trace panel's
 * philosophy: "what was this built from" is answered from the append-only
 * `module_entries` record, not by asking the model to recall.
 */
export default async function ModuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const app = await getEngine();
  const module_ = app.getModule(id);
  if (!module_) notFound();

  const category = module_.categoryId
    ? app.listCategories().find((c) => c.id === module_.categoryId)
    : null;
  const entries = app.listEntries(id);
  const related = await app.relatedModules(id);

  return (
    <div className="page">
      <div className="column">
        <header className="page__head">
          <h1 className="page__title">{module_.title}</h1>
          <Link className="page__back" href="/modules">← All modules</Link>
        </header>

        <div className="module-detail__meta">
          <span className="ngx-badge">{category?.name ?? 'Uncategorised'}</span>
          <span className="ngx-badge ngx-mono">updated {module_.updatedAt.slice(0, 10)}</span>
        </div>

        <div className="module-detail__body">{module_.body}</div>

        {related.length > 0 && (
          <section className="module-detail__related">
            <p className="ngx-label">Related modules</p>
            <div className="module-grid">
              {related.map((r) => (
                <Link className="module-card" href={`/modules/${r.module.id}`} key={r.module.id}>
                  <p className="module-card__title">{r.module.title}</p>
                  <p className="module-card__summary">{r.module.summary}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {entries.length > 0 && (
          <section className="module-detail__history">
            <p className="ngx-label">What this was built from</p>
            <ul className="ngx-trace__list">
              {entries.map((e) => (
                <li className="ngx-trace__item" key={e.id}>
                  <span>
                    {ENTRY_LABEL[e.kind] ?? e.kind}
                    {e.kind === 'seed' || e.kind === 'append'
                      ? ` from ${SOURCE_LABEL[e.sourceType] ?? e.sourceType}`
                      : ''}
                    {' · '}
                    <span className="ngx-mono">{e.createdAt.slice(0, 10)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
