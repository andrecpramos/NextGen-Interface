import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog, PageHeader } from '../../../components/ui'
import { useChild } from '../api/useChild'

/** A parent's view of one child's marks and attendance, subject by subject. */
export default function ChildGradesPage() {
  const { childId } = useParams()
  const { t: tg } = useTranslation('guardian')
  const childName = useChild(childId)?.name
  const title = childName ? tg('grades.titleFor', { name: childName }) : tg('grades.page.heading')
  return (
    <div>
      <PageHeader title={title} subtitle={tg('grades.subtitle')} />
      <ConfirmDialog title={tg('grades.confirm.meeting.title')} />
    </div>
  )
}
