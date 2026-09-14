// A private folder (leading underscore): never routable, even with a page in it.
export default function InternalPage() {
  return <p>Not a route</p>;
}
