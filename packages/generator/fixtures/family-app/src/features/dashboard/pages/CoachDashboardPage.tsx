import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'
import { useToday } from '../api/useToday'

/** The coaching staff's landing page: today's sessions and the next match. */
export default function CoachDashboardPage() {
  const { t } = useTranslation('dashboard')
  const { isPending } = useToday()
  if (isPending) {
    return <PageHeader title={t('coach.loading')} />
  }
  return <PageHeader title={t('coach.title')} />
}
