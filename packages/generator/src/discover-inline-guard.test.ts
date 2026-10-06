import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * A guard written around the page, inside the route's own element:
 *
 *   <Route path="/feedback/submit" element={<ProtectedRoute><FeedbackFormPage /></ProtectedRoute>} />
 *
 * Found by running the scanner on a real coaching app. The route's component was taken to be the
 * outermost element, so the screen was named "Protected Route" and described by the guard's own
 * fallback — "Authentication required. Your session has expired or you are not logged in." — and a
 * visitor asking to submit their feedback form was offered a description of a login wall.
 *
 * The page is the guard's one child. Who may reach it is unchanged: the roles were always read from the
 * outer element's props, and this must never move that (Rule 17).
 */

function app(routes: string): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-guard-'));
  const files: Record<string, string> = {
    'App.jsx': [
      "import { Routes, Route } from 'react-router-dom';",
      "import ProtectedRoute from './ProtectedRoute';",
      "import Shell from './Shell';",
      "import Feedback from './pages/Feedback';",
      "import Admin from './pages/Admin';",
      'export default function App() {',
      `  return <Routes>${routes}</Routes>;`,
      '}',
    ].join('\n'),
    'ProtectedRoute.jsx':
      'export default function ProtectedRoute({ children }) {\n  if (user) return children;\n  return <div><b>Authentication required</b><p>Your session has expired or you are not logged in.</p></div>;\n}',
    'Shell.jsx': 'export default function Shell({ children }) {\n  return <div><nav>Site navigation</nav>{children}</div>;\n}',
    'pages/Feedback.jsx': 'export default function Feedback() {\n  return <main><h1>Daily feedback check-in</h1><p>Rate your sleep and energy</p></main>;\n}',
    'pages/Admin.jsx': 'export default function Admin() {\n  return <main><h1>Administration</h1></main>;\n}',
  };
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return { appRoot, routesFile: 'App.jsx', roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: null, languages: ['en'] };
}

const ROUTES = [
  '<Route path="/feedback" element={<ProtectedRoute><Feedback /></ProtectedRoute>} />',
  '<Route path="/admin" element={<ProtectedRoute allowedRoles={["ADMIN"]}><Admin /></ProtectedRoute>} />',
  '<Route path="/plain" element={<Feedback />} />',
  '<Route path="/two" element={<ProtectedRoute><Feedback /><Admin /></ProtectedRoute>} />',
  '<Route path="/shell" element={<Shell><Feedback /></Shell>} />',
].join('');

const found = (path: string) => discoverRoutes(app(ROUTES)).routes.find((route) => route.path === path);

describe('a guard written around the page, in the route’s own element', () => {
  it('takes the guard’s one child for the page', () => {
    expect(found('/feedback')?.component).toBe('Feedback');
    expect(found('/admin')?.component).toBe('Admin');
    expect(found('/feedback')?.componentFile).toMatch(/Feedback\.jsx$/);
  });

  it('leaves the roles exactly where they were read from: the guard’s own props', () => {
    expect(found('/admin')?.roles).toEqual(['ADMIN']);
  });

  it('does not guess between two children', () => {
    expect(found('/two')?.component).toBe('ProtectedRoute');
  });

  it('does not treat a layout shell as a guard: its children are read through it, as before', () => {
    expect(found('/shell')?.component).toBe('Shell');
  });

  it('leaves an unwrapped page alone', () => {
    expect(found('/plain')?.component).toBe('Feedback');
  });

  it('names and describes the screen for the page, not for the login wall in front of it', async () => {
    const output = await generate({ config: app(ROUTES), model: null });
    const feedback = output.master.find((capability) => capability.route === '/feedback');
    expect(feedback?.title).not.toMatch(/protected/i);
    expect(feedback?.explanation).toContain('Daily feedback check-in');
    expect(feedback?.explanation).not.toContain('Authentication required');
  });
});
