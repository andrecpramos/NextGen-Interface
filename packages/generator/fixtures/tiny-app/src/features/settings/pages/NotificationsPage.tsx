import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** Which emails and push messages this account receives. */
export default function NotificationsPage() {
  const { t } = useTranslation('settings')
  return <PageHeader title={t('notifications.title')} />
}
