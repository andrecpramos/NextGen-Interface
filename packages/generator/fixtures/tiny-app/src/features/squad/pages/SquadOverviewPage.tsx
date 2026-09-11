import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/**
 * The squad department's landing page: roster size, eligibility status and
 * quick links into the team and player lists.
 */
export default function SquadOverviewPage() {
  const { t } = useTranslation('squad')
  return (
    <div>
      <PageHeader title={t('overview.title')} />
      <p>Roster health</p>
    </div>
  )
}
