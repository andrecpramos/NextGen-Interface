/**
 * Stands in for Next.js's `server-only` marker under vitest.
 *
 * `server-only` is not a real dependency — Next injects it, and it exists to make a
 * client bundle fail loudly if it ever imports server code. Outside Next it does not
 * resolve at all, which would make every module that declares itself server-only
 * untestable. Aliasing it to nothing keeps the marker meaningful where it matters
 * (the bundler) and out of the way where it does not (a unit test).
 */
export {};
