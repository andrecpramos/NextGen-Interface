import { Navigate } from 'react-router-dom'

/** Settings has no page of its own; the first tab is the landing. */
export default function SettingsIndexPage() {
  return <Navigate to="/settings/notifications" replace />
}
