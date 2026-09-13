// An optional catch-all: it matches /docs itself as well as every /docs/... page.
export async function generateMetadata() {
  return { title: 'Documentation' };
}

export default function DocsPage() {
  return <article>Read the documentation</article>;
}
