import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog, PageHeader } from '../../../components/ui'
import { useChild } from '../api/useChild'

/** A guardian's view of one child's fitness and recovery status, without diagnoses. */
export default function ChildMedicalPage() {
  const { childId } = useParams()
  const { t: tg } = useTranslation('guardian')
  const childName = useChild(childId)?.name
  const title = childName ? tg('medical.titleFor', { name: childName }) : tg('medical.page.heading')
  return (
    <div>
      <PageHeader title={title} subtitle={tg('medical.subtitle')} />
      <ConfirmDialog title={tg('medical.confirm.share.title')} />
    </div>
  )
}
