import type { DiscoveredRoute } from './types.ts';

/**
 * Capability id synthesis.
 *
 * `core-capability`'s `id-format` rule requires a dotted id of at least two
 * segments. The WP-30 spike fell back to a lowercased component name whenever
 * no i18n label was found, which produced `settingspage`, `matchhubpage` and 21
 * other ids that no registry would accept — 17.6% of its output.
 *
 * So there is no fallback here. An id is **always** `<feature>.<name>`, built
 * from facts that always exist: the feature folder the component lives in (or
 * the route's own first segment) and the rest of the route. VERDICT.md called
 * this "a one-line fix, not evidence against the premise"; it is written down
 * as its own module so the next adapter cannot quietly reintroduce the fallback.
 */

const ID_SEGMENT = /^[a-z][a-z0-9_]*$/;
/** `core-capability`'s id rule allows an underscore only after the first segment. */
const ID_HEAD = /^[a-z][a-z0-9]*$/;

function normalise(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

/** Path segments that name a value rather than a place. */
function isParameter(segment: string): boolean {
  return segment.startsWith(':') || segment === '*';
}

export function routeSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/**
 * The feature this route belongs to: the folder its component lives in, or the
 * first segment of its own path when the component could not be located.
 *
 * Reduced to a single word, because the id's first segment may not contain an
 * underscore. A folder called `adminUsers` becomes the `admin` area and keeps
 * `users` in the second segment, where it reads the way a person would say it —
 * `admin.users`, not `adminusers.admin_users`.
 */
export function featureOf(route: DiscoveredRoute): string {
  const fromFolder = route.feature ? (normalise(route.feature).split('_')[0] ?? '') : '';
  if (ID_HEAD.test(fromFolder)) return fromFolder;
  const [first] = routeSegments(route.path);
  const fromPath = first ? (normalise(first.replace(/^:/, '')).split('_')[0] ?? '') : '';
  return ID_HEAD.test(fromPath) ? fromPath : 'app';
}

/**
 * `<feature>.<name>` — never one segment, never a component name.
 *
 * A route that is only its feature (`/squad`) is that feature's `overview`; a
 * route carrying path parameters gets `_detail`, because `/medical/injuries`
 * and `/medical/injuries/:id` are two capabilities and must not collide.
 */
export function synthesiseId(route: DiscoveredRoute, taken: ReadonlySet<string>): string {
  const feature = featureOf(route);
  const segments = routeSegments(route.path);
  const named = segments.filter((segment) => !isParameter(segment)).map(normalise).filter(Boolean);

  // Drop a leading segment that only repeats the feature: `squad.squad_staff`
  // reads like a bug even though it is well-formed.
  if (named[0] === feature) named.shift();

  const hasParameters = segments.some(isParameter);
  const base = named.length > 0 ? named.join('_') : 'overview';
  let name = hasParameters ? `${base}_detail` : base;
  if (!ID_SEGMENT.test(name)) name = 'overview';

  let candidate = `${feature}.${name}`;
  for (let suffix = 2; taken.has(candidate); suffix++) {
    candidate = `${feature}.${name}_${suffix}`;
  }
  return candidate;
}
