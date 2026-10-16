import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readControls } from './controls.ts';
import { importResolver } from './discover.ts';

/**
 * Found rehearsing on a real Next.js app (2026-10-16): its routes are `src/app`, its components
 * `src/components`, imported as `@/components/…`. The resolver accepted only files inside `appRoot`, so
 * every component of a Next.js app was refused — no controls, and a page that delegates to a component
 * described from nothing. The project the app root sits in (up to its package.json) is the adopter's own
 * code too; a file outside it, and anything in node_modules, still is not.
 */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'nextgen-project-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), source, 'utf8');
  }
  return root;
}

describe('importResolver — the project an app root sits in', () => {
  const root = tree({
    'outside/shared.tsx': 'export function Shared() { return <button type="submit">Outside</button> }',
    'web/package.json': '{ "name": "web" }',
    'web/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "~shared/*": ["../outside/*"] } } }',
    'web/src/app/settings/page.tsx': [
      "import { ProfileForm } from '@/components/profile-form'",
      "import { Shared } from '~shared/shared'",
      'export default function SettingsPage() { return <><ProfileForm /><Shared /></> }',
    ].join('\n'),
    'web/src/components/profile-form.tsx': 'export function ProfileForm() { return <form><button type="submit">Save profile</button></form> }',
  });
  const appRoot = join(root, 'web', 'src', 'app');
  const page = join(appRoot, 'settings', 'page.tsx');
  const resolve = importResolver(appRoot);

  it('reads a component the app root imports from elsewhere in its project', () => {
    expect(resolve('@/components/profile-form', page)).toBe(join(root, 'web', 'src', 'components', 'profile-form.tsx'));
    expect(readControls(page, resolve).actions.map((c) => c.label)).toContain('Save profile');
  });

  it('still reads nothing outside the project', () => {
    expect(resolve('~shared/shared', page)).toBeNull();
    expect(readControls(page, resolve).actions.map((c) => c.label)).not.toContain('Outside');
  });
});
