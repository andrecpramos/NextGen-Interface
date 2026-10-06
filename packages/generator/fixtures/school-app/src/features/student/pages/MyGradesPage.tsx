import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** A student's own marks and attendance, subject by subject. */
export default function MyGradesPage() {
  const { t } = useTranslation('student')
  return <PageHeader title={t('grades.title')} />
}
