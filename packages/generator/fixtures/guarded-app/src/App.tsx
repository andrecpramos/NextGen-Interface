import { Routes, Route, Outlet, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Settings from './pages/Settings'
import Search from './pages/Search'
import Overview from './pages/admin/Overview'
import Users from './pages/admin/Users'
import Secret from './pages/admin/Secret'

/**
 * The third guard shape (WP-43), copied in miniature from a public app we do not
 * own: the roles live on a PARENT route's element, and its children inherit them.
 */
interface ProtectedRouteProps {
  user: { roles: string[] } | null
  allowedRoles?: string[]
}

const ProtectedRoute = ({ user, allowedRoles }: ProtectedRouteProps) => {
  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles && !user.roles.some((role) => allowedRoles.includes(role))) {
    return <Navigate to="/404" replace />
  }
  return <Outlet />
}

export default function App({ user, rolesFromServer }: { user: null; rolesFromServer: string[] }) {
  return (
    <Routes>
      {/* No guard: everyone, signed out included. */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      {/* A guard with no role list: any signed-in user, which narrows nothing by role. */}
      <Route element={<ProtectedRoute user={user} />}>
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* A guard naming roles: inherited by every child. */}
      <Route element={<ProtectedRoute user={user} allowedRoles={['STUDENT', 'TUTOR']} />}>
        <Route path="/search" element={<Search />} />
      </Route>

      <Route element={<ProtectedRoute user={user} allowedRoles={['ADMIN']} />}>
        <Route path="/admin/overview" element={<Overview />} />
        <Route path="/admin/users" element={<Users />} />
      </Route>

      {/* A guard whose roles cannot be evaluated: the route must be dropped and
          reported, never defaulted to everyone (Rule 17). */}
      <Route element={<ProtectedRoute user={user} allowedRoles={rolesFromServer} />}>
        <Route path="/admin/secret" element={<Secret />} />
      </Route>
    </Routes>
  )
}
