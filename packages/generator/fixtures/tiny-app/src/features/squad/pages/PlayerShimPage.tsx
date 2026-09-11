import { Navigate, useParams } from 'react-router-dom'

/** Preserves an old module URL. Renders nothing of its own. */
export default function PlayerShimPage() {
  const { id } = useParams()
  return <Navigate to={`/players/${id}`} replace />
}
