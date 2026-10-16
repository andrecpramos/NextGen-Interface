import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** Every notification this account has received, newest first. */
export default function NotificationsPage() {
  const { t } = useTranslation('notifications')
  return <PageHeader title={t('page.title')} />
}
