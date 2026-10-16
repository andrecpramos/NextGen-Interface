import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** A student's or parent's own landing page: announcements, authorisations and the next event. */
export default function MyHomePage() {
  const { t } = useTranslation('dashboard')
  return <PageHeader title={t('home.title')} />
}
