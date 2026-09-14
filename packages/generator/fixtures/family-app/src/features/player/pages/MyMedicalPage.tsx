import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../../components/ui'

/** A player's own fitness and recovery status. */
export default function MyMedicalPage() {
  const { t } = useTranslation('player')
  return <PageHeader title={t('medical.title')} />
}
