import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** The old team list. A real page, kept only so old links resolve. */
export default function TeamsPage() {
  const { t } = useTranslation('squad')
  return <PageHeader title={t('teams.title')} />
}
