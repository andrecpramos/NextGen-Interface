import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** This week's lessons and the lesson plans behind them. */
export default function LessonsOverviewPage() {
  const { t } = useTranslation('lessons')
  return <PageHeader title={t('overview.title')} />
}
