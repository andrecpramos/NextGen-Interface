import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** The club-wide player directory, with position and status filters. */
export default function PlayersPage() {
  const { t } = useTranslation('squad')
  return (
    <div>
      <PageHeader title={t('players.title')} subtitle={t('players.subtitle')} />
    </div>
  )
}
