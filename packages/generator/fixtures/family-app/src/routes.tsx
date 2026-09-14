import { lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { ROUTE_ROLES } from './lib/permissions'

const CoachDashboardPage = lazy(() => import('./features/dashboard/pages/CoachDashboardPage'))
const MyHomePage = lazy(() => import('./features/dashboard/pages/MyHomePage'))
const SquadOverviewPage = lazy(() => import('./features/squad/pages/SquadOverviewPage'))
const TrainingOverviewPage = lazy(() => import('./features/training/pages/TrainingOverviewPage'))
const MyAnnouncementsPage = lazy(() => import('./features/communication/pages/MyAnnouncementsPage'))
const NotificationsPage = lazy(() => import('./features/notifications/pages/NotificationsPage'))
const MyMedicalPage = lazy(() => import('./features/player/pages/MyMedicalPage'))
const MyChildrenPage = lazy(() => import('./features/guardian/pages/MyChildrenPage'))
const ChildMedicalPage = lazy(() => import('./features/guardian/pages/ChildMedicalPage'))
const GuardianChildRedirectPage = lazy(() => import('./features/guardian/pages/GuardianChildRedirectPage'))
const SettingsPage = lazy(() => import('./features/settings/pages/SettingsPage'))
const PersonalNotificationsPage = lazy(() => import('./features/settings/pages/PersonalNotificationsPage'))

export const PROTECTED_ROUTES = [
  { path: 'dashboard', element: <CoachDashboardPage />, roles: ROUTE_ROLES.staff },
  { path: 'squad', element: <SquadOverviewPage />, roles: ROUTE_ROLES.staff },
  { path: 'training', element: <TrainingOverviewPage />, roles: ROUTE_ROLES.staff },
  { path: 'my', element: <MyHomePage />, roles: ROUTE_ROLES.myHome },
  // An address the app moved: the route table sends it on to a screen declared at its own address.
  { path: 'my/schedule', element: <Navigate to="/my" replace />, roles: ROUTE_ROLES.myHome },
  // Not in any nav: named only by the heading the page renders.
  { path: 'my/announcements', element: <MyAnnouncementsPage />, roles: ROUTE_ROLES.myHome },
  { path: 'my/notifications', element: <NotificationsPage />, roles: ROUTE_ROLES.everyone },
  { path: 'my/medical', element: <MyMedicalPage />, roles: ROUTE_ROLES.playerSelf },
  { path: 'my/children', element: <MyChildrenPage />, roles: ROUTE_ROLES.parentSelf },
  // Picks the guardian's child — the only one, or the roster — and redirects to its page.
  { path: 'my/children/medical', element: <GuardianChildRedirectPage suffix="medical" />, roles: ROUTE_ROLES.parentSelf },
  { path: 'my/children/:childId/medical', element: <ChildMedicalPage />, roles: ROUTE_ROLES.parentSelf },
  // Labelled only by the sidebar's inline pinned item.
  { path: 'settings', element: <SettingsPage />, roles: ROUTE_ROLES.everyone },
  // A wrapper: every word it shows is in the layout and section it renders.
  { path: 'settings/notifications', element: <PersonalNotificationsPage />, roles: ROUTE_ROLES.everyone },
]
