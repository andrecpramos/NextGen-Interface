import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { PageHeader, Authorization } from '../../../components/ui'
import { InjuryList } from '../components/InjuryList'

/** Who is injured, and when each of them is expected back. */
export default function InjuriesPage() {
  const { t } = useTranslation('squad')
  return (
    <div>
      <PageHeader title={t('injuries.title')} />
      <p>Current injuries</p>
      {/* The failure state: what this screen shows when it is NOT working. */}
      <ErrorBoundary fallback={<div>Failed to load injuries. Try to refresh the page.</div>}>
        {/* The audience, which is true of the screen whether or not it is working. */}
        <Authorization forbiddenFallback={<div>Only medical staff can view this.</div>}>
          <InjuryList />
        </Authorization>
      </ErrorBoundary>
    </div>
  )
}
