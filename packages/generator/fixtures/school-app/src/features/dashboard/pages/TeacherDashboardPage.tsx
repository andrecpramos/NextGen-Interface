import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'
import { useToday } from '../api/useToday'

/** The teaching staff's landing page: today's lessons and the next test. */
export default function TeacherDashboardPage() {
  const { t } = useTranslation('dashboard')
  const { isPending } = useToday()
  if (isPending) {
    return <PageHeader title={t('teacher.loading')} />
  }
  return <PageHeader title={t('teacher.title')} />
}
