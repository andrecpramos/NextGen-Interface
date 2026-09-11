import { lazy } from 'react'
import { ROUTE_ROLES } from './lib/permissions'

const SquadOverviewPage = lazy(() => import('./features/squad/pages/SquadOverviewPage'))
const PlayersPage = lazy(() => import('./features/squad/pages/PlayersPage'))
const PlayerDetailPage = lazy(() => import('./features/squad/pages/PlayerDetailPage'))
const PlayerShimPage = lazy(() => import('./features/squad/pages/PlayerShimPage'))
const TeamsPage = lazy(() => import('./features/squad/pages/TeamsPage'))
const SettingsIndexPage = lazy(() => import('./features/settings/pages/SettingsIndexPage'))
const NotificationsPage = lazy(() => import('./features/settings/pages/NotificationsPage'))
const AdminUsersPage = lazy(() => import('./features/adminUsers/pages/AdminUsersPage'))
const IconGalleryPage = lazy(() => import('./features/dev/pages/IconGalleryPage'))
const ChildViewPage = lazy(() => import('./features/guardian/pages/ChildViewPage'))

export const PROTECTED_ROUTES = [
  { path: 'squad', element: <SquadOverviewPage />, roles: ROUTE_ROLES.squadOverview },
  { path: 'squad/players', element: <PlayersPage />, roles: ROUTE_ROLES.squadPlayers },
  { path: 'squad/players/:id', element: <PlayerDetailPage />, roles: ROUTE_ROLES.squadPlayers },
  // A URL shim kept for old bookmarks — it leaves the squad section entirely.
  { path: 'squad/legacy-player/:id', element: <PlayerShimPage />, roles: ROUTE_ROLES.squadPlayers },
  { path: 'squad/teams', element: <TeamsPage />, roles: ROUTE_ROLES.squadOverview },
  // The settings landing redirects to its own first tab: still a destination.
  { path: 'settings', element: <SettingsIndexPage />, roles: ROUTE_ROLES.everyone },
  { path: 'settings/notifications', element: <NotificationsPage /> },
  { path: 'admin/users', element: <AdminUsersPage />, roles: ROUTE_ROLES.adminOnly },
  // The role expression is a call this generator cannot evaluate; the route is
  // dropped rather than guessed at (Rule 17).
  { path: 'admin/unreadable', element: <AdminUsersPage />, roles: ROUTE_ROLES.notForParents },
  { path: 'my/child', element: <ChildViewPage />, roles: ROUTE_ROLES.parentSelf },
  ...(import.meta.env.DEV
    ? [{ path: 'dev/icons', element: <IconGalleryPage />, roles: ROUTE_ROLES.adminOnly }]
    : []),
]
