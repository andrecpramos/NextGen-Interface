import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** The squad at a glance: roster size and eligibility. */
export default function SquadOverviewPage() {
  const { t } = useTranslation('squad')
  return <PageHeader title={t('overview.title')} />
}
