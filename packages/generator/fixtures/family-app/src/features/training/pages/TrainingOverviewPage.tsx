import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** This week's training load and the sessions planned. */
export default function TrainingOverviewPage() {
  const { t } = useTranslation('training')
  return <PageHeader title={t('overview.title')} />
}
