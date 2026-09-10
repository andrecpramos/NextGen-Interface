import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** One player's profile: contract, position, and season statistics. */
export default function PlayerDetailPage() {
  const { id } = useParams()
  const { t } = useTranslation('squad')
  return <PageHeader title={t('player.title')} subtitle={id} />
}
