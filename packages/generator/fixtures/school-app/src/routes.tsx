import { lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { ROUTE_ROLES } from './lib/permissions'

const TeacherDashboardPage = lazy(() => import('./features/dashboard/pages/TeacherDashboardPage'))
const MyHomePage = lazy(() => import('./features/dashboard/pages/MyHomePage'))
const ClassesOverviewPage = lazy(() => import('./features/classes/pages/ClassesOverviewPage'))
const LessonsOverviewPage = lazy(() => import('./features/lessons/pages/LessonsOverviewPage'))
const MyAnnouncementsPage = lazy(() => import('./features/communication/pages/MyAnnouncementsPage'))
const NotificationsPage = lazy(() => import('./features/notifications/pages/NotificationsPage'))
const MyGradesPage = lazy(() => import('./features/student/pages/MyGradesPage'))
const MyChildrenPage = lazy(() => import('./features/guardian/pages/MyChildrenPage'))
const ChildGradesPage = lazy(() => import('./features/guardian/pages/ChildGradesPage'))
const GuardianChildRedirectPage = lazy(() => import('./features/guardian/pages/GuardianChildRedirectPage'))
const SettingsPage = lazy(() => import('./features/settings/pages/SettingsPage'))
const PersonalNotificationsPage = lazy(() => import('./features/settings/pages/PersonalNotificationsPage'))

export const PROTECTED_ROUTES = [
  { path: 'dashboard', element: <TeacherDashboardPage />, roles: ROUTE_ROLES.staff },
  { path: 'classes', element: <ClassesOverviewPage />, roles: ROUTE_ROLES.staff },
  { path: 'lessons', element: <LessonsOverviewPage />, roles: ROUTE_ROLES.staff },
  { path: 'my', element: <MyHomePage />, roles: ROUTE_ROLES.myHome },
  // An address the app moved: the route table sends it on to a screen declared at its own address.
  { path: 'my/schedule', element: <Navigate to="/my" replace />, roles: ROUTE_ROLES.myHome },
  // Not in any nav: named only by the heading the page renders.
  { path: 'my/announcements', element: <MyAnnouncementsPage />, roles: ROUTE_ROLES.myHome },
  { path: 'my/notifications', element: <NotificationsPage />, roles: ROUTE_ROLES.everyone },
  { path: 'my/grades', element: <MyGradesPage />, roles: ROUTE_ROLES.studentSelf },
  { path: 'my/children', element: <MyChildrenPage />, roles: ROUTE_ROLES.parentSelf },
  // Picks the parent's child — the only one, or the roster — and redirects to its page.
  { path: 'my/children/grades', element: <GuardianChildRedirectPage suffix="grades" />, roles: ROUTE_ROLES.parentSelf },
  { path: 'my/children/:childId/grades', element: <ChildGradesPage />, roles: ROUTE_ROLES.parentSelf },
  // Labelled only by the sidebar's inline pinned item.
  { path: 'settings', element: <SettingsPage />, roles: ROUTE_ROLES.everyone },
  // A wrapper: every word it shows is in the layout and section it renders.
  { path: 'settings/notifications', element: <PersonalNotificationsPage />, roles: ROUTE_ROLES.everyone },
]
