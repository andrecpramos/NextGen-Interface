import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader, LoadingState } from '../../../components/ui'
import { useChildren } from '../api/useChildren'

/**
 * Resolves a guardian's single linked child directly, or shows the roster when
 * there is more than one. A destination, not a redirect — the name says
 * otherwise and the name is not what matters.
 */
export default function ChildViewPage() {
  const { t } = useTranslation('guardian')
  const { children, isPending } = useChildren()

  if (isPending) {
    return (
      <div>
        <PageHeader title={t('child.title')} />
        <LoadingState />
      </div>
    )
  }

  if (children.length === 1) {
    return <Navigate to={`/my/child/${children[0].id}`} replace />
  }

  return <PageHeader title={t('child.rosterTitle')} />
}
