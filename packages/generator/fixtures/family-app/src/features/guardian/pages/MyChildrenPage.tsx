import { useTranslation } from 'react-i18next'
import { PageContainer, PageHeader } from '../../../components/ui'

/** Every child linked to this guardian's account. */
export default function MyChildrenPage() {
  const { t } = useTranslation('guardian')
  return <PageContainer header={<PageHeader title={t('pageTitle')} />} />
}
