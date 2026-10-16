import { useTranslation } from 'react-i18next'
import { PageHeader, EmptyState } from '../../../components/ui'

function AnnouncementRow({ sender }: { sender: string }) {
  const { t } = useTranslation('communication')
  return (
    <p>
      {t('announcement.from')} {sender}
    </p>
  )
}

/** Announcements from the school, with a read confirmation where one is asked for. */
export default function MyAnnouncementsPage() {
  const { t: ts } = useTranslation('student')
  return (
    <div>
      <PageHeader title={ts('announcements.title')} subtitle={ts('announcements.subtitle')} />
      <EmptyState title={ts('announcements.empty.title')} />
      <AnnouncementRow sender="Direção" />
    </div>
  )
}
