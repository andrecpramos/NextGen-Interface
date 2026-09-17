// A module-resolution hook that lets Node import the pilot target's own source.
//
// `fut-app` is a Vite application, so its modules import each other without file
// extensions (`from './permissions'`). Node's ESM resolver requires them. Rather
// than reimplement the app's navigation logic — which would make the
// CommandPalette baseline a measurement of our reimplementation — this hook
// supplies the extension Vite would have, and the baseline then runs the app's
// real `getComposedNavConfig` and `DEEP_LINK_ONLY`.
//
// Read-only, and nothing is written into the target (Rule 16).

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    for (const extension of EXTENSIONS) {
      try {
        return await nextResolve(specifier + extension, context);
      } catch {
        continue;
      }
    }
  }
  return nextResolve(specifier, context);
}
