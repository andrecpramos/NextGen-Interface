import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** The classes at a glance: class sizes and enrolment. */
export default function ClassesOverviewPage() {
  const { t } = useTranslation('classes')
  return <PageHeader title={t('overview.title')} />
}
