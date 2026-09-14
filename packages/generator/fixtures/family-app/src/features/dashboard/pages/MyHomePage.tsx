import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** A player's or guardian's own landing page: announcements, consents and the next event. */
export default function MyHomePage() {
  const { t } = useTranslation('dashboard')
  return <PageHeader title={t('home.title')} />
}
