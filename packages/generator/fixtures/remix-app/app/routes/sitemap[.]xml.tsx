// An escaped dot and a resource route: /sitemap.xml, with no page.
export async function loader() {
  return new Response('<urlset />');
}
