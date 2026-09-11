import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** User accounts, their roles, and invitations. Administrators only. */
export default function AdminUsersPage() {
  const { t } = useTranslation('admin')
  return <PageHeader title={t('users.title')} />
}
