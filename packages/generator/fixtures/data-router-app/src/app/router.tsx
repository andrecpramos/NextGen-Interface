import { createBrowserRouter } from 'react-router'
import { paths } from '@/config/paths'
import AppShell from './routes/app/shell'

const computed = () => '/computed'

// WP-28's second fixture: the data-router style a code-split app uses — paths
// read from a table through an alias, pages as `lazy` imports, one of them
// through the alias too. Modelled on a real public application we do not own.
export const router = createBrowserRouter([
  { path: paths.home.path, lazy: () => import('./routes/landing') },
  {
    path: paths.app.root.path,
    element: <AppShell />,
    children: [
      { path: paths.app.reports.path, lazy: () => import('./routes/app/reports') },
      { path: paths.app.report.path, lazy: () => import('@/app/routes/app/report') },
    ],
  },
  // A path this generator cannot evaluate. It must be REPORTED, not dropped.
  { path: computed(), lazy: () => import('./routes/landing') },
  { path: '*', lazy: () => import('./routes/landing') },
])
