import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'
import { CAPABILITY_ROLES, hasCapability } from '../../../lib/permissions'
import { excuseAbsence, useSession } from '../api'

/** A student's or parent's own landing page: announcements, authorisations and the next event. */
export default function MyHomePage() {
  const { t } = useTranslation('dashboard')
  const { roles } = useSession()
  // ADR-042: shown to a parent only — by a role list the permissions module holds.
  return (
    <>
      <PageHeader title={t('home.title')} />
      {hasCapability(roles, ...CAPABILITY_ROLES.excuseAbsence) && (
        <button type="button" onClick={() => excuseAbsence()}>{t('home.excuseAbsence')}</button>
      )}
    </>
  )
}
