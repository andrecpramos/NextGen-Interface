import { Navigate } from 'react-router-dom'
import { LoadingState } from '../../../components/ui'
import { useChildren } from '../api/useChildren'

/** A parent with one child goes straight to that child's page; with several, to the roster. */
export default function GuardianChildRedirectPage({ suffix }: { suffix: string }) {
  const { children, isPending } = useChildren()
  if (isPending) return <LoadingState />
  if (children.length === 1) {
    return <Navigate to={`/my/children/${children[0].studentId}/${suffix}`} replace />
  }
  return <Navigate to="/my/children" replace />
}
